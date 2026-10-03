-- CreateEnum
CREATE TYPE "EmailCampaignStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENDING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailCampaignRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "EmailJobType" ADD VALUE 'MARKETING';

-- AlterTable
ALTER TABLE "app_economy_configs" ALTER COLUMN "id" SET DEFAULT 'default';

-- AlterTable
ALTER TABLE "mobile_app_configs" ALTER COLUMN "id" SET DEFAULT 'default';

-- AlterTable
ALTER TABLE "paypal_settings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "premium_plan_prices" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "razorpay_settings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reel_comments" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reel_shares" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reels" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "marketingEmailOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "audienceInactiveDays" INTEGER NOT NULL DEFAULT 14,
    "requireEmailVerified" BOOLEAN NOT NULL DEFAULT true,
    "status" "EmailCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByAdminId" UUID,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaign_recipients" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "toEmail" VARCHAR(255) NOT NULL,
    "status" "EmailCampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "emailJobId" UUID,
    "lastError" VARCHAR(1000),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "apiUrl" VARCHAR(255) NOT NULL DEFAULT 'https://api.zeptomail.in/v1.1/email',
    "apiToken" TEXT NOT NULL DEFAULT '',
    "fromAddress" VARCHAR(255) NOT NULL DEFAULT 'noreply@milox.in',
    "fromName" VARCHAR(120) NOT NULL DEFAULT 'Milox',
    "bounceAddress" VARCHAR(255) NOT NULL DEFAULT '',
    "agentAlias" VARCHAR(120) NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_campaigns_status_createdAt_idx" ON "email_campaigns"("status", "createdAt");

-- CreateIndex
CREATE INDEX "email_campaign_recipients_campaignId_status_idx" ON "email_campaign_recipients"("campaignId", "status");

-- CreateIndex
CREATE INDEX "email_campaign_recipients_status_createdAt_idx" ON "email_campaign_recipients"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_campaign_recipients_campaignId_userId_key" ON "email_campaign_recipients"("campaignId", "userId");

-- AddForeignKey
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
