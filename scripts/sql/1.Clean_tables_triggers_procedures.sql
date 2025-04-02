IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgComandaActualizado')
    DROP TRIGGER trgComandaActualizado;
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgChequeActualizado')
    DROP TRIGGER trgChequeActualizado;
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgTurnosActualizado')
    DROP TRIGGER trgTurnosActualizado;
GO

IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trgChequePagoActualizado')
    DROP TRIGGER trgChequePagoActualizado;
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

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TicketEvents]') AND type in (N'U'))
    DROP TABLE [dbo].[TicketEvents];
GO

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TurnoEvents]') AND type in (N'U'))
    DROP TABLE [dbo].[TurnoEvents];
GO

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PaymentEvents]') AND type in (N'U'))
    DROP TABLE [dbo].[PaymentEvents];
GO

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ProductEvents]') AND type in (N'U'))
    DROP TABLE [dbo].[ProductEvents];
GO

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BillSplitLog]') AND type in (N'U'))
    DROP TABLE [dbo].[BillSplitLog];
GO

IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'CleanupOldEvents')
    DROP PROCEDURE CleanupOldEvents;
GO

