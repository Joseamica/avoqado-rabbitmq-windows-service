USE [avo]
GO

/****** Object:  Table [dbo].[TurnoEvents]    Script Date: 3/25/2025 11:20:15 AM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[TurnoEvents](
	[ID] [int] IDENTITY(1,1) NOT NULL,
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
	[CreateDate] [datetime] NULL,
	[UpdateDate] [datetime] NULL,
PRIMARY KEY CLUSTERED 
(
	[ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[TurnoEvents] ADD  DEFAULT (getdate()) FOR [CreateDate]
GO


