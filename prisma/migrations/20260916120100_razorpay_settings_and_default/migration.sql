-- Step 2/2: use RAZORPAY after the enum value was committed in the previous migration.

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
