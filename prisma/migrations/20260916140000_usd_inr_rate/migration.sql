-- Single admin price → INR/USD display conversion rate.

ALTER TABLE "app_economy_configs"
  ADD COLUMN IF NOT EXISTS "usdInrRate" DOUBLE PRECISION NOT NULL DEFAULT 85;
