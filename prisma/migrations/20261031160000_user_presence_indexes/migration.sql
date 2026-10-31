-- Speed admin DAU / online / quiet-user filters that scan lastSeenAt / lastLoginAt.
CREATE INDEX IF NOT EXISTS "users_lastSeenAt_idx" ON "users"("lastSeenAt");
CREATE INDEX IF NOT EXISTS "users_lastLoginAt_idx" ON "users"("lastLoginAt");
