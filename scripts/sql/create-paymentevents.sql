USE [avo]
GO

/****** Object:  Table [dbo].[PaymentEvents]    Script Date: 3/25/2025 11:19:49 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[PaymentEvents](
	[ID] [int] IDENTITY(1,1) NOT NULL,
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
	[CreateDate] [datetime] NULL,
	[UpdateDate] [datetime] NULL,
	[UniqueBillCodePos] [nvarchar](100) NULL,
	[Method] [int] NULL,
PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[PaymentEvents] ADD  DEFAULT (getdate()) FOR [CreateDate]
GO


