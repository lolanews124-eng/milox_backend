-- Bot activity engine: job metadata + SKIPPED status (additive).

ALTER TYPE "BotActivityJobStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';

ALTER TABLE "bot_activity_jobs"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}';
