-- Claim queries filter status + eventType and order by createdAt.
-- The existing (status, availableAt) index cannot skip the large pending
-- set of event types that no worker claims, so every idle claim walked it.
CREATE INDEX "outbox_events_status_eventType_createdAt_idx"
  ON "outbox_events"("status", "eventType", "createdAt");
