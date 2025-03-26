
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
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
