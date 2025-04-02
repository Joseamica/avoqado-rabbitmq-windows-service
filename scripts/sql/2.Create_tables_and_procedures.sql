CREATE TABLE [dbo].[BillSplitLog] (
  [ID] [int] IDENTITY,
  [OriginalFolio] [nvarchar](100) NOT NULL,
  [SplitFolios] [nvarchar](1000) NOT NULL,
  [OriginalTable] [nvarchar](100) NOT NULL,
  [SplitTables] [nvarchar](1000) NOT NULL,
  [CreatedDate] [datetime] NOT NULL DEFAULT (getdate()),
  [OperationDetails] [nvarchar](max) NULL,
  PRIMARY KEY CLUSTERED ([ID])
)
ON [PRIMARY]
TEXTIMAGE_ON [PRIMARY]
GO

CREATE TABLE [dbo].[PaymentEvents] (
  [ID] [int] IDENTITY,
  [Folio] [nvarchar](100) NULL,
  [IdFormaDePago] [nvarchar](100) NULL,
  [Importe] [decimal](18, 2) NULL,
  [Propina] [decimal](18, 2) NULL,
  [Referencia] [nvarchar](100) NULL,
  [WorkspaceId] [nvarchar](100) NULL,
  [TableNumber] [nvarchar](100) NULL,
  [OrderNumber] [int] NULL,
  [IsSplitTable] [bit] NULL,
  [MainTable] [nvarchar](100) NULL,
  [SplitSuffix] [nvarchar](10) NULL,
  [Status] [nvarchar](50) NULL,
  [OperationType] [nvarchar](20) NULL,
  [IsSuccess] [bit] NULL,
  [IsFailed] [bit] NULL,
  [Response] [nvarchar](max) NULL,
  [CreateDate] [datetime] NULL DEFAULT (getdate()),
  [UpdateDate] [datetime] NULL,
  [UniqueBillCodePos] [nvarchar](100) NULL,
  [Method] [int] NULL,
  PRIMARY KEY CLUSTERED ([ID])
)
ON [PRIMARY]
TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[PaymentEvents]
  ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON)
GO

CREATE INDEX [IX_PaymentEvents_UpdateDate]
  ON [dbo].[PaymentEvents] ([UpdateDate])
  WHERE ([UpdateDate] IS NULL)
  ON [PRIMARY]
GO

CREATE TABLE [dbo].[PendingShiftExports] (
  [ID] [int] IDENTITY,
  [TurnoID] [bigint] NOT NULL,
  [RequestTime] [datetime] NULL DEFAULT (getdate()),
  [Processed] [bit] NULL DEFAULT (0),
  PRIMARY KEY CLUSTERED ([ID])
)
ON [PRIMARY]
GO

CREATE TABLE [dbo].[ProductEvents] (
  [ID] [int] IDENTITY,
  [Folio] [nvarchar](100) NULL,
  [TableNumber] [nvarchar](100) NULL,
  [OrderNumber] [int] NULL,
  [Status] [nvarchar](50) NULL,
  [WaiterId] [nvarchar](50) NULL,
  [WaiterName] [nvarchar](100) NULL,
  [IsSplitTable] [bit] NULL,
  [MainTable] [nvarchar](100) NULL,
  [SplitSuffix] [nvarchar](10) NULL,
  [IdProducto] [nvarchar](100) NULL,
  [NombreProducto] [nvarchar](200) NULL,
  [Movimiento] [nvarchar](100) NULL,
  [Cantidad] [decimal](18, 4) NULL,
  [Precio] [decimal](18, 2) NULL,
  [Descuento] [decimal](18, 2) NULL,
  [Hora] [nvarchar](100) NULL,
  [Modificador] [nvarchar](max) NULL,
  [Clasificacion] [nvarchar](50) NULL,
  [OperationType] [nvarchar](20) NULL,
  [IsSuccess] [bit] NULL,
  [IsFailed] [bit] NULL,
  [Response] [nvarchar](max) NULL,
  [CreateDate] [datetime] NULL DEFAULT (getdate()),
  [UpdateDate] [datetime] NULL,
  [ShiftId] [int] NULL,
  [UniqueCode] [nvarchar](100) NULL,
  [uniqueBillCodeFromPos] [nvarchar](100) NULL,
  PRIMARY KEY CLUSTERED ([ID])
)
ON [PRIMARY]
TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[ProductEvents]
  ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON)
GO

CREATE INDEX [IX_ProductEvents_UpdateDate]
  ON [dbo].[ProductEvents] ([UpdateDate])
  WHERE ([UpdateDate] IS NULL)
  ON [PRIMARY]
GO

CREATE TABLE [dbo].[TicketEvents] (
  [ID] [int] IDENTITY,
  [Folio] [nvarchar](100) NOT NULL,
  [TableNumber] [nvarchar](100) NOT NULL,
  [OrderNumber] [int] NULL,
  [EventType] [nvarchar](20) NOT NULL,
  [OperationType] [nvarchar](20) NOT NULL,
  [ShiftId] [int] NULL,
  [ShiftState] [nvarchar](20) NULL,
  [IsSplitOperation] [bit] NOT NULL DEFAULT (0),
  [SplitRole] [nvarchar](20) NULL,
  [OriginalTable] [nvarchar](100) NULL,
  [SplitTables] [nvarchar](500) NULL,
  [SplitFolios] [nvarchar](500) NULL,
  [ParentFolio] [nvarchar](100) NULL,
  [WaiterId] [nvarchar](50) NULL,
  [WaiterName] [nvarchar](100) NULL,
  [Total] [money] NULL,
  [Descuento] [money] NULL,
  [UniqueCode] [nvarchar](100) NULL,
  [SourceEvent] [nvarchar](500) NULL,
  [SourceEventId] [int] NULL,
  [IsProcessed] [bit] NOT NULL DEFAULT (0),
  [ProcessedDate] [datetime] NULL,
  [Response] [nvarchar](max) NULL,
  [CreateDate] [datetime] NOT NULL DEFAULT (getdate()),
  [UpdateDate] [datetime] NULL,
  PRIMARY KEY CLUSTERED ([ID])
)
ON [PRIMARY]
TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[TicketEvents]
  ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON)
GO

CREATE INDEX [IX_TicketEvents_CreateDate]
  ON [dbo].[TicketEvents] ([CreateDate])
  ON [PRIMARY]
GO

CREATE INDEX [IX_TicketEvents_EventType]
  ON [dbo].[TicketEvents] ([EventType])
  ON [PRIMARY]
GO

CREATE INDEX [IX_TicketEvents_Folio]
  ON [dbo].[TicketEvents] ([Folio])
  ON [PRIMARY]
GO

CREATE INDEX [IX_TicketEvents_IsProcessed]
  ON [dbo].[TicketEvents] ([IsProcessed])
  ON [PRIMARY]
GO

CREATE INDEX [IX_TicketEvents_IsSplitOperation]
  ON [dbo].[TicketEvents] ([IsSplitOperation])
  ON [PRIMARY]
GO

CREATE INDEX [IX_TicketEvents_ShiftId]
  ON [dbo].[TicketEvents] ([ShiftId])
  ON [PRIMARY]
GO

CREATE INDEX [IX_TicketEvents_TableNumber]
  ON [dbo].[TicketEvents] ([TableNumber])
  ON [PRIMARY]
GO

CREATE TABLE [dbo].[TurnoEvents] (
  [ID] [int] IDENTITY,
  [IdTurnoInterno] [int] NULL,
  [IdTurno] [int] NULL,
  [Fondo] [decimal](18, 2) NULL,
  [Apertura] [datetime] NULL,
  [Cierre] [datetime] NULL,
  [Cajero] [nvarchar](100) NULL,
  [Efectivo] [decimal](18, 2) NULL,
  [Tarjeta] [decimal](18, 2) NULL,
  [Vales] [decimal](18, 2) NULL,
  [Credito] [decimal](18, 2) NULL,
  [CorteEnviado] [bit] NULL,
  [Status] [nvarchar](50) NULL,
  [OperationType] [nvarchar](20) NULL,
  [IsSuccess] [bit] NULL,
  [IsFailed] [bit] NULL,
  [Response] [nvarchar](max) NULL,
  [CreateDate] [datetime] NULL DEFAULT (getdate()),
  [UpdateDate] [datetime] NULL,
  PRIMARY KEY CLUSTERED ([ID])
)
ON [PRIMARY]
TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[TurnoEvents]
  ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON)
GO

CREATE INDEX [IX_TurnoEvents_UpdateDate]
  ON [dbo].[TurnoEvents] ([UpdateDate])
  WHERE ([UpdateDate] IS NULL)
  ON [PRIMARY]
GO

CREATE PROCEDURE [dbo].[CleanupOldEvents]
    @DaysToKeep INT = 30
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @CutoffDate DATETIME = DATEADD(DAY, -@DaysToKeep, GETDATE());
    
    -- Eliminar registros antiguos de TicketEvents
    DELETE FROM TicketEvents
    WHERE UpdateDate IS NOT NULL 
    AND UpdateDate < @CutoffDate;
    
    -- Eliminar registros antiguos de ProductEvents
    DELETE FROM ProductEvents
    WHERE UpdateDate IS NOT NULL 
    AND UpdateDate < @CutoffDate;
    
    -- Eliminar registros antiguos de TurnoEvents
    DELETE FROM TurnoEvents
    WHERE UpdateDate IS NOT NULL 
    AND UpdateDate < @CutoffDate;
END
GO