-- Cashfree + payment gateway tracking
CREATE TYPE "PaymentGateway" AS ENUM ('PAYPAL', 'CASHFREE');

ALTER TABLE "paypal_checkouts"
  ADD COLUMN IF NOT EXISTS "gateway" "PaymentGateway" NOT NULL DEFAULT 'PAYPAL',
  ADD COLUMN IF NOT EXISTS "country" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "failureReason" VARCHAR(500);

CREATE INDEX IF NOT EXISTS "paypal_checkouts_gateway_status_createdAt_idx"
  ON "paypal_checkouts" ("gateway", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "cashfree_settings" (
  "id" VARCHAR(32) PRIMARY KEY,
  "appId" VARCHAR(255) NOT NULL DEFAULT '',
  "secretKey" TEXT NOT NULL DEFAULT '',
  "mode" VARCHAR(16) NOT NULL DEFAULT 'sandbox',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "cashfree_settings" ("id", "appId", "secretKey", "mode", "updatedAt")
VALUES ('default', '', '', 'sandbox', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
