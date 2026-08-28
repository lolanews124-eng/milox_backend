-- Interest daily-grant / sender history lookups
CREATE INDEX IF NOT EXISTS "interests_senderId_createdAt_idx"
  ON "interests"("senderId", "createdAt");

-- Author post-kind spam / rate-limit queries
CREATE INDEX IF NOT EXISTS "posts_authorId_kind_deletedAt_createdAt_idx"
  ON "posts"("authorId", "kind", "deletedAt", "createdAt");
