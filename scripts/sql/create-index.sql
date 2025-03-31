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

ALTER TABLE [dbo].[TurnoEvents]
  ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON)
GO

CREATE INDEX [IX_TurnoEvents_UpdateDate]
  ON [dbo].[TurnoEvents] ([UpdateDate])
  WHERE ([UpdateDate] IS NULL)
  ON [PRIMARY]
GO
  ALTER TABLE [dbo].[ProductEvents]
  ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON)
GO

CREATE INDEX [IX_ProductEvents_UpdateDate]
  ON [dbo].[ProductEvents] ([UpdateDate])
  WHERE ([UpdateDate] IS NULL)
  ON [PRIMARY]
GO
CREATE INDEX [IX_ShiftClosureState_ShiftId]
  ON [dbo].[ShiftClosureState] ([ShiftId])
  ON [PRIMARY]
GO

CREATE INDEX [IX_ShiftClosureState_Status]
  ON [dbo].[ShiftClosureState] ([Status])
  ON [PRIMARY]
GO
ALTER TABLE [dbo].[PaymentEvents]
  ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON)
GO

CREATE INDEX [IX_PaymentEvents_UpdateDate]
  ON [dbo].[PaymentEvents] ([UpdateDate])
  WHERE ([UpdateDate] IS NULL)
  ON [PRIMARY]