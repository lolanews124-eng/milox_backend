-- PayPal checkout for point packs, premium plans, and verified badge.

ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'POINT_PURCHASE';
ALTER TYPE "VerifiedBadgePaymentMethod" ADD VALUE IF NOT EXISTS 'PAYPAL';

CREATE TYPE "PaypalCheckoutKind" AS ENUM ('POINT_PACK', 'PREMIUM', 'VERIFIED_BADGE');
CREATE TYPE "PaypalCheckoutStatus" AS ENUM ('CREATED', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "paypal_checkouts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "PaypalCheckoutKind" NOT NULL,
    "status" "PaypalCheckoutStatus" NOT NULL DEFAULT 'CREATED',
    "paypalOrderId" VARCHAR(64) NOT NULL,
    "paypalCaptureId" VARCHAR(64),
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "packId" UUID,
    "planId" UUID,
    "planPriceId" UUID,
    "billingCycle" "PremiumBillingCycle",
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paypal_checkouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "paypal_checkouts_paypalOrderId_key" ON "paypal_checkouts"("paypalOrderId");
CREATE UNIQUE INDEX "paypal_checkouts_paypalCaptureId_key" ON "paypal_checkouts"("paypalCaptureId");
CREATE INDEX "paypal_checkouts_userId_createdAt_idx" ON "paypal_checkouts"("userId", "createdAt");
CREATE INDEX "paypal_checkouts_status_createdAt_idx" ON "paypal_checkouts"("status", "createdAt");

ALTER TABLE "paypal_checkouts"
  ADD CONSTRAINT "paypal_checkouts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
