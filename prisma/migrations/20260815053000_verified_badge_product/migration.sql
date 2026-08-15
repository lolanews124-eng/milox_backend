ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'VERIFIED_BADGE';

CREATE TYPE "VerifiedBadgeOrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED');
CREATE TYPE "VerifiedBadgePaymentMethod" AS ENUM ('POINTS', 'MANUAL');

ALTER TABLE "users" ADD COLUMN "verifiedBadgeExpiresAt" TIMESTAMP(3);

CREATE INDEX "users_verifiedBadgeExpiresAt_idx" ON "users"("verifiedBadgeExpiresAt");

CREATE TABLE "verified_badge_products" (
    "id" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "title" VARCHAR(120) NOT NULL DEFAULT 'Verified badge',
    "description" VARCHAR(1000),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "priceCents" INTEGER NOT NULL DEFAULT 19900,
    "pricePoints" INTEGER NOT NULL DEFAULT 0,
    "durationDays" INTEGER NOT NULL DEFAULT 365,
    "paymentInstructions" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verified_badge_products_pkey" PRIMARY KEY ("id")
);

INSERT INTO "verified_badge_products" (
  "id",
  "isActive",
  "title",
  "description",
  "currency",
  "priceCents",
  "pricePoints",
  "durationDays",
  "paymentInstructions",
  "createdAt",
  "updatedAt"
) VALUES (
  '00000000-0000-4000-a000-0000000000b1',
  false,
  'Verified badge',
  'Blue tick only — no Elite plan required. Price and duration are set by admins.',
  'INR',
  19900,
  0,
  365,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

CREATE TABLE "verified_badge_orders" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "VerifiedBadgeOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "VerifiedBadgePaymentMethod" NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "pointsSpent" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "badgeExpiresAt" TIMESTAMP(3),
    "note" VARCHAR(500),
    "processedById" UUID,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verified_badge_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verified_badge_orders_userId_status_createdAt_idx" ON "verified_badge_orders"("userId", "status", "createdAt");
CREATE INDEX "verified_badge_orders_status_createdAt_idx" ON "verified_badge_orders"("status", "createdAt");

ALTER TABLE "verified_badge_orders" ADD CONSTRAINT "verified_badge_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verified_badge_orders" ADD CONSTRAINT "verified_badge_orders_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
