-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('PAYPAL', 'CASHFREE');

-- AlterTable
ALTER TABLE "paypal_checkouts" ADD COLUMN     "country" VARCHAR(80),
ADD COLUMN     "failureReason" VARCHAR(500),
ADD COLUMN     "gateway" "PaymentGateway" NOT NULL DEFAULT 'PAYPAL';

-- CreateTable
CREATE TABLE "cashfree_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "appId" VARCHAR(255) NOT NULL DEFAULT '',
    "secretKey" TEXT NOT NULL DEFAULT '',
    "mode" VARCHAR(16) NOT NULL DEFAULT 'sandbox',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashfree_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paypal_checkouts_gateway_status_createdAt_idx" ON "paypal_checkouts"("gateway", "status", "createdAt");
