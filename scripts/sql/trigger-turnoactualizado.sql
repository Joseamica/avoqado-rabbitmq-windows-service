
/****** Object:  Trigger [dbo].[trgTurnosActualizado]    Script Date: 3/26/2025 12:51:25 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
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