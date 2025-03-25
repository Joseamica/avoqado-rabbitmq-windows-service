-- Enable Change Tracking on the database
IF NOT EXISTS (SELECT 1 FROM sys.change_tracking_databases WHERE database_id = DB_ID())
BEGIN
    ALTER DATABASE CURRENT
    SET CHANGE_TRACKING = ON
    (CHANGE_RETENTION = 2 DAYS, AUTO_CLEANUP = ON);
    
    PRINT 'Change Tracking enabled on database successfully';
END
ELSE
BEGIN
    PRINT 'Change Tracking is already enabled on database';
END
GO

-- Check if tables exist and enable change tracking on each

-- TicketEvents table
IF OBJECT_ID('dbo.TicketEvents', 'U') IS NOT NULL
BEGIN
    IF OBJECTPROPERTYEX(OBJECT_ID('dbo.TicketEvents'), 'TableHasChangeTracking') = 0
    BEGIN
        ALTER TABLE dbo.TicketEvents
        ENABLE CHANGE_TRACKING
        WITH (TRACK_COLUMNS_UPDATED = ON);
        
        PRINT 'Change Tracking enabled on TicketEvents table successfully';
    END
    ELSE
    BEGIN
        PRINT 'Change Tracking is already enabled on TicketEvents table';
    END
END
ELSE
BEGIN
    PRINT 'TicketEvents table does not exist';
END
GO

-- ProductEvents table
IF OBJECT_ID('dbo.ProductEvents', 'U') IS NOT NULL
BEGIN
    IF OBJECTPROPERTYEX(OBJECT_ID('dbo.ProductEvents'), 'TableHasChangeTracking') = 0
    BEGIN
        ALTER TABLE dbo.ProductEvents
        ENABLE CHANGE_TRACKING
        WITH (TRACK_COLUMNS_UPDATED = ON);
        
        PRINT 'Change Tracking enabled on ProductEvents table successfully';
    END
    ELSE
    BEGIN
        PRINT 'Change Tracking is already enabled on ProductEvents table';
    END
END
ELSE
BEGIN
    PRINT 'ProductEvents table does not exist';
END
GO

-- PaymentEvents table
IF OBJECT_ID('dbo.PaymentEvents', 'U') IS NOT NULL
BEGIN
    IF OBJECTPROPERTYEX(OBJECT_ID('dbo.PaymentEvents'), 'TableHasChangeTracking') = 0
    BEGIN
        ALTER TABLE dbo.PaymentEvents
        ENABLE CHANGE_TRACKING
        WITH (TRACK_COLUMNS_UPDATED = ON);
        
        PRINT 'Change Tracking enabled on PaymentEvents table successfully';
    END
    ELSE
    BEGIN
        PRINT 'Change Tracking is already enabled on PaymentEvents table';
    END
END
ELSE
BEGIN
    PRINT 'PaymentEvents table does not exist';
END
GO

-- TurnoEvents table
IF OBJECT_ID('dbo.TurnoEvents', 'U') IS NOT NULL
BEGIN
    IF OBJECTPROPERTYEX(OBJECT_ID('dbo.TurnoEvents'), 'TableHasChangeTracking') = 0
    BEGIN
        ALTER TABLE dbo.TurnoEvents
        ENABLE CHANGE_TRACKING
        WITH (TRACK_COLUMNS_UPDATED = ON);
        
        PRINT 'Change Tracking enabled on TurnoEvents table successfully';
    END
    ELSE
    BEGIN
        PRINT 'Change Tracking is already enabled on TurnoEvents table';
    END
END
ELSE
BEGIN
    PRINT 'TurnoEvents table does not exist';
END
GO

-- Get current change tracking version for reference
SELECT CHANGE_TRACKING_CURRENT_VERSION() AS CurrentChangeTrackingVersion;
GO