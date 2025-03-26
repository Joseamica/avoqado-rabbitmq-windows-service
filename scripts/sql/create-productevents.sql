
/****** Object:  Table [dbo].[ProductEvents]    Script Date: 3/26/2025 12:49:44 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[ProductEvents](
	[ID] [int] IDENTITY(1,1) NOT NULL,
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
	[CreateDate] [datetime] NULL,
	[UpdateDate] [datetime] NULL,
	[ShiftId] [int] NULL,
	[UniqueCode] [nvarchar](100) NULL,
	[uniqueBillCodeFromPos] [nvarchar](100) NULL,
PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[ProductEvents] ADD  DEFAULT (getdate()) FOR [CreateDate]
GO


