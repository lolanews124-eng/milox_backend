-- Admin KPI / list / referral performance indexes.
-- Do not apply to production from this change set; deploy via migrate deploy after review.

CREATE INDEX IF NOT EXISTS "users_role_isSystemAccount_deletedAt_status_idx"
  ON "users"("role", "isSystemAccount", "deletedAt", "status");

CREATE INDEX IF NOT EXISTS "users_role_isSystemAccount_lastSeenAt_idx"
  ON "users"("role", "isSystemAccount", "lastSeenAt");

CREATE INDEX IF NOT EXISTS "users_emailVerifiedAt_idx"
  ON "users"("emailVerifiedAt");

CREATE INDEX IF NOT EXISTS "matches_matchedAt_idx"
  ON "matches"("matchedAt");

CREATE INDEX IF NOT EXISTS "matches_status_matchedAt_idx"
  ON "matches"("status", "matchedAt");

CREATE INDEX IF NOT EXISTS "referrals_createdAt_idx"
  ON "referrals"("createdAt");
