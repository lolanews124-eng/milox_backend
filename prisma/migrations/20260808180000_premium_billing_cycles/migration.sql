-- Premium billing cycles: monthly, yearly, and one-time prices per plan.

CREATE TYPE "PremiumBillingCycle" AS ENUM ('MONTHLY', 'YEARLY', 'ONE_TIME');

CREATE TABLE IF NOT EXISTS "premium_plan_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "planId" UUID NOT NULL,
  "billingCycle" "PremiumBillingCycle" NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "durationDays" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "premium_plan_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "premium_plan_prices_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "premium_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "premium_plan_prices_planId_billingCycle_key"
  ON "premium_plan_prices"("planId", "billingCycle");

CREATE INDEX IF NOT EXISTS "premium_plan_prices_planId_isActive_idx"
  ON "premium_plan_prices"("planId", "isActive");

INSERT INTO "premium_plan_prices" (
  "id", "planId", "billingCycle", "priceCents", "durationDays", "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  p."id",
  v."billingCycle"::"PremiumBillingCycle",
  CASE v."billingCycle"
    WHEN 'MONTHLY' THEN p."priceCents"
    WHEN 'YEARLY' THEN GREATEST(p."priceCents" * 10, 0)
    WHEN 'ONE_TIME' THEN GREATEST(p."priceCents" * 20, 0)
  END,
  CASE v."billingCycle"
    WHEN 'MONTHLY' THEN p."durationDays"
    WHEN 'YEARLY' THEN 365
    WHEN 'ONE_TIME' THEN 3650
  END,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "premium_plans" p
CROSS JOIN (
  VALUES ('MONTHLY'), ('YEARLY'), ('ONE_TIME')
) AS v("billingCycle")
ON CONFLICT ("planId", "billingCycle") DO NOTHING;

ALTER TABLE "user_subscriptions"
  ADD COLUMN IF NOT EXISTS "billingCycle" "PremiumBillingCycle" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN IF NOT EXISTS "planPriceId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_subscriptions_planPriceId_fkey'
  ) THEN
    ALTER TABLE "user_subscriptions"
      ADD CONSTRAINT "user_subscriptions_planPriceId_fkey"
      FOREIGN KEY ("planPriceId") REFERENCES "premium_plan_prices"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

UPDATE "user_subscriptions" us
SET
  "billingCycle" = 'MONTHLY',
  "planPriceId" = pp."id"
FROM "premium_plan_prices" pp
WHERE us."planId" = pp."planId"
  AND pp."billingCycle" = 'MONTHLY'
  AND us."planPriceId" IS NULL;
