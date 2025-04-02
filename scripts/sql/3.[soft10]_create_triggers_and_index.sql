-- Drop triggers if they exist
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgComandaActualizado')
    DROP TRIGGER trgComandaActualizado;
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgChequeActualizado')
    DROP TRIGGER trgChequeActualizado;
GO


IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgChequePagoActualizado')
    DROP TRIGGER trgChequePagoActualizado;
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'ActualizacionTurnos')
    DROP TRIGGER ActualizacionTurnos;
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_ExportToCsv')
    DROP TRIGGER trg_ExportToCsv;
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgTurnosActualizado')
    DROP TRIGGER trgTurnosActualizado;
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgTurnosShiftClosing')
    DROP TRIGGER trgTurnosShiftClosing;
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgTurnosShiftClosureComplete')
    DROP TRIGGER trgTurnosShiftClosureComplete;
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgTurnosShiftClosureDetect')
    DROP TRIGGER trgTurnosShiftClosureDetect;
GO

-- Drop foreign key constraints if they exist
IF EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_tempcheqdet_productos')
    ALTER TABLE [dbo].[tempcheqdet] DROP CONSTRAINT FK_tempcheqdet_productos;
GO

IF EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_tempchequespagos_formasdepago')
    ALTER TABLE [dbo].[tempchequespagos] DROP CONSTRAINT FK_tempchequespagos_formasdepago;
GO

IF EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_turnos_estaciones')
    ALTER TABLE [dbo].[turnos] DROP CONSTRAINT FK_turnos_estaciones;
GO


-- tempcheques
CREATE TRIGGER [dbo].[trgChequeActualizado]
ON [dbo].[tempcheques]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Ticket NVARCHAR(100),
            @OriginalTicket NVARCHAR(100),
            @OldTicket NVARCHAR(100),
            @Mesa NVARCHAR(100),
            @OldMesa NVARCHAR(100),
            @MainTable NVARCHAR(100),
            @SplitSuffix NVARCHAR(10),
            @Order INT,
            @OriginalOrder INT,
            @OldOrder INT,
            @Status NVARCHAR(100),
            @PrevStatus NVARCHAR(100),
            @Impreso BIT,
            @idMesero NVARCHAR(100),
            @NombreMesero NVARCHAR(100),
            @IsSplitTable BIT,
            @UniqueCode NVARCHAR(100),
            @ShiftId INT,
            @SplitFolio NVARCHAR(100),
            @SplitOrder INT,
            @IsShiftClosure BIT,
            @DeleteCount INT,
            @ClosingShiftId INT,
            @RecentDeletionCount INT,
            @OriginalFolio NVARCHAR(100),
            @OriginalMesa NVARCHAR(100),
            @OriginalTable NVARCHAR(50),
            @OrigTableName NVARCHAR(100),
            @SplitEventValues NVARCHAR(500),
            @SplitEventId INT,
            @RenameEventValues NVARCHAR(500),
            @RenameEventId INT,
            @OldTableName NVARCHAR(50),
            @NewTableName NVARCHAR(50),
            @NewTablesCount INT,
            @NewTablesText NVARCHAR(200),
            @CurrentTable NVARCHAR(50),
            @SplitMesa NVARCHAR(100),
            @SplitTotal MONEY,
            @SplitUniqueCode NVARCHAR(100),
            @OriginalEventId INT,
            @RelatedFolios NVARCHAR(MAX),
            @ShiftState NVARCHAR(20),
            -- Financial data variables
            @Descuento MONEY,
            @Total MONEY,
            @Efectivo MONEY,
            @Tarjeta MONEY,
            @Vales MONEY,
            @Propina MONEY,
            @PropinaTarjeta MONEY;
            
    -- Check for rapid consecutive INSERTs by the same application
    IF EXISTS(SELECT * FROM inserted) AND NOT EXISTS(SELECT * FROM deleted)
    BEGIN
        -- Only filter out rapid inserts if they appear to be from the application's initialization sequence
        IF EXISTS(
            SELECT 1 
            FROM inserted i 
            WHERE i.pagado = 0 AND i.cancelado = 0  -- Only if status is OPEN
            AND EXISTS(
                SELECT 1 
                FROM [dbo].[TicketEvents] 
                WHERE Folio = i.folio 
                AND EventType = 'OPEN'  -- Only match if previous status was also OPEN
                AND OperationType = 'INSERT'  -- Only match against previous INSERTs
                AND DATEDIFF(SECOND, CreateDate, GETDATE()) <= 3
            )
        )
        BEGIN
            -- Skip processing this event as it's likely part of the same initialization
            RETURN;
        END
    END
    
    -- For UPDATE operations, we want to be more selective about filtering
    IF EXISTS(SELECT * FROM inserted) AND EXISTS(SELECT * FROM deleted)
    BEGIN
        -- Get meaningful updates only - ignore updates that don't change important state
        IF NOT EXISTS (
            SELECT 1
            FROM inserted i
            JOIN deleted d ON i.folio = d.folio
            WHERE i.pagado <> d.pagado
               OR i.cancelado <> d.cancelado
               OR i.mesa <> d.mesa
               OR i.impreso <> d.impreso
               OR i.cuentaenuso <> d.cuentaenuso
        )
        BEGIN
            -- No meaningful changes, so exit without recording anything
            RETURN;
        END
        
        -- For meaningful updates, check if it's a redundant rapid update of the same type
        DECLARE @pagadoChanged BIT = 0,
                @canceladoChanged BIT = 0,
                @mesaChanged BIT = 0,
                @impresoChanged BIT = 0,
                @cuentaenusoChanged BIT = 0;
                
        SELECT TOP 1 
            @pagadoChanged = CASE WHEN i.pagado <> d.pagado THEN 1 ELSE 0 END,
            @canceladoChanged = CASE WHEN i.cancelado <> d.cancelado THEN 1 ELSE 0 END,
            @mesaChanged = CASE WHEN i.mesa <> d.mesa THEN 1 ELSE 0 END,
            @impresoChanged = CASE WHEN i.impreso <> d.impreso THEN 1 ELSE 0 END,
            @cuentaenusoChanged = CASE WHEN i.cuentaenuso <> d.cuentaenuso THEN 1 ELSE 0 END,
            @Ticket = i.folio
        FROM inserted i
        JOIN deleted d ON i.folio = d.folio;
        
        -- Check if we've already recorded this exact type of change recently
        IF EXISTS (
            SELECT 1
            FROM [dbo].[TicketEvents]
            WHERE Folio = @Ticket
            AND OperationType = 'UPDATE'
            AND DATEDIFF(SECOND, CreateDate, GETDATE()) <= 3
            AND (
                (@pagadoChanged = 1 AND EventType = 'PAID') OR
                (@canceladoChanged = 1 AND EventType = 'CANCELED') OR
                (@mesaChanged = 1 AND EventType = 'RENAMED') OR
                (@impresoChanged = 1 AND EventType = 'PRINTED')
            )
        )
        BEGIN
            -- Skip this update as we've already recorded the same type of change very recently
            RETURN;
        END
        
        -- MEJORADO: Detección de Renombra Cuenta usando la columna valores
        IF EXISTS(
            SELECT 1 
            FROM inserted i
            JOIN deleted d ON i.folio = d.folio
            WHERE i.mesa <> d.mesa
            AND EXISTS (
                SELECT 1
                FROM bitacorasistema 
                WHERE evento LIKE '%Renombra Cuenta%'
                AND DATEDIFF(SECOND, fecha, GETDATE()) <= 5
            )
        )
        BEGIN
            -- Esta es una operación de renombrar cuenta confirmada
            
            -- Obtener la información del evento de renombrar cuenta más reciente
            SELECT TOP 1 
                @RenameEventValues = valores
            FROM bitacorasistema 
            WHERE evento LIKE '%Renombra Cuenta%'
            AND DATEDIFF(SECOND, fecha, GETDATE()) <= 5
            ORDER BY fecha DESC;
            
            -- Extraer información clave del campo valores
            -- Extrae la mesa anterior: "Cuenta Anterior: X"
            IF CHARINDEX('Cuenta anterior: ', @RenameEventValues) > 0
            BEGIN
                SET @OldTableName = SUBSTRING(
                    @RenameEventValues,
                    CHARINDEX('Cuenta anterior: ', @RenameEventValues) + 16,
                    CHARINDEX(' Nueva:', @RenameEventValues) - (CHARINDEX('Cuenta anterior: ', @RenameEventValues) + 16)
                );
                SET @OldTableName = LTRIM(RTRIM(@OldTableName));
            END
            
            -- Extrae la mesa nueva: "Nueva: Y"
            IF CHARINDEX('Nueva: ', @RenameEventValues) > 0
            BEGIN
                SET @NewTableName = SUBSTRING(
                    @RenameEventValues,
                    CHARINDEX('Nueva: ', @RenameEventValues) + 7,
                    LEN(@RenameEventValues) - (CHARINDEX('Nueva: ', @RenameEventValues) + 7)
                );
                SET @NewTableName = LTRIM(RTRIM(@NewTableName));
            END
            
            -- Información del ticket que fue renombrado
            SELECT TOP 1 
                @Ticket = i.folio, 
                @OldMesa = d.mesa,
                @Mesa = i.mesa,
                @Order = i.orden,
                @idMesero = i.idMesero,
                @ShiftId = i.idturno,
                @Total = i.total,
                @Descuento = i.descuento,
                @UniqueCode = i.WorkspaceId
            FROM inserted i
            JOIN deleted d ON i.folio = d.folio
            WHERE i.mesa <> d.mesa;
            
            -- Determinar estado del turno
            SET @ShiftState = 'OPEN'; -- Por defecto
            IF EXISTS (
                SELECT 1 FROM turnos WHERE idturno = @ShiftId AND cierre IS NOT NULL
            )
            BEGIN
                SET @ShiftState = 'CLOSED';
            END
            
            -- Obtener el nombre del mesero
            SELECT @NombreMesero = nombre FROM meseros WHERE idMesero = @idMesero;
            
            -- Registrar el evento de renombrar mesa
            INSERT INTO [dbo].[TicketEvents] (
                Folio, 
                TableNumber, 
                OrderNumber, 
                EventType,     -- Usamos RENAMED como tipo específico
                OperationType, -- UPDATE como operación general
                ShiftId,
                ShiftState,
                IsSplitOperation,
                WaiterId,
                WaiterName,
                Total,
                Descuento,
                UniqueCode,
                OriginalTable, -- Almacenamos la mesa original aquí
                SourceEvent,   -- Guardamos el evento fuente
          
                IsProcessed,
                CreateDate
            )
            VALUES (
                @Ticket,        -- Folio del ticket
                @Mesa,          -- Nueva mesa
                @Order,         -- Número de orden
                'RENAMED',      -- Tipo específico: RENAMED
                'UPDATE',       -- Operación general: UPDATE
                @ShiftId,       -- ID del turno
                @ShiftState,    -- Estado del turno
                0,              -- No es una operación de split
                @idMesero,      -- ID del mesero
                @NombreMesero,  -- Nombre del mesero
                @Total,         -- Total
                @Descuento,     -- Descuento
                @UniqueCode,    -- Código único
                @OldMesa,       -- Mesa original (antes del cambio)
                @RenameEventValues, -- Evento fuente completo
           
                0,              -- No procesado inicialmente
                GETDATE()       -- Fecha de creación
            );
            
            -- No seguimos con el procesamiento normal ya que lo hemos manejado específicamente
            RETURN;
        END
        
        -- ENHANCED: Division de cuenta detection, better match with actual POS behavior
        -- We need to detect both when:
        -- 1. A table's usage flag changes (cuentaenuso goes from 1 to 0)
        -- 2. The bitacorasistema has a recent "División de cuenta" entry
        IF EXISTS(
            SELECT 1 
            FROM inserted i
            JOIN deleted d ON i.folio = d.folio
            WHERE i.cuentaenuso = 0 
            AND d.cuentaenuso = 1
            AND EXISTS (
                SELECT 1
                FROM bitacorasistema 
                WHERE evento LIKE '%División de cuenta%'
                AND DATEDIFF(SECOND, fecha, GETDATE()) <= 10  -- Extended time window
            )
        )
        BEGIN
            -- Esta es una operación de división de cuenta confirmada
            
            -- Obtener la información del evento de división de cuenta más reciente
            SELECT TOP 1 
                @SplitEventValues = valores FROM bitacorasistema 
            WHERE evento LIKE '%División de cuenta%'
            AND DATEDIFF(SECOND, fecha, GETDATE()) <= 10
            ORDER BY fecha DESC;
            
            -- Extraer información clave del campo valores
            -- Extrae la mesa original: "Cuenta: X"
            DECLARE @CuentaPos INT = CHARINDEX('Cuenta: ', @SplitEventValues);
            DECLARE @SeAbrieronPos INT = CHARINDEX('Se abrieron', @SplitEventValues);

            IF @CuentaPos > 0 AND @SeAbrieronPos > 0
            BEGIN
                -- Extract everything between "Cuenta: " and "Se abrieron"
                SET @OriginalTable = SUBSTRING(
                    @SplitEventValues,
                    @CuentaPos + 8,  -- Length of 'Cuenta: '
                    @SeAbrieronPos - (@CuentaPos + 8)
                );
                
                -- Clean up any potential trailing characters like periods
                SET @OriginalTable = LTRIM(RTRIM(@OriginalTable));
                
                -- Remove trailing period if present
                IF RIGHT(@OriginalTable, 1) = '.'
                    SET @OriginalTable = LEFT(@OriginalTable, LEN(@OriginalTable) - 1);
            END
            
            -- Extrae la cantidad de cuentas abiertas: "Se abrieron Y cuentas"
            SET @NewTablesCount = CAST(SUBSTRING(
                @SplitEventValues,
                CHARINDEX('Se abrieron ', @SplitEventValues) + 12,
                CHARINDEX(' cuentas', @SplitEventValues) - (CHARINDEX('Se abrieron ', @SplitEventValues) + 12)
            ) AS INT);
            
            -- Extrae los nombres de las nuevas mesas: "( Z )"
            IF CHARINDEX('(', @SplitEventValues) > 0 AND CHARINDEX(')', @SplitEventValues) > 0
            BEGIN
                SET @NewTablesText = SUBSTRING(
                    @SplitEventValues,
                    CHARINDEX('(', @SplitEventValues) + 1,
                    CHARINDEX(')', @SplitEventValues) - CHARINDEX('(', @SplitEventValues) - 1
                );
                SET @NewTablesText = LTRIM(RTRIM(@NewTablesText));
            END
            
            -- Optional debug logging to see what was extracted
            INSERT INTO bitacorasistema (evento, fecha, valores, usuario)
            VALUES (
                'DEBUG - Split Detection', 
                GETDATE(), 
                'Original Value: [' + @SplitEventValues + '] Extracted Table: [' + @OriginalTable + '] New Tables: [' + @NewTablesText + ']',
                'SISTEMA'
            );
            
            -- Información de la mesa original que fue dividida
            SELECT TOP 1 
                @OriginalFolio = i.folio, 
                @OriginalMesa = i.mesa,
                @OriginalOrder = i.orden,
                @idMesero = i.idMesero,
                @ShiftId = i.idturno,
                @Total = i.total,
                @Descuento = i.descuento,
                @Efectivo = i.efectivo,
                @Tarjeta = i.tarjeta,
                @Vales = i.vales,
                @Propina = i.propina,
                @PropinaTarjeta = i.propinatarjeta,
                @UniqueCode = i.WorkspaceId
            FROM inserted i
            JOIN deleted d ON i.folio = d.folio
            WHERE i.cuentaenuso = 0 AND d.cuentaenuso = 1;
            
            -- Determinar el estado del turno
            SET @ShiftState = 'OPEN'; -- Por defecto, asumimos que está abierto
            IF EXISTS (
                SELECT 1 FROM turnos WHERE idturno = @ShiftId AND cierre IS NOT NULL
            )
            BEGIN
                SET @ShiftState = 'CLOSED';
            END
            
            -- Obtener el nombre del mesero
            SELECT @NombreMesero = nombre FROM meseros WHERE idMesero = @idMesero;
            
            -- Get the newly created split bills that should have been inserted
            -- Find newly inserted bills with table names from the split operation
            DECLARE @TempSplitTables TABLE (
                TableName NVARCHAR(50),
                SplitFolio NVARCHAR(100),
                SplitOrder INT,
                SplitUniqueCode NVARCHAR(100)
            );
            
            -- Parse the new table names from the split operation
            DECLARE @pos INT = 1;
            DECLARE @nextSpace INT;
            
            WHILE @pos <= LEN(@NewTablesText)
            BEGIN
                SET @nextSpace = CHARINDEX(' ', @NewTablesText, @pos);
                IF @nextSpace = 0 SET @nextSpace = LEN(@NewTablesText) + 1;
                
                SET @CurrentTable = SUBSTRING(@NewTablesText, @pos, @nextSpace - @pos);
                SET @CurrentTable = LTRIM(RTRIM(@CurrentTable));
                
                IF LEN(@CurrentTable) > 0
                BEGIN
                    -- Query for the newly created bill with this table name
                    -- We look for recently created bills with this specific table name
                    INSERT INTO @TempSplitTables (TableName, SplitFolio, SplitOrder, SplitUniqueCode)
                    SELECT TOP 1 
                        tc.mesa AS TableName,
                        tc.folio AS SplitFolio,
                        tc.orden AS SplitOrder,
                        tc.WorkspaceId AS SplitUniqueCode
                    FROM tempcheques tc WITH (NOLOCK)
                    WHERE tc.mesa = @CurrentTable
                    AND tc.folio <> @OriginalFolio  -- Not the original bill
                    AND DATEDIFF(SECOND, tc.fecha, GETDATE()) <= 30  -- Created recently (within last 30 seconds)
                    ORDER BY tc.fecha DESC;  -- Get the most recent one
                END
                
                SET @pos = @nextSpace + 1;
            END
            
            -- Build the related folios string for the original bill
            SET @RelatedFolios = '';
            SELECT @RelatedFolios = @RelatedFolios + 
                CASE WHEN LEN(@RelatedFolios) > 0 THEN ',' ELSE '' END + 
                SplitFolio
            FROM @TempSplitTables;
            
            -- ORIGINAL BILL: Create ONE record for the original bill with all the relationships
            INSERT INTO [dbo].[TicketEvents] (
                Folio, 
                TableNumber, 
                OrderNumber, 
                EventType, 
                OperationType,
                ShiftId,
                ShiftState,
                IsSplitOperation,
                SplitRole,
                OriginalTable,
                SplitTables,
                SplitFolios,
                ParentFolio,
                WaiterId,
                WaiterName,
                Total,
                Descuento,
                UniqueCode,
                SourceEvent,
       
                IsProcessed,
                CreateDate
            )
            VALUES (
                @OriginalFolio,   -- Folio
                @OriginalMesa,    -- Número de mesa
                @OriginalOrder,   -- Número de orden
                'SPLIT',          -- Tipo de evento
                'SPLIT',          -- Tipo de operación
                @ShiftId,         -- ID del turno
                @ShiftState,      -- Estado del turno
                1,                -- Es una operación de split
                'PARENT',         -- Rol en el split (es la mesa original/padre)
                @OriginalMesa,    -- Mesa original (la misma)
                @NewTablesText,   -- Todas las mesas hijas como texto
                @RelatedFolios,   -- Todos los folios de las mesas hijas
                NULL,             -- No tiene mesa padre porque es la original
                @idMesero,        -- ID del mesero
                @NombreMesero,    -- Nombre del mesero
                @Total,           -- Total
                @Descuento,       -- Descuento
                @UniqueCode,      -- Código único
                @SplitEventValues,-- Evento fuente

                0,                -- No procesado inicialmente
                GETDATE()         -- Fecha de creación
            );
            
            -- CHILD BILLS: Also register each split bill individually
            DECLARE SplitCursor CURSOR FOR 
            SELECT TableName, SplitFolio, SplitOrder, SplitUniqueCode 
            FROM @TempSplitTables;
            
            OPEN SplitCursor;
            FETCH NEXT FROM SplitCursor INTO @CurrentTable, @SplitFolio, @SplitOrder, @SplitUniqueCode;
            
            WHILE @@FETCH_STATUS = 0
            BEGIN
                -- Get the specific financial data for this split bill (if needed)
                SELECT TOP 1 
                    @SplitTotal = total
                FROM tempcheques
                WHERE folio = @SplitFolio;
                
                -- Create an event for this split bill
                INSERT INTO [dbo].[TicketEvents] (
                    Folio, 
                    TableNumber, 
                    OrderNumber, 
                    EventType, 
                    OperationType,
                    ShiftId,
                    ShiftState,
                    IsSplitOperation,
                    SplitRole,
                    OriginalTable,
                    SplitTables,
                    SplitFolios,
                    ParentFolio,
                    WaiterId,
                    WaiterName,
                    Total,
                    Descuento,
                    UniqueCode,
                    SourceEvent,
              
                    IsProcessed,
                    CreateDate
                )
                VALUES (
                    @SplitFolio,      -- Folio of the split bill
                    @CurrentTable,    -- Table name of the split bill
                    @SplitOrder,      -- Order number
                    'OPEN',           -- Initial status is OPEN
                    'SPLIT_NEW',      -- This is a newly created split bill
                    @ShiftId,         -- Same shift ID as the original bill
                    @ShiftState,      -- Same shift state
                    1,                -- This is a split operation
                    'CHILD',          -- This is a child bill
                    @OriginalMesa,    -- The original table
                    NULL,             -- No sub-tables
                    NULL,             -- No sub-folios
                    @OriginalFolio,   -- Parent folio reference
                    @idMesero,        -- Same waiter ID
                    @NombreMesero,    -- Same waiter name
                    @SplitTotal,      -- Total for this split bill
                    @Descuento,       -- Discount (same as original)
                    @SplitUniqueCode, -- Unique code for this split bill
                    @SplitEventValues,-- Source event

                    0,                -- Not processed initially
                    GETDATE()         -- Creation date
                );
                
                FETCH NEXT FROM SplitCursor INTO @CurrentTable, @SplitFolio, @SplitOrder, @SplitUniqueCode;
            END
            
            CLOSE SplitCursor;
            DEALLOCATE SplitCursor;
            
            -- Skip normal update processing as we've handled this special case
            RETURN;
        END
    END

    -- Regular INSERT Operations (new bills)
    IF EXISTS(SELECT * FROM inserted) AND NOT EXISTS(SELECT * FROM deleted)
    BEGIN
        -- Debug logging for insert operations
        INSERT INTO bitacorasistema (evento, fecha, valores, usuario)
        VALUES (
            'DEBUG - Table Names', 
            GETDATE(), 
            'Inserted mesa: ' + ISNULL((SELECT TOP 1 mesa FROM inserted), 'NULL'),
            'SISTEMA'
        );
        
        DECLARE inserted_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT folio, mesa, orden, idMesero, idturno,
               -- Change #1: Prioritize cancelado over pagado
               CASE WHEN cancelado = 1 THEN 'CANCELED' WHEN pagado = 1 THEN 'PAID' ELSE 'OPEN' END AS Status,
               impreso, WorkspaceId, 
               descuento, total, efectivo, tarjeta, vales, propina, propinatarjeta
        FROM inserted;

        OPEN inserted_cursor;
        FETCH NEXT FROM inserted_cursor INTO @Ticket, @Mesa, @Order, @idMesero, @ShiftId, @Status, @Impreso, @UniqueCode, 
                                            @Descuento, @Total, @Efectivo, @Tarjeta, @Vales, @Propina, @PropinaTarjeta;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @OriginalTicket = @Ticket;
            SET @OriginalOrder = @Order;
            SET @IsSplitTable = 0;  -- Default to not a split table

            -- Improved split table detection for complex table names
            IF @Mesa LIKE '%-%'
            BEGIN
                -- Determine if this is likely a split table by examining the pattern
                DECLARE @LastHyphenPos INT = 0;
                DECLARE @PotentialMainTable NVARCHAR(100);
                
                -- Find the last hyphen in the table name
                SET @LastHyphenPos = CHARINDEX('-', REVERSE(@Mesa));
                IF @LastHyphenPos > 0
                BEGIN
                    SET @LastHyphenPos = LEN(@Mesa) - @LastHyphenPos + 1;
                    
                    -- Extract the part before the last hyphen as the potential main table
                    SET @PotentialMainTable = LEFT(@Mesa, @LastHyphenPos - 1);
                    
                    -- Extract the suffix part
                    SET @SplitSuffix = SUBSTRING(@Mesa, @LastHyphenPos + 1, LEN(@Mesa));
                    
                    -- Check if the suffix matches split table pattern (A, B, C, etc. or A-A, B-A)
                    IF @SplitSuffix LIKE '[A-Z]' OR @SplitSuffix LIKE '[A-Z]-[A-Z]'
                    BEGIN
                        SET @IsSplitTable = 1;
                        SET @MainTable = @PotentialMainTable;
                        
                        -- Additional debug logging
                        INSERT INTO bitacorasistema (evento, fecha, valores, usuario)
                        VALUES (
                            'DEBUG - Split Table Detection', 
                            GETDATE(), 
                            'Mesa: [' + @Mesa + '] MainTable: [' + @MainTable + '] Suffix: [' + @SplitSuffix + ']',
                            'SISTEMA'
                        );
                    END
                    ELSE
                    BEGIN
                        SET @IsSplitTable = 0;
                        SET @MainTable = @Mesa;
                        SET @SplitSuffix = NULL;
                    END
                END
                ELSE
                BEGIN
                    SET @IsSplitTable = 0;
                    SET @MainTable = @Mesa;
                    SET @SplitSuffix = NULL;
                END
            END
            ELSE
            BEGIN
                SET @IsSplitTable = 0;
                SET @MainTable = @Mesa;
                SET @SplitSuffix = NULL;
            END

            -- If determined to be a split table, try to find original bill
            IF @IsSplitTable = 1 AND @MainTable IS NOT NULL
            BEGIN
                -- Try to find original bill for this main table
                SELECT TOP 1 @OriginalTicket = folio, @OriginalOrder = orden
                FROM tempcheques WITH (NOLOCK)
                WHERE mesa = @MainTable
                ORDER BY fecha DESC;

                -- Fall back to current values if not found
                IF @OriginalTicket IS NULL SET @OriginalTicket = @Ticket;
                IF @OriginalOrder IS NULL SET @OriginalOrder = @Order;
            END

            -- Get waiter name
            SELECT @NombreMesero = nombre FROM meseros WHERE idMesero = @idMesero;

            -- Check shift state
            SET @ShiftState = 'OPEN'; -- Default
            IF EXISTS (
                SELECT 1 FROM turnos WHERE idturno = @ShiftId AND cierre IS NOT NULL
            )
            BEGIN
                SET @ShiftState = 'CLOSED';
            END

            -- Insert basic ticket event
            INSERT INTO [dbo].[TicketEvents] (
                Folio, 
                TableNumber, 
                OrderNumber, 
                EventType, 
                OperationType,
                ShiftId,
                ShiftState,
                IsSplitOperation,
                SplitRole,
                OriginalTable,
                WaiterId,
                WaiterName,
                Total,
                Descuento,
                UniqueCode,
                IsProcessed,
                CreateDate
            )
            VALUES (
                @Ticket,           -- Folio
                @Mesa,             -- Table number
                @Order,            -- Order number
                @Status,           -- Event type (OPEN, PAID, etc.)
                'INSERT',          -- Operation type
                @ShiftId,          -- Shift ID
                @ShiftState,       -- Shift state
                @IsSplitTable,     -- Is this a split table?
                CASE WHEN @IsSplitTable = 1 THEN 'CHILD' ELSE NULL END, -- Split role
                CASE WHEN @IsSplitTable = 1 THEN @MainTable ELSE NULL END, -- Original table
                @idMesero,         -- Waiter ID
                @NombreMesero,     -- Waiter name
                @Total,            -- Total
                @Descuento,        -- Discount
                @UniqueCode,       -- Unique code
                0,                 -- Not processed initially
                GETDATE()          -- Creation date
            );
            
            -- If this is a split table based on naming convention, and we didn't process it above,
            -- we need to establish the relationship with the original bill
            DECLARE @NewEventID INT = SCOPE_IDENTITY();
            
            IF @IsSplitTable = 1 AND @MainTable IS NOT NULL AND @SplitSuffix IS NOT NULL
            BEGIN
                -- Get the original table's folio
                DECLARE @OrigBillFolio NVARCHAR(100);
                SELECT TOP 1 @OrigBillFolio = folio 
                FROM tempcheques WITH (NOLOCK)
                WHERE mesa = @MainTable 
                AND cuentaenuso = 1  -- Must be in use
                ORDER BY fecha DESC;
                
                IF @OrigBillFolio IS NOT NULL
                BEGIN
                    -- Update our just-inserted record to mark it as a split bill
                    UPDATE [dbo].[TicketEvents]
                    SET OperationType = 'SPLIT_NEW',
                        ParentFolio = @OrigBillFolio,
                        EventType = 'OPEN',
                        IsSplitOperation = 1,
                        SplitRole = 'CHILD'
                    WHERE ID = @NewEventID;
                    
                    -- Also insert a record for the original bill to mark it as split
                    -- Check if we already have a SPLIT event for the original bill
                    IF NOT EXISTS (
                        SELECT 1 
                        FROM [dbo].[TicketEvents]
                        WHERE Folio = @OrigBillFolio
                        AND EventType = 'SPLIT'
                        AND DATEDIFF(SECOND, CreateDate, GETDATE()) <= 30
                    )
                    BEGIN
                        -- Get original bill details
                        DECLARE @OrigBillTotal MONEY, @OrigBillDiscount MONEY, @OrigBillUniqueCode NVARCHAR(100);
                        
                        SELECT TOP 1
                            @OrigBillTotal = total,
                            @OrigBillDiscount = descuento,
                            @OrigBillUniqueCode = WorkspaceId
                        FROM tempcheques
                        WHERE folio = @OrigBillFolio;
                    
                        -- Insert a record for the original bill to mark it as split
                        INSERT INTO [dbo].[TicketEvents] (
                            Folio, 
                            TableNumber, 
                            OrderNumber, 
                            EventType,
                            OperationType,
                            ShiftId,
                            ShiftState,
                            IsSplitOperation,
                            SplitRole,
                            OriginalTable,
                            SplitTables,
                            SplitFolios,
                            ParentFolio,
                            WaiterId,
                            WaiterName,
                            Total,
                            Descuento,
                            UniqueCode,
                            IsProcessed,
                            CreateDate
                        )
                        VALUES (
                            @OrigBillFolio,   -- Original bill folio
                            @MainTable,       -- Original table number
                            @Order,           -- Order number
                            'SPLIT',          -- Event type (SPLIT)
                            'SPLIT',          -- Operation type
                            @ShiftId,         -- Shift ID
                            @ShiftState,      -- Shift state
                            1,                -- Is a split operation
                            'PARENT',         -- Split role (parent)
                            @MainTable,       -- Original table
                            @Mesa,            -- Split table
                            @Ticket,          -- Split bill folio
                            NULL,             -- No parent folio (this is the parent)
                            @idMesero,        -- Waiter ID
                            @NombreMesero,    -- Waiter name
                            @OrigBillTotal,   -- Total
                            @OrigBillDiscount,-- Discount
                            @OrigBillUniqueCode,-- Unique code
                            0,                -- Not processed initially
                            GETDATE()         -- Creation date
                        );
                    END
                    ELSE
                    BEGIN
                        -- Update the existing SPLIT event for the original bill to include this new split
                        DECLARE @ExistingSplitEvent INT;
                        SELECT TOP 1 @ExistingSplitEvent = ID
                        FROM [dbo].[TicketEvents]
                        WHERE Folio = @OrigBillFolio
                        AND EventType = 'SPLIT'
                        ORDER BY CreateDate DESC;
                        
                        -- Update the SplitTables and SplitFolios fields to include this new split
                        IF @ExistingSplitEvent IS NOT NULL
                        BEGIN
                            UPDATE [dbo].[TicketEvents]
                            SET SplitTables = CASE 
                                    WHEN SplitTables IS NULL THEN @Mesa
                                    WHEN CHARINDEX(@Mesa, SplitTables) > 0 THEN SplitTables  -- Already includes this table
                                    ELSE SplitTables + ', ' + @Mesa  -- Add this table
                                END,
                                SplitFolios = CASE
                                    WHEN SplitFolios IS NULL THEN @Ticket
                                    WHEN CHARINDEX(@Ticket, SplitFolios) > 0 THEN SplitFolios  -- Already includes this folio
                                    ELSE SplitFolios + ',' + @Ticket  -- Add this folio
                                END
                            WHERE ID = @ExistingSplitEvent;
                        END
                    END
                END
            END

            FETCH NEXT FROM inserted_cursor INTO @Ticket, @Mesa, @Order, @idMesero, @ShiftId, @Status, @Impreso, @UniqueCode,
                                               @Descuento, @Total, @Efectivo, @Tarjeta, @Vales, @Propina, @PropinaTarjeta;
        END
        CLOSE inserted_cursor;
        DEALLOCATE inserted_cursor;
    END

    -- UPDATE Operations (that weren't filtered out above)
    ELSE IF EXISTS(SELECT * FROM inserted) AND EXISTS(SELECT * FROM deleted)
    BEGIN
        DECLARE update_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT i.folio, i.mesa, i.orden, i.idMesero, i.idturno,
               -- Change #2: Prioritize cancelado over pagado
               CASE WHEN i.cancelado = 1 THEN 'CANCELED' WHEN i.pagado = 1 THEN 'PAID' ELSE 'OPEN' END AS Status,
               i.impreso, d.folio, d.mesa, d.orden,
               -- Change #3: Prioritize cancelado over pagado in PrevStatus
               CASE WHEN d.cancelado = 1 THEN 'CANCELED' WHEN d.pagado = 1 THEN 'PAID' ELSE 'OPEN' END AS PrevStatus,
               i.WorkspaceId,
               i.descuento, i.total, i.efectivo, i.tarjeta, i.vales, i.propina, i.propinatarjeta
        FROM inserted i
        JOIN deleted d ON i.folio = d.folio
        -- Only log significant changes 
        WHERE i.pagado <> d.pagado
           OR i.cancelado <> d.cancelado
           OR i.mesa <> d.mesa
           OR i.impreso <> d.impreso;

        OPEN update_cursor;
        FETCH NEXT FROM update_cursor INTO @Ticket, @Mesa, @Order, @idMesero, @ShiftId, @Status, @Impreso, 
                                          @OldTicket, @OldMesa, @OldOrder, @PrevStatus, @UniqueCode,
                                          @Descuento, @Total, @Efectivo, @Tarjeta, @Vales, @Propina, @PropinaTarjeta;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            SELECT @NombreMesero = nombre FROM meseros WHERE idMesero = @idMesero;
            
            -- Determine shift state
            SET @ShiftState = 'OPEN'; -- Default
            IF EXISTS (
                SELECT 1 FROM turnos WHERE idturno = @ShiftId AND cierre IS NOT NULL
            )
            BEGIN
                SET @ShiftState = 'CLOSED';
            END

            -- IMPORTANT: Enhanced logging for PAID status changes
            IF @Status = 'PAID' AND @PrevStatus <> 'PAID'
            BEGIN
                -- Log this payment to system log for debugging
                INSERT INTO bitacorasistema (evento, fecha, valores, usuario)
                VALUES (
                    'Cuenta Pagada', 
                    GETDATE(), 
                    'Cuenta: ' + @Ticket + ' Total: ' + CAST(@Total AS NVARCHAR(50)) + 
                    ' Efectivo: ' + CAST(@Efectivo AS NVARCHAR(50)) + 
                    ' Tarjeta: ' + CAST(@Tarjeta AS NVARCHAR(50)) + 
                    ' Vales: ' + CAST(@Vales AS NVARCHAR(50)),
                    'SISTEMA'
                );
            END

            -- Determine specific event type for this update
            DECLARE @UpdateEventType NVARCHAR(20) = @Status;
            IF @Mesa <> @OldMesa
                SET @UpdateEventType = 'RENAMED';
            ELSE IF @Impreso <> 0 AND (@PrevStatus = 'OPEN' OR @PrevStatus IS NULL)
                SET @UpdateEventType = 'PRINTED';

            -- Change #4: Prioritize cancellation over payment
            -- First check for cancellation
            IF @Status = 'CANCELED' AND @PrevStatus <> 'CANCELED'
            BEGIN
                SET @UpdateEventType = 'CANCELED';
            END
            -- Then check for payment
            ELSE IF @Status = 'PAID' AND @PrevStatus <> 'PAID'
            BEGIN
                SET @UpdateEventType = 'PAID';
            END

            INSERT INTO [dbo].[TicketEvents] (
                Folio, 
                TableNumber, 
                OrderNumber, 
                EventType, 
                OperationType,
                ShiftId,
                ShiftState,
                IsSplitOperation,
                WaiterId,
                WaiterName,
                Total,
                Descuento,
                UniqueCode,
                IsProcessed,
                CreateDate
            )
            VALUES (
                @Ticket,           -- Current folio
                @Mesa,             -- Current table
                @Order,            -- Order number
                @UpdateEventType,  -- Specific event type (RENAMED, PRINTED, PAID, etc.)
                'UPDATE',          -- Operation type
                @ShiftId,          -- Shift ID
                @ShiftState,       -- Shift state
                0,                 -- Not a split operation
                @idMesero,         -- Waiter ID
                @NombreMesero,     -- Waiter name
                @Total,            -- Total
                @Descuento,        -- Discount
                @UniqueCode,       -- Unique code
                0,                 -- Not processed initially
                GETDATE()          -- Creation date
            );

            FETCH NEXT FROM update_cursor INTO @Ticket, @Mesa, @Order, @idMesero, @ShiftId, @Status, @Impreso, 
                                          @OldTicket, @OldMesa, @OldOrder, @PrevStatus, @UniqueCode,
                                          @Descuento, @Total, @Efectivo, @Tarjeta, @Vales, @Propina, @PropinaTarjeta;
        END
        CLOSE update_cursor;
        DEALLOCATE update_cursor;
    END

    -- DELETE Operations with enhanced shift closure detection
    ELSE IF EXISTS(SELECT * FROM deleted) AND NOT EXISTS(SELECT * FROM inserted)
    BEGIN
        -- First, check if the current deletions are part of a shift closure
        SET @IsShiftClosure = 0;
        
        -- Count how many tickets are being deleted at once - bulk deletions are a sign of shift closure
        SELECT @DeleteCount = COUNT(*) FROM deleted;
        
        -- Get a sample deleted ticket to find its shift
        SELECT TOP 1 @Ticket = d.folio, @ShiftId = d.idturno
        FROM deleted d;
        
        -- Only perform shift closure detection if we have a significant number of deletes at once
        IF @DeleteCount > 3
        BEGIN
            -- Check for a recently closed shift within last 10 minutes
            SET @ClosingShiftId = NULL;
            SELECT TOP 1 @ClosingShiftId = idturno
            FROM turnos WITH (NOLOCK)
            WHERE cierre IS NOT NULL
            AND cierre >= DATEADD(MINUTE, -10, GETDATE())
            ORDER BY cierre DESC;
            
            IF @ClosingShiftId IS NOT NULL
            BEGIN
                SET @ShiftId = @ClosingShiftId;
                SET @IsShiftClosure = 1;
            END
        END
        
        -- If we determined this is a shift closure, still log it but mark it accordingly
        IF @IsShiftClosure = 1
        BEGIN
            -- Create a single summary record for this shift closure
            DECLARE @ShiftClosureTime DATETIME = GETDATE();
            
            INSERT INTO [dbo].[TicketEvents] (
                Folio, 
                TableNumber,       -- Added TableNumber column that was missing
                EventType, 
                OperationType,
                ShiftId,
                ShiftState,
                IsProcessed,
                CreateDate,
                Response
            )
            VALUES (
                'SHIFT_CLOSURE',   -- Special folio to indicate shift closure
                'SYSTEM',          -- Added a non-NULL value for TableNumber
                'SHIFT_CLOSURE',   -- Event type
                'SHIFT_CLOSURE',   -- Operation type
                @ShiftId,          -- Shift ID
                'CLOSED',          -- Shift state (it's closing)
                1,                 -- Mark as processed immediately (no need to send to webhook)
                @ShiftClosureTime, -- Creation date
                'Shift closure detected - ' + CAST(@DeleteCount AS NVARCHAR(10)) + ' bills affected' -- Response message
            );
        END
        
        -- Continue with logging individual deletions, even during shift closure
        DECLARE deleted_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT folio, mesa, orden, idMesero, idturno,
               -- Change #5: Prioritize cancelado over pagado
               CASE WHEN cancelado = 1 THEN 'CANCELED' WHEN pagado = 1 THEN 'PAID' ELSE 'OPEN' END AS Status,
               WorkspaceId
        FROM deleted;

        OPEN deleted_cursor;
        FETCH NEXT FROM deleted_cursor INTO @Ticket, @Mesa, @Order, @idMesero, @ShiftId, @Status, @UniqueCode;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            SELECT @NombreMesero = nombre FROM meseros WHERE idMesero = @idMesero;
            
            -- Determine shift state
            SET @ShiftState = 'OPEN'; -- Default
            IF EXISTS (
                SELECT 1 FROM turnos WHERE idturno = @ShiftId AND cierre IS NOT NULL
            )
            BEGIN
                SET @ShiftState = 'CLOSED';
            END

            -- For shift closure deletions, mark them so they won't be processed
            -- For regular deletions, leave them for normal processing
            INSERT INTO [dbo].[TicketEvents] (
                Folio, 
                TableNumber, 
                OrderNumber, 
                EventType, 
                OperationType,
                ShiftId,
                ShiftState,
                IsSplitOperation,
                WaiterId,
                WaiterName,
                UniqueCode,
                IsProcessed,
                CreateDate,
                Response
            )
            VALUES (
                @Ticket,           -- Folio
                @Mesa,             -- Table
                @Order,            -- Order number
                'DELETED',         -- Event type
                'DELETE',          -- Operation type
                @ShiftId,          -- Shift ID
                @ShiftState,       -- Shift state
                0,                 -- Not a split operation
                @idMesero,         -- Waiter ID
                @NombreMesero,     -- Waiter name
                @UniqueCode,       -- Unique code
                CASE WHEN @IsShiftClosure = 1 THEN 1 ELSE 0 END, -- Mark as processed if it's part of shift closure
                GETDATE(),         -- Creation date
                CASE WHEN @IsShiftClosure = 1 THEN 'Filtered: Part of shift closure' ELSE NULL END -- Response message
            );

            FETCH NEXT FROM deleted_cursor INTO @Ticket, @Mesa, @Order, @idMesero, @ShiftId, @Status, @UniqueCode;
        END
        CLOSE deleted_cursor;
        DEALLOCATE deleted_cursor;
    END
END
GO

--tempcheqdet
CREATE TRIGGER [dbo].[trgComandaActualizado]
ON [dbo].[tempcheqdet]
AFTER INSERT, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    -- Variable declarations
    DECLARE @FolioDet NVARCHAR(100),
            @IdProducto NVARCHAR(100),
            @Movimiento NVARCHAR(100),
            @Cantidad NVARCHAR(100),
            @Nombre NVARCHAR(100),
            @Precio NVARCHAR(100),
            @Descuento NVARCHAR(100),
            @Hora NVARCHAR(100),
            @Modificador NVARCHAR(100),
            @Mesa NVARCHAR(100),
            @NombreMesero NVARCHAR(100),
            @IdMesero NVARCHAR(100),
            @ClasificacionTexto NVARCHAR(50),
            @Operation NVARCHAR(10),
            @IsSplitTable BIT,
            @MainTable NVARCHAR(100),
            @SplitSuffix NVARCHAR(10),
            @Orden NVARCHAR(100),
            @OriginalFolio NVARCHAR(100),
            @OriginalOrden NVARCHAR(100),
            @ShiftId INT,
            @UniqueCode NVARCHAR(100),
            @UniqueBillCode NVARCHAR(100);

    -- Handle INSERT Operations
    IF EXISTS(SELECT * FROM inserted) AND NOT EXISTS(SELECT * FROM deleted)
    BEGIN
        -- Declare cursor over inserted rows
        DECLARE inserted_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT 
            chd.foliodet, 
            chd.idproducto,
            chd.movimiento, 
            chd.cantidad, 
            p.descripcion, 
            chd.precio,
            chd.descuento,
            chd.hora, 
            chd.modificador,
            ch.mesa,
            m.nombre,
            m.idmesero,
            ch.orden,
            ch.idturno,
            chd.WorkspaceId,      -- Product's unique code
            ch.WorkspaceId,       -- Bill's unique code
            CASE 
                WHEN g.clasificacion = 1 THEN 'BEVERAGE'
                WHEN g.clasificacion = 2 THEN 'FOOD'
                WHEN g.clasificacion = 3 THEN 'OTHER'
                ELSE 'UNKNOWN'
            END AS ClasificacionTexto
        FROM 
            inserted AS chd
            INNER JOIN productos AS p ON p.idproducto = chd.idproducto
            INNER JOIN tempcheques AS ch ON ch.folio = chd.foliodet
            INNER JOIN meseros AS m ON chd.idmeseroproducto = m.idmesero
            INNER JOIN grupos AS g ON g.idgrupo = p.idgrupo;

        OPEN inserted_cursor;
        FETCH NEXT FROM inserted_cursor INTO 
            @FolioDet, @IdProducto, @Movimiento, @Cantidad, @Nombre, @Precio, @Descuento, 
            @Hora, @Modificador, @Mesa, @NombreMesero, @IdMesero, @Orden, @ShiftId, 
            @UniqueCode, @UniqueBillCode, @ClasificacionTexto;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            -- Default original folio and orden to current values
            SET @OriginalFolio = @FolioDet;
            SET @OriginalOrden = @Orden;

            -- Determine if the table is a split table
            IF @Mesa LIKE '%-%' 
            BEGIN
                IF @Mesa LIKE '[0-9]%-[A-Z]' -- Simple pattern for split tables like '2-A'
                BEGIN
                    SET @IsSplitTable = 1;
                    SET @MainTable = LEFT(@Mesa, CHARINDEX('-', @Mesa) - 1);
                    SET @SplitSuffix = SUBSTRING(@Mesa, CHARINDEX('-', @Mesa) + 1, LEN(@Mesa));

                    -- Attempt to get original folio and orden from tempcheques where mesa = @MainTable
                    SELECT TOP 1 @OriginalFolio = folio, @OriginalOrden = orden
                    FROM tempcheques WITH (NOLOCK)
                    WHERE mesa = @MainTable
                    ORDER BY fecha DESC;

                    IF @OriginalFolio IS NULL OR @OriginalOrden IS NULL
                    BEGIN
                        -- If unable to find original folio/orden, default to current
                        SET @OriginalFolio = @FolioDet;
                        SET @OriginalOrden = @Orden;
                    END
                END
                ELSE -- Assume it's a special table
                BEGIN
                    SET @IsSplitTable = 0;
                    SET @MainTable = @Mesa;
                    SET @SplitSuffix = NULL;
                END
            END
            ELSE
            BEGIN
                SET @IsSplitTable = 0;
                SET @MainTable = @Mesa;
                SET @SplitSuffix = NULL;
            END

            -- Insert into ProductEvents
            INSERT INTO [dbo].[ProductEvents] (
                Folio, 
                TableNumber,
                OrderNumber,
                Status,
                WaiterId,
                WaiterName,
                IsSplitTable,
                MainTable,
                SplitSuffix,
                ShiftId,
                UniqueCode,                -- Product's unique code
                uniqueBillCodeFromPos,     -- Bill's unique code
                
                -- Campos específicos de productos
                IdProducto,
                NombreProducto,
                Movimiento,
                Cantidad,
                Precio, 
                Descuento,
                Hora,
                Modificador,
                Clasificacion,
                
                OperationType
            )
            VALUES (
                @OriginalFolio,
                @Mesa,
                @OriginalOrden,
                'PRODUCT_ADDED',
                @IdMesero,
                @NombreMesero,
                @IsSplitTable,
                @MainTable,
                @SplitSuffix,
                @ShiftId,
                @UniqueCode,                -- Product's WorkspaceId
                @UniqueBillCode,           -- Bill's WorkspaceId
                
                @IdProducto,
                @Nombre,
                @Movimiento,
                CAST(@Cantidad AS DECIMAL(18,4)),
                CAST(@Precio AS DECIMAL(18,2)),
                CAST(@Descuento AS DECIMAL(18,2)),
                @Hora,
                @Modificador,
                @ClasificacionTexto,
                
                'INSERT'
            );

            FETCH NEXT FROM inserted_cursor INTO 
                @FolioDet, @IdProducto, @Movimiento, @Cantidad, @Nombre, @Precio, @Descuento, 
                @Hora, @Modificador, @Mesa, @NombreMesero, @IdMesero, @Orden, @ShiftId, 
                @UniqueCode, @UniqueBillCode, @ClasificacionTexto;
        END

        CLOSE inserted_cursor;
        DEALLOCATE inserted_cursor;
    END

    -- Handle DELETE Operations
    IF EXISTS(SELECT * FROM deleted) AND NOT EXISTS(SELECT * FROM inserted)
    BEGIN
        -- IMPROVED SHIFT CLOSURE DETECTION
        DECLARE @IsShiftClosure BIT = 0;
        DECLARE @DeleteCount INT;
        DECLARE @ClosingShiftId INT = NULL;
        DECLARE @DistinctBills INT;
        DECLARE @DeletedFolio NVARCHAR(100);
        DECLARE @ShiftClosureDetected BIT = 0;
        
        -- Count how many records and distinct bills are being deleted at once
        SELECT 
            @DeleteCount = COUNT(*),
            @DistinctBills = COUNT(DISTINCT foliodet)
        FROM deleted;
        
        -- Get a sample deleted record to find its shift
        SELECT TOP 1 @DeletedFolio = d.foliodet 
        FROM deleted d;
        
        -- Try to get the shift ID for this folio
        SELECT TOP 1 @ShiftId = ch.idturno
        FROM tempcheques ch WITH (NOLOCK)
        WHERE ch.folio = @DeletedFolio;
        
        -- MULTIPLE APPROACHES TO DETECT SHIFT CLOSURES
        
        -- 1. Check if there's a SHIFT_CLOSURE record in TicketEvents within last 30 seconds
        IF EXISTS (
            SELECT 1 
            FROM [dbo].[TicketEvents] WITH (NOLOCK)
            WHERE EventType = 'SHIFT_CLOSURE'
            AND OperationType = 'SHIFT_CLOSURE'
            AND CreateDate >= DATEADD(SECOND, -30, GETDATE())
        )
        BEGIN
            SET @IsShiftClosure = 1;
            SET @ShiftClosureDetected = 1;
            -- No ShiftLog table needed
        END
        
        -- 2. Check specifically for closing records in TurnoEvents
        IF @ShiftClosureDetected = 0
        BEGIN
            IF EXISTS (
                SELECT 1 
                FROM [dbo].[TurnoEvents] WITH (NOLOCK)
                WHERE Status = 'TURNO_UPDATED'
                AND Cierre IS NOT NULL
                AND CreateDate >= DATEADD(MINUTE, -10, GETDATE())
            )
            BEGIN
                SET @IsShiftClosure = 1;
                SET @ShiftClosureDetected = 1;
                
                -- Get the most recent closing shift ID
                SELECT TOP 1 @ClosingShiftId = IdTurno
                FROM [dbo].[TurnoEvents] WITH (NOLOCK)
                WHERE Status = 'TURNO_UPDATED'
                AND Cierre IS NOT NULL
                AND CreateDate >= DATEADD(MINUTE, -10, GETDATE())
                ORDER BY CreateDate DESC;
                
                -- No ShiftLog table needed
            END
        END
        
        -- 3. Check for significant bulk ticket deletions which are also a sign of shift closure
        DECLARE @RecentDeleteCount INT = 0;
        
        IF @ShiftClosureDetected = 0
        BEGIN
            SELECT @RecentDeleteCount = COUNT(*)
            FROM [dbo].[TicketEvents] WITH (NOLOCK)
            WHERE EventType = 'DELETED'
            AND OperationType = 'DELETE'
            AND CreateDate >= DATEADD(SECOND, -30, GETDATE());
              
            IF @RecentDeleteCount > 8
            BEGIN
                SET @IsShiftClosure = 1;
                SET @ShiftClosureDetected = 1;
                -- No ShiftLog table needed
            END
        END
        
        -- 4. Fallback to heuristic based on number of products and distinct bills
        IF @ShiftClosureDetected = 0
        BEGIN
            -- If deleting more than 10 products across 3+ different bills, likely a shift closure
            IF @DeleteCount > 10 AND @DistinctBills > 2
            BEGIN
                SET @IsShiftClosure = 1;
                -- No ShiftLog table needed
            END
            -- If it's a high number of deletions even on one bill, consider it suspicious
            ELSE IF @DeleteCount > 30
            BEGIN
                SET @IsShiftClosure = 1;
                -- No ShiftLog table needed
            END
        END
        
        -- 5. Check for recent products marked as SHIFT_CLOSURE in ProductEvents
        DECLARE @RecentShiftClosureProducts INT = 0;
        
        IF @ShiftClosureDetected = 0
        BEGIN
            SELECT @RecentShiftClosureProducts = COUNT(*)
            FROM [dbo].[ProductEvents] WITH (NOLOCK)
            WHERE Status = 'SHIFT_CLOSURE'
            AND CreateDate >= DATEADD(MINUTE, -5, GETDATE());
              
            IF @RecentShiftClosureProducts > 0
            BEGIN
                SET @IsShiftClosure = 1;
                SET @ShiftClosureDetected = 1;
                -- No ShiftLog table needed
            END
        END
        
        -- If shift closure detected, create one special record to mark these filtered deletions
        IF @IsShiftClosure = 1
        BEGIN
            -- Create a summary record for these shift-closure related deletions
            INSERT INTO [dbo].[ProductEvents] (
                Folio, 
                TableNumber,
                OrderNumber,
                Status,
                WaiterId,
                WaiterName,
                ShiftId,
                
                -- Special fields for shift closure
                IdProducto,
                NombreProducto,
                Cantidad,
                
                OperationType,
                Response,
                IsSuccess,
                UpdateDate
            )
            VALUES (
                'SHIFT_CLOSURE',  -- Special folio to mark shift closure
                NULL,             -- No table number
                NULL,             -- No order number
                'SHIFT_CLOSURE',  -- Special status
                NULL,             -- No waiter ID
                NULL,             -- No waiter name
                @ShiftId,         -- The shift ID if available
                
                'BULK',           -- Special product ID
                'Bulk Product Deletions', -- Description
                @DeleteCount,     -- How many products were deleted
                
                'SHIFT_CLOSURE',  -- Special operation type
                'Filtered ' + CAST(@DeleteCount AS VARCHAR) + ' product deletions from ' + 
                CAST(@DistinctBills AS VARCHAR) + ' bills during shift closure',
                1,                -- Mark as successfully processed
                GETDATE()         -- Current timestamp
            );
            
            -- Exit the trigger without processing individual deletions
            RETURN;
        END
        
        -- If we get here, this is a normal user-initiated deletion, so proceed with the original logic
        -- Declare cursor over deleted rows
        DECLARE deleted_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT 
            chd.foliodet, 
            chd.idproducto,
            chd.movimiento, 
            chd.cantidad, 
            p.descripcion, 
            chd.precio,
            chd.descuento,
            chd.hora, 
            chd.modificador,
            ch.mesa,
            m.nombre,
            m.idmesero,
            ch.orden,
            ch.idturno,
            chd.WorkspaceId,      -- Product's unique code
            ch.WorkspaceId,       -- Bill's unique code
            CASE 
                WHEN g.clasificacion = 1 THEN 'BEVERAGE'
                WHEN g.clasificacion = 2 THEN 'FOOD'
                WHEN g.clasificacion = 3 THEN 'OTHER'
                ELSE 'UNKNOWN'
            END AS ClasificacionTexto
        FROM 
            deleted AS chd
            INNER JOIN productos AS p ON p.idproducto = chd.idproducto
            INNER JOIN tempcheques AS ch ON ch.folio = chd.foliodet
            INNER JOIN meseros AS m ON chd.idmeseroproducto = m.idmesero
            INNER JOIN grupos AS g ON g.idgrupo = p.idgrupo;

        OPEN deleted_cursor;
        FETCH NEXT FROM deleted_cursor INTO 
            @FolioDet, @IdProducto, @Movimiento, @Cantidad, @Nombre, @Precio, @Descuento, 
            @Hora, @Modificador, @Mesa, @NombreMesero, @IdMesero, @Orden, @ShiftId, 
            @UniqueCode, @UniqueBillCode, @ClasificacionTexto;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            -- Default original folio and orden to current values
            SET @OriginalFolio = @FolioDet;
            SET @OriginalOrden = @Orden;

            -- Determine if the table is a split table
            IF @Mesa LIKE '%-%' 
            BEGIN
                IF @Mesa LIKE '[0-9]%-[A-Z]' -- Simple pattern for split tables like '2-A'
                BEGIN
                    SET @IsSplitTable = 1;
                    SET @MainTable = LEFT(@Mesa, CHARINDEX('-', @Mesa) - 1);
                    SET @SplitSuffix = SUBSTRING(@Mesa, CHARINDEX('-', @Mesa) + 1, LEN(@Mesa));

                    -- Attempt to get original folio and orden from tempcheques where mesa = @MainTable
                    SELECT TOP 1 @OriginalFolio = folio, @OriginalOrden = orden
                    FROM tempcheques WITH (NOLOCK)
                    WHERE mesa = @MainTable
                    ORDER BY fecha DESC;

                    IF @OriginalFolio IS NULL OR @OriginalOrden IS NULL
                    BEGIN
                        -- If unable to find original folio/orden, default to current
                        SET @OriginalFolio = @FolioDet;
                        SET @OriginalOrden = @Orden;
                    END
                END
                ELSE -- Assume it's a special table
                BEGIN
                    SET @IsSplitTable = 0;
                    SET @MainTable = @Mesa;
                    SET @SplitSuffix = NULL;
                END
            END
            ELSE
            BEGIN
                SET @IsSplitTable = 0;
                SET @MainTable = @Mesa;
                SET @SplitSuffix = NULL;
            END

            -- Insert into ProductEvents
            INSERT INTO [dbo].[ProductEvents] (
                Folio, 
                TableNumber,
                OrderNumber,
                Status,
                WaiterId,
                WaiterName,
                IsSplitTable,
                MainTable,
                SplitSuffix,
                ShiftId,
                UniqueCode,                -- Product's unique code
                uniqueBillCodeFromPos,     -- Bill's unique code
                
                -- Campos específicos de productos
                IdProducto,
                NombreProducto,
                Movimiento,
                Cantidad,
                Precio, 
                Descuento,
                Hora,
                Modificador,
                Clasificacion,
                
                OperationType
            )
            VALUES (
                @OriginalFolio,
                @Mesa,
                @OriginalOrden,
                'PRODUCT_REMOVED',
                @IdMesero,
                @NombreMesero,
                @IsSplitTable,
                @MainTable,
                @SplitSuffix,
                @ShiftId,
                @UniqueCode,                -- Product's WorkspaceId
                @UniqueBillCode,           -- Bill's WorkspaceId
                
                @IdProducto,
                @Nombre,
                @Movimiento,
                CAST(@Cantidad AS DECIMAL(18,4)),
                CAST(@Precio AS DECIMAL(18,2)),
                CAST(@Descuento AS DECIMAL(18,2)),
                @Hora,
                @Modificador,
                @ClasificacionTexto,
                
                'DELETE'
            );

            FETCH NEXT FROM deleted_cursor INTO 
                @FolioDet, @IdProducto, @Movimiento, @Cantidad, @Nombre, @Precio, @Descuento, 
                @Hora, @Modificador, @Mesa, @NombreMesero, @IdMesero, @Orden, @ShiftId, 
                @UniqueCode, @UniqueBillCode, @ClasificacionTexto;
        END

        CLOSE deleted_cursor;
        DEALLOCATE deleted_cursor;
    END
END
GO
ALTER TABLE [dbo].[tempcheqdet] WITH NOCHECK
  ADD CONSTRAINT [FK_tempcheqdet_productos] FOREIGN KEY ([idproducto]) REFERENCES [dbo].[productos] ([idproducto]) ON UPDATE CASCADE
GO

--tempchequespagos
CREATE TRIGGER [dbo].[trgChequePagoActualizado]
ON [dbo].[tempchequespagos]
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Folio NVARCHAR(100),
            @OriginalFolio NVARCHAR(100),
            @IdFormaDePago NVARCHAR(100),
            @Importe NVARCHAR(100),
            @Propina NVARCHAR(100),
            @Referencia NVARCHAR(100),
            @UniqueCode NVARCHAR(100),
            @UniqueBillCodePos NVARCHAR(100), -- Added this to store bill's unique code
            @Mesa NVARCHAR(100),
            @IsSplitTable BIT,
            @MainTable NVARCHAR(100),
            @SplitSuffix NVARCHAR(10),
            @Orden INT,
            @OriginalOrden INT,
            @Method INT;             -- Added to store the payment method type

    IF EXISTS(SELECT * FROM inserted) -- It's an INSERT
    BEGIN
        -- Process each row in inserted
        DECLARE inserted_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT 
            tp.folio, 
            tp.idformadepago, 
            tp.importe, 
            tp.propina, 
            tp.referencia, 
            tp.WorkspaceId
        FROM inserted tp;

        OPEN inserted_cursor;
        FETCH NEXT FROM inserted_cursor INTO @Folio, @IdFormaDePago, @Importe, @Propina, @Referencia, @UniqueCode;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            -- Initialize original folio and orden
            SET @OriginalFolio = @Folio;
            SET @OriginalOrden = NULL; -- Will retrieve from tempcheques
            SET @UniqueBillCodePos = NULL; -- Initialize bill's unique code

            -- Retrieve mesa, orden, and WorkspaceId (unique code) from tempcheques
            SELECT 
                @Mesa = tc.mesa, 
                @Orden = tc.orden,
                @UniqueBillCodePos = tc.WorkspaceId -- Get the bill's unique code
            FROM tempcheques tc
            WHERE tc.folio = @Folio;
            
            -- Get the payment method type from formasdepago
            SELECT @Method = fd.tipo
            FROM formasdepago fd
            WHERE fd.idformadepago = @IdFormaDePago;

            SET @OriginalOrden = @Orden;

            -- Determine if the table is a split table
            IF @Mesa LIKE '%-%'
            BEGIN
                IF @Mesa LIKE '[0-9]%-[A-Z]'
                BEGIN
                    SET @IsSplitTable = 1;
                    SET @MainTable = LEFT(@Mesa, CHARINDEX('-', @Mesa) - 1);
                    SET @SplitSuffix = SUBSTRING(@Mesa, CHARINDEX('-', @Mesa) + 1, LEN(@Mesa));

                    -- Attempt to get original folio and orden from main table
                    SELECT TOP 1 
                        @OriginalFolio = folio, 
                        @OriginalOrden = orden
                    FROM tempcheques WITH (NOLOCK)
                    WHERE mesa = @MainTable
                    ORDER BY fecha DESC;  -- Replace 'fecha' with appropriate timestamp column

                    IF @OriginalFolio IS NULL OR @OriginalOrden IS NULL
                    BEGIN
                        -- If unable to find original folio/orden, default to current
                        SET @OriginalFolio = @Folio;
                        SET @OriginalOrden = @Orden;
                    END
                END
                ELSE -- Assume it's a special table
                BEGIN
                    SET @IsSplitTable = 0;
                    SET @MainTable = @Mesa;
                    SET @SplitSuffix = NULL;
                END
            END
            ELSE
            BEGIN
                SET @IsSplitTable = 0;
                SET @MainTable = @Mesa;
                SET @SplitSuffix = NULL;
            END

            -- Insert into PaymentEvents
            INSERT INTO [dbo].[PaymentEvents] (
                Folio,
                IdFormaDePago,
                Importe,
                Propina,
                Referencia,
                WorkspaceId,
                UniqueBillCodePos, -- Added column for bill's unique code
                TableNumber,
                OrderNumber,
                IsSplitTable,
                MainTable,
                SplitSuffix,
                Status,
                OperationType,
                Method              -- Added column for payment method type
            )
            VALUES (
                @Folio,
                @IdFormaDePago,
                CAST(@Importe AS DECIMAL(18,2)),
                CAST(@Propina AS DECIMAL(18,2)),
                @Referencia,
                @UniqueCode,
                @UniqueBillCodePos, -- Insert bill's unique code
                @Mesa,
                @OriginalOrden,
                @IsSplitTable,
                @MainTable,
                @SplitSuffix,
                'PAYMENT_ADDED',
                'INSERT',
                @Method             -- Insert payment method type
            );

            FETCH NEXT FROM inserted_cursor INTO @Folio, @IdFormaDePago, @Importe, @Propina, @Referencia, @UniqueCode;
        END

        CLOSE inserted_cursor;
        DEALLOCATE inserted_cursor;
    END
END;
GO

ALTER TABLE [dbo].[tempchequespagos] WITH NOCHECK
  ADD CONSTRAINT [FK_tempchequespagos_formasdepago] FOREIGN KEY ([idformadepago]) REFERENCES [dbo].[formasdepago] ([idformadepago]) ON UPDATE CASCADE
GO

--turnos
CREATE TRIGGER [dbo].[ActualizacionTurnos] ON [dbo].[turnos] 
FOR INSERT, UPDATE, DELETE 
AS 
BEGIN 
	SET NOCOUNT ON; 
	IF EXISTS ( 
		SELECT TOP(1) 0 FROM ws_cloud 
	) 
	BEGIN 
		IF EXISTS ( 
			SELECT TOP(1) 0 FROM inserted 
		) 
		BEGIN 
			IF EXISTS ( 
				SELECT TOP(1) 0 FROM deleted 
			) 
			BEGIN 
				INSERT INTO HistorialActualizaciones(IdActual, IdAnterior, Fondo, Apertura, Cierre, Estacion, Cajero, Efectivo, Tarjeta, Vales, Credito, TipoOperacion, Entidad) ( 
					SELECT i.idturno, d.idturno, i.fondo, i.apertura, i.cierre, i.idestacion, i.cajero, i.efectivo, i.tarjeta, i.vales, i.credito, 'U', 'TURNOS' 
					FROM inserted AS i 
					INNER JOIN deleted AS d ON d.idturno=i.idturno 
					WHERE i.fondo <> d.fondo OR i.apertura <> d.apertura OR  
					i.cierre <> d.cierre OR i.idestacion <> d.idestacion OR  
					i.cajero <> d.cajero OR i.efectivo <> d.efectivo OR  
					i.tarjeta <> d.tarjeta OR i.vales <> d.vales OR i.credito <> d.credito 
				); 
			END 
			ELSE 
			BEGIN 
				INSERT INTO HistorialActualizaciones(IdActual, Fondo, Apertura, Cierre, Estacion, Cajero, Efectivo, Tarjeta, Vales, Credito, TipoOperacion, Entidad) ( 
					SELECT i.idturno, i.fondo, i.apertura, i.cierre, i.idestacion, i.cajero, i.efectivo, i.tarjeta, i.vales, i.credito, 'I', 'TURNOS' 
					FROM inserted AS i 
				); 
			END; 
		END 
		ELSE 
		BEGIN 
			INSERT INTO HistorialActualizaciones(IdAnterior, TipoOperacion, Entidad) ( 
				SELECT d.idturno, 'D', 'TURNOS' 
				FROM deleted AS d 
			); 
		END; 
	END; 
END; 
GO


CREATE TRIGGER [dbo].[trgTurnosActualizado]
ON [dbo].[turnos]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @OperationType NVARCHAR(10)

    -- Variables for INSERT and UPDATE
    DECLARE @idturnointerno INT,
            @idturno INT,
            @fondo DECIMAL(18,2),
            @apertura DATETIME,
            @cierre DATETIME,
            @cajero NVARCHAR(100),
            @efectivo DECIMAL(18,2),
            @tarjeta DECIMAL(18,2),
            @vales DECIMAL(18,2),
            @credito DECIMAL(18,2),
            @corte_enviado BIT

    -- NEW: Variables for deduplication
    DECLARE @DuplicateCheck INT = 0
    
    IF EXISTS(SELECT * FROM inserted) AND NOT EXISTS(SELECT * FROM deleted) -- INSERT
    BEGIN
        SET @OperationType = 'INSERT'
        SELECT 
            @idturnointerno = idturnointerno,
            @idturno = idturno,
            @fondo = ISNULL(fondo, 0.00),
            @apertura = ISNULL(apertura, '1900-01-01'),
            @cierre = cierre,
            @cajero = ISNULL(cajero, ''),
            @efectivo = ISNULL(efectivo, 0.00),
            @tarjeta = ISNULL(tarjeta, 0.00),
            @vales = ISNULL(vales, 0.00),
            @credito = ISNULL(credito, 0.00),
            @corte_enviado = ISNULL(corte_enviado, 0)
        FROM inserted
        
        -- NEW: Check for duplicates within a short time window (5 seconds)
        SELECT @DuplicateCheck = COUNT(*)
        FROM [dbo].[TurnoEvents]
        WHERE IdTurno = @idturno
        AND Status = 'TURNO_ADDED'
        AND OperationType = @OperationType
        AND CreateDate >= DATEADD(SECOND, -5, GETDATE())
        
        -- Only insert if no duplicates found
        IF @DuplicateCheck = 0
        BEGIN
            -- Insert into TurnoEvents
            INSERT INTO [dbo].[TurnoEvents] (
                Status,
                OperationType,
                IdTurnoInterno,
                IdTurno,
                Fondo,
                Apertura,
                Cierre,
                Cajero,
                Efectivo,
                Tarjeta,
                Vales,
                Credito,
                CorteEnviado
            )
            VALUES (
                'TURNO_ADDED',
                @OperationType,
                @idturnointerno,
                @idturno,
                @fondo,
                @apertura,
                @cierre,
                @cajero,
                @efectivo,
                @tarjeta,
                @vales,
                @credito,
                @corte_enviado
            )
        END
    END

    ELSE IF EXISTS(SELECT * FROM inserted) AND EXISTS(SELECT * FROM deleted) -- UPDATE
    BEGIN
        SET @OperationType = 'UPDATE'
        SELECT 
            @idturnointerno = inserted.idturnointerno,
            @idturno = inserted.idturno,
            @fondo = ISNULL(inserted.fondo, 0.00),
            @apertura = ISNULL(inserted.apertura, '1900-01-01'),
            @cierre = inserted.cierre,
            @cajero = ISNULL(inserted.cajero, ''),
            @efectivo = ISNULL(inserted.efectivo, 0.00),
            @tarjeta = ISNULL(inserted.tarjeta, 0.00),
            @vales = ISNULL(inserted.vales, 0.00),
            @credito = ISNULL(inserted.credito, 0.00),
            @corte_enviado = ISNULL(inserted.corte_enviado, 0)
        FROM inserted
        
        -- NEW: Check for duplicates within a short time window (5 seconds)
        SELECT @DuplicateCheck = COUNT(*)
        FROM [dbo].[TurnoEvents]
        WHERE IdTurno = @idturno
        AND Status = 'TURNO_UPDATED'
        AND OperationType = @OperationType
        AND CreateDate >= DATEADD(SECOND, -5, GETDATE())
        
        -- Only insert if no duplicates found
        IF @DuplicateCheck = 0
        BEGIN
            -- Insert into TurnoEvents
            INSERT INTO [dbo].[TurnoEvents] (
                Status,
                OperationType,
                IdTurnoInterno,
                IdTurno,
                Fondo,
                Apertura,
                Cierre,
                Cajero,
                Efectivo,
                Tarjeta,
                Vales,
                Credito,
                CorteEnviado
            )
            VALUES (
                'TURNO_UPDATED',
                @OperationType,
                @idturnointerno,
                @idturno,
                @fondo,
                @apertura,
                @cierre,
                @cajero,
                @efectivo,
                @tarjeta,
                @vales,
                @credito,
                @corte_enviado
            )
        END
    END

    ELSE IF EXISTS(SELECT * FROM deleted) AND NOT EXISTS(SELECT * FROM inserted) -- DELETE
    BEGIN
        SET @OperationType = 'DELETE'
        SELECT 
            @idturnointerno = deleted.idturnointerno,
            @idturno = deleted.idturno,
            @fondo = ISNULL(deleted.fondo, 0.00),
            @apertura = ISNULL(deleted.apertura, '1900-01-01'),
            @cierre = deleted.cierre,
            @cajero = ISNULL(deleted.cajero, ''),
            @efectivo = ISNULL(deleted.efectivo, 0.00),
            @tarjeta = ISNULL(deleted.tarjeta, 0.00),
            @vales = ISNULL(deleted.vales, 0.00),
            @credito = ISNULL(deleted.credito, 0.00),
            @corte_enviado = ISNULL(deleted.corte_enviado, 0)
        FROM deleted
        
        -- NEW: Check for duplicates within a short time window (5 seconds)
        SELECT @DuplicateCheck = COUNT(*)
        FROM [dbo].[TurnoEvents]
        WHERE IdTurno = @idturno
        AND Status = 'TURNO_DELETED'
        AND OperationType = @OperationType
        AND CreateDate >= DATEADD(SECOND, -5, GETDATE())
        
        -- Only insert if no duplicates found
        IF @DuplicateCheck = 0
        BEGIN
            -- Insert into TurnoEvents
            INSERT INTO [dbo].[TurnoEvents] (
                Status,
                OperationType,
                IdTurnoInterno,
                IdTurno,
                Fondo,
                Apertura,
                Cierre,
                Cajero,
                Efectivo,
                Tarjeta,
                Vales,
                Credito,
                CorteEnviado
            )
            VALUES (
                'TURNO_DELETED',
                @OperationType,
                @idturnointerno,
                @idturno,
                @fondo,
                @apertura,
                @cierre,
                @cajero,
                @efectivo,
                @tarjeta,
                @vales,
                @credito,
                @corte_enviado
            )
        END
    END
END
GO

CREATE TRIGGER [dbo].[trgTurnosShiftClosing]
ON [dbo].[turnos]
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only look at updates where cierre changes from NULL to non-NULL
    IF EXISTS(SELECT * FROM inserted i JOIN deleted d 
              ON i.idturno = d.idturno
              WHERE i.cierre IS NOT NULL AND d.cierre IS NULL)
    BEGIN
        DECLARE @shiftId INT, @cajero NVARCHAR(100)
        
        -- Get the info about the shift being closed
        SELECT @shiftId = idturno, @cajero = ISNULL(cajero, '')
        FROM inserted
        WHERE cierre IS NOT NULL AND idturno IN 
            (SELECT d.idturno FROM deleted d WHERE d.cierre IS NULL)
        
        -- Log this shift closure state
        INSERT INTO [dbo].[ShiftLog] (EventType, ShiftId, Details)
        VALUES ('SHIFT_CLOSURE_STARTED', @shiftId, 
                'Shift ' + CAST(@shiftId AS VARCHAR) + ' closure started by ' + @cajero)
                
        -- Print for immediate feedback during development
        PRINT 'Shift closure detected for shift ID: ' + CAST(@shiftId AS VARCHAR)
    END
END

GO

CREATE TRIGGER [dbo].[trgTurnosShiftClosureComplete]
ON [dbo].[turnos]
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Look for the specific update that happens at the very end of shift closure
    -- (When eliminartemporalesencierre is set to 1)
    IF EXISTS(SELECT * FROM inserted i JOIN deleted d 
              ON i.idturno = d.idturno
              WHERE i.eliminartemporalesencierre = 1 
              AND (d.eliminartemporalesencierre = 0 OR d.eliminartemporalesencierre IS NULL))
    BEGIN
        DECLARE @shiftId INT
        
        -- Get the shift ID
        SELECT @shiftId = idturno
        FROM inserted
        WHERE eliminartemporalesencierre = 1
        
        -- Mark the shift closure as complete
        UPDATE [dbo].[ShiftClosureState]
        SET Status = 'COMPLETED', EndTime = GETDATE()
        WHERE ShiftId = @shiftId AND Status = 'ACTIVE'
        
        -- Log for monitoring
        INSERT INTO [dbo].[ShiftLog] (EventType, ShiftId, Details)
        VALUES ('SHIFT_CLOSURE_COMPLETED', @shiftId, 
                'Shift ' + CAST(@shiftId AS VARCHAR) + ' closure completed')
                
        -- Print for immediate feedback during development
        PRINT 'Shift closure completed for shift ID: ' + CAST(@shiftId AS VARCHAR)
    END
END

GO

CREATE TRIGGER [dbo].[trgTurnosShiftClosureDetect]
ON [dbo].[turnos]
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only look at updates where cierre changes from NULL to non-NULL
    -- This is the definitive start of a shift closure
    IF EXISTS(SELECT * FROM inserted i JOIN deleted d 
              ON i.idturno = d.idturno
              WHERE i.cierre IS NOT NULL AND d.cierre IS NULL)
    BEGIN
        DECLARE @shiftId INT, @cajero NVARCHAR(100)
        
        -- Get the info about the shift being closed
        SELECT @shiftId = idturno, @cajero = ISNULL(cajero, '')
        FROM inserted
        WHERE cierre IS NOT NULL AND idturno IN 
            (SELECT d.idturno FROM deleted d WHERE d.cierre IS NULL)
        
        -- Log this shift closure state
        INSERT INTO [dbo].[ShiftClosureState] (ShiftId, Status, CreatedBy)
        VALUES (@shiftId, 'ACTIVE', @cajero)
        
        -- Log for monitoring
        INSERT INTO [dbo].[ShiftLog] (EventType, ShiftId, Details)
        VALUES ('SHIFT_CLOSURE_STARTED', @shiftId, 
                'Shift ' + CAST(@shiftId AS VARCHAR) + ' closure started by ' + @cajero)
                
        -- Print for immediate feedback during development
        PRINT 'Shift closure detected for shift ID: ' + CAST(@shiftId AS VARCHAR)
    END
END

GO

ALTER TABLE [dbo].[turnos] WITH NOCHECK
  ADD CONSTRAINT [FK_turnos_estaciones] FOREIGN KEY ([idestacion]) REFERENCES [dbo].[estaciones] ([idestacion])
GO


CREATE INDEX [IX_ShiftClosureState_ShiftId]
  ON [dbo].[ShiftClosureState] ([ShiftId])
  ON [PRIMARY]
GO

CREATE INDEX [IX_ShiftClosureState_Status]
  ON [dbo].[ShiftClosureState] ([Status])
  ON [PRIMARY]
GO
