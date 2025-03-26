
/****** Object:  Table [dbo].[ShiftLog]    Script Date: 3/26/2025 1:16:48 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[ShiftLog](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[EventTime] [datetime] NOT NULL,
	[EventType] [varchar](50) NOT NULL,
	[ShiftId] [int] NULL,
	[Details] [nvarchar](max) NULL,
	[FolioInfo] [nvarchar](100) NULL,
PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

ALTER TABLE [dbo].[ShiftLog] ADD  DEFAULT (getdate()) FOR [EventTime]
GO

