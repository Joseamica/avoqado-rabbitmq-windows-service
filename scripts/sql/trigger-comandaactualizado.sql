
/****** Object:  Trigger [dbo].[trgComandaActualizado]    Script Date: 3/26/2025 1:05:32 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

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

ALTER TABLE [dbo].[tempcheqdet] ENABLE TRIGGER [trgComandaActualizado]
GO


