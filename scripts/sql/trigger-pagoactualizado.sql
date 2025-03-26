
/****** Object:  Trigger [dbo].[trgChequePagoActualizado]    Script Date: 3/26/2025 1:07:31 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

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