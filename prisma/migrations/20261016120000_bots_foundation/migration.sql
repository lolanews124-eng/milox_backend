-- Bot management foundation (additive only). Does not create bot users.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "isAutomatedAccount" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "users_isAutomatedAccount_status_idx" ON "users"("isAutomatedAccount", "status");

-- CreateEnum
CREATE TYPE "BotAccountStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "BotCandidateBatchStatus" AS ENUM ('PREVIEWED', 'SELECTION_LOCKED', 'PROVISIONING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BotActivityJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BotActivityType" AS ENUM ('LIKE_POST', 'COMMENT_POST', 'FOLLOW_USER', 'VIEW_POST', 'VIEW_STORY', 'VIEW_REEL');

-- CreateTable
CREATE TABLE "bot_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "killSwitch" BOOLEAN NOT NULL DEFAULT true,
    "globalPause" BOOLEAN NOT NULL DEFAULT true,
    "maxConcurrency" INTEGER NOT NULL DEFAULT 3,
    "activityLimits" JSONB NOT NULL DEFAULT '{}',
    "commentTemplates" JSONB NOT NULL DEFAULT '[]',
    "usernameSuffix" VARCHAR(16) NOT NULL DEFAULT '_mx',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_candidate_batches" (
    "id" UUID NOT NULL,
    "criteriaVersion" VARCHAR(64) NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "rankedAt" TIMESTAMP(3) NOT NULL,
    "previewSnapshot" JSONB NOT NULL DEFAULT '[]',
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "previewCount" INTEGER NOT NULL DEFAULT 0,
    "selectedUserIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "BotCandidateBatchStatus" NOT NULL DEFAULT 'PREVIEWED',
    "createdByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_candidate_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "BotAccountStatus" NOT NULL DEFAULT 'PAUSED',
    "sourceCandidateUserId" UUID,
    "candidateBatchId" UUID,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "provisionedByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_activity_jobs" (
    "id" UUID NOT NULL,
    "botAccountId" UUID NOT NULL,
    "activityType" "BotActivityType" NOT NULL,
    "targetType" VARCHAR(32) NOT NULL,
    "targetId" UUID NOT NULL,
    "status" "BotActivityJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "idempotencyKey" VARCHAR(191) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_activity_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_candidate_batches_status_createdAt_idx" ON "bot_candidate_batches"("status", "createdAt");

-- CreateIndex
CREATE INDEX "bot_candidate_batches_createdByAdminId_createdAt_idx" ON "bot_candidate_batches"("createdByAdminId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bot_accounts_userId_key" ON "bot_accounts"("userId");

-- CreateIndex
CREATE INDEX "bot_accounts_status_createdAt_idx" ON "bot_accounts"("status", "createdAt");

-- CreateIndex
CREATE INDEX "bot_accounts_sourceCandidateUserId_idx" ON "bot_accounts"("sourceCandidateUserId");

-- CreateIndex
CREATE INDEX "bot_accounts_candidateBatchId_idx" ON "bot_accounts"("candidateBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_activity_jobs_idempotencyKey_key" ON "bot_activity_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "bot_activity_jobs_status_availableAt_idx" ON "bot_activity_jobs"("status", "availableAt");

-- CreateIndex
CREATE INDEX "bot_activity_jobs_botAccountId_createdAt_idx" ON "bot_activity_jobs"("botAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "bot_candidate_batches" ADD CONSTRAINT "bot_candidate_batches_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_accounts" ADD CONSTRAINT "bot_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_accounts" ADD CONSTRAINT "bot_accounts_sourceCandidateUserId_fkey" FOREIGN KEY ("sourceCandidateUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_accounts" ADD CONSTRAINT "bot_accounts_provisionedByAdminId_fkey" FOREIGN KEY ("provisionedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_accounts" ADD CONSTRAINT "bot_accounts_candidateBatchId_fkey" FOREIGN KEY ("candidateBatchId") REFERENCES "bot_candidate_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_activity_jobs" ADD CONSTRAINT "bot_activity_jobs_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "bot_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed singleton settings (kill switch on; worker remains disabled via env).
INSERT INTO "bot_settings" ("id", "killSwitch", "globalPause", "maxConcurrency", "activityLimits", "commentTemplates", "usernameSuffix", "updatedAt")
VALUES (
  'default',
  true,
  true,
  3,
  '{"likesEnabled":true,"commentsEnabled":true,"followsEnabled":true,"viewsEnabled":false}'::jsonb,
  '[]'::jsonb,
  '_mx',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
