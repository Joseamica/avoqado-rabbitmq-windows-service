
/****** Object:  Trigger [dbo].[trgTurnosShiftClosing]    Script Date: 3/26/2025 12:53:26 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
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
