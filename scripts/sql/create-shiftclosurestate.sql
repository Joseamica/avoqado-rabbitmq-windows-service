
/****** Object:  Table [dbo].[ShiftClosureState]    Script Date: 3/26/2025 1:16:25 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[ShiftClosureState](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[ShiftId] [int] NOT NULL,
	[StartTime] [datetime] NOT NULL,
	[EndTime] [datetime] NULL,
	[Status] [varchar](20) NOT NULL,
	[CreatedBy] [nvarchar](100) NULL,
PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[ShiftClosureState] ADD  DEFAULT (getdate()) FOR [StartTime]
GO

ALTER TABLE [dbo].[ShiftClosureState] ADD  DEFAULT ('ACTIVE') FOR [Status]
GO

