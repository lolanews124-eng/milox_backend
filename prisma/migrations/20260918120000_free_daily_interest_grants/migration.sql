-- Admin-managed daily free interest grants (0 = disabled).

ALTER TABLE "app_economy_configs"
  ADD COLUMN IF NOT EXISTS "freeDailyInterestGrants" INTEGER NOT NULL DEFAULT 10;
