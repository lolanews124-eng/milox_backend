-- Refer + Earn: wallet, referral codes, and referral tracking

CREATE TYPE "WalletTransactionType" AS ENUM (
  'WELCOME_BONUS',
  'REFERRAL_REWARD',
  'INTEREST_SEND',
  'ADMIN_ADJUST'
);

CREATE TYPE "ReferralStatus" AS ENUM ('QUALIFIED', 'REJECTED');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFERRAL_REWARD';

ALTER TABLE "users" ADD COLUMN "referredByUserId" UUID;

CREATE TABLE "wallets" (
  "userId" UUID NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
  "lifetimeSpent" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wallets_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "wallet_transactions" (
  "id" UUID NOT NULL,
  "walletUserId" UUID NOT NULL,
  "type" "WalletTransactionType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "referenceType" VARCHAR(32),
  "referenceId" UUID,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "description" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "referral_codes" (
  "userId" UUID NOT NULL,
  "code" VARCHAR(16) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "referrals" (
  "id" UUID NOT NULL,
  "referrerUserId" UUID NOT NULL,
  "referredUserId" UUID NOT NULL,
  "status" "ReferralStatus" NOT NULL DEFAULT 'QUALIFIED',
  "rewardPoints" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_transactions_idempotencyKey_key"
  ON "wallet_transactions"("idempotencyKey");

CREATE INDEX "wallet_transactions_walletUserId_createdAt_idx"
  ON "wallet_transactions"("walletUserId", "createdAt" DESC);

CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

CREATE INDEX "referral_codes_code_idx" ON "referral_codes"("code");

CREATE UNIQUE INDEX "referrals_referredUserId_key" ON "referrals"("referredUserId");

CREATE INDEX "referrals_referrerUserId_createdAt_idx"
  ON "referrals"("referrerUserId", "createdAt" DESC);

CREATE INDEX "users_referredByUserId_idx" ON "users"("referredByUserId");

ALTER TABLE "users"
  ADD CONSTRAINT "users_referredByUserId_fkey"
  FOREIGN KEY ("referredByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_walletUserId_fkey"
  FOREIGN KEY ("walletUserId") REFERENCES "wallets"("userId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_codes"
  ADD CONSTRAINT "referral_codes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referrals"
  ADD CONSTRAINT "referrals_referrerUserId_fkey"
  FOREIGN KEY ("referrerUserId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referrals"
  ADD CONSTRAINT "referrals_referredUserId_fkey"
  FOREIGN KEY ("referredUserId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Bootstrap existing users: 500 welcome points + referral codes
INSERT INTO "wallets" ("userId", "balance", "lifetimeEarned", "lifetimeSpent", "updatedAt")
SELECT
  u."id",
  500,
  500,
  0,
  CURRENT_TIMESTAMP
FROM "users" u
WHERE u."status" = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM "wallets" w WHERE w."userId" = u."id");

INSERT INTO "wallet_transactions" (
  "id",
  "walletUserId",
  "type",
  "amount",
  "balanceAfter",
  "referenceType",
  "idempotencyKey",
  "description"
)
SELECT
  gen_random_uuid(),
  w."userId",
  'WELCOME_BONUS',
  500,
  500,
  'bootstrap',
  'bootstrap:' || w."userId"::text,
  'Welcome bonus'
FROM "wallets" w
WHERE NOT EXISTS (
  SELECT 1
  FROM "wallet_transactions" wt
  WHERE wt."idempotencyKey" = 'bootstrap:' || w."userId"::text
);

INSERT INTO "referral_codes" ("userId", "code")
SELECT
  u."id",
  upper(
    lpad(substr(regexp_replace(u."username", '[^a-zA-Z0-9]', '', 'g'), 1, 4), 4, 'X')
    || lpad((abs(hashtext(u."id"::text)) % 90 + 10)::text, 2, '0')
  )
FROM "users" u
WHERE u."status" = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM "referral_codes" rc WHERE rc."userId" = u."id")
ON CONFLICT DO NOTHING;
