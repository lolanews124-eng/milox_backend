-- Admin dashboard counts every message that was not deleted for everyone.
-- There is no index that matches that filter, so the count scanned the whole table.
CREATE INDEX "messages_not_deleted_everyone_idx"
  ON "messages" ("id")
  WHERE "deletedForEveryoneAt" IS NULL;
