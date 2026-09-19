-- Razorpay gateway + admin settings (idempotent).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'PaymentGateway' AND e.enumlabel = 'RAZORPAY'
  ) THEN
    ALTER TYPE "PaymentGateway" ADD VALUE 'RAZORPAY';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'VerifiedBadgePaymentMethod' AND e.enumlabel = 'RAZORPAY'
  ) THEN
    ALTER TYPE "VerifiedBadgePaymentMethod" ADD VALUE 'RAZORPAY';
  END IF;
END $$;

ALTER TABLE "paypal_checkouts" ALTER COLUMN "gateway" SET DEFAULT 'RAZORPAY';

CREATE TABLE IF NOT EXISTS "razorpay_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "keyId" VARCHAR(255) NOT NULL DEFAULT '',
    "keySecret" TEXT NOT NULL DEFAULT '',
    "webhookSecret" TEXT NOT NULL DEFAULT '',
    "mode" VARCHAR(16) NOT NULL DEFAULT 'test',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "razorpay_settings_pkey" PRIMARY KEY ("id")
);
