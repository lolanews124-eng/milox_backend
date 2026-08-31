-- Repair Cashfree / PayPal gateway objects when 20260831120000 failed
-- because "PaymentGateway" already existed. Safe to run multiple times.

DO $$ BEGIN
    CREATE TYPE "PaymentGateway" AS ENUM ('PAYPAL', 'CASHFREE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "paypal_checkouts" ADD COLUMN IF NOT EXISTS "country" VARCHAR(80);
ALTER TABLE "paypal_checkouts" ADD COLUMN IF NOT EXISTS "failureReason" VARCHAR(500);
ALTER TABLE "paypal_checkouts" ADD COLUMN IF NOT EXISTS "gateway" "PaymentGateway" NOT NULL DEFAULT 'PAYPAL';

CREATE TABLE IF NOT EXISTS "cashfree_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "appId" VARCHAR(255) NOT NULL DEFAULT '',
    "secretKey" TEXT NOT NULL DEFAULT '',
    "mode" VARCHAR(16) NOT NULL DEFAULT 'sandbox',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashfree_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "paypal_checkouts_gateway_status_createdAt_idx"
    ON "paypal_checkouts"("gateway", "status", "createdAt");
