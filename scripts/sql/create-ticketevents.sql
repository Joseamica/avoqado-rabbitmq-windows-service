USE [avo]
GO

/****** Object:  Table [dbo].[TicketEvents]    Script Date: 3/25/2025 11:18:20 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[TicketEvents](
	[ID] [int] IDENTITY(1,1) NOT NULL,
	[Folio] [nvarchar](100) NOT NULL,
	[TableNumber] [nvarchar](100) NOT NULL,
	[OrderNumber] [int] NULL,
	[EventType] [nvarchar](20) NOT NULL,
	[OperationType] [nvarchar](20) NOT NULL,
	[ShiftId] [int] NULL,
	[ShiftState] [nvarchar](20) NULL,
	[IsSplitOperation] [bit] NOT NULL,
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
	[IsProcessed] [bit] NOT NULL,
	[ProcessedDate] [datetime] NULL,
	[Response] [nvarchar](max) NULL,
	[CreateDate] [datetime] NOT NULL,
	[UpdateDate] [datetime] NULL,
PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[TicketEvents] ADD  DEFAULT ((0)) FOR [IsSplitOperation]
GO

ALTER TABLE [dbo].[TicketEvents] ADD  DEFAULT ((0)) FOR [IsProcessed]
GO

ALTER TABLE [dbo].[TicketEvents] ADD  DEFAULT (getdate()) FOR [CreateDate]
GO


