-- Video calls (MATCH chat WebRTC) + app economy config

CREATE TYPE "CallSessionStatus" AS ENUM ('RINGING', 'ACTIVE', 'ENDED');
CREATE TYPE "CallEndReason" AS ENUM ('HANGUP', 'REJECT', 'TIMEOUT', 'BUSY', 'INSUFFICIENT_POINTS', 'UNMATCH', 'ERROR');

ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'VIDEO_CALL';

CREATE TABLE IF NOT EXISTS "call_sessions" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "callerId" UUID NOT NULL,
    "calleeId" UUID NOT NULL,
    "status" "CallSessionStatus" NOT NULL DEFAULT 'RINGING',
    "endReason" "CallEndReason",
    "ringingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "billedMinutes" INTEGER NOT NULL DEFAULT 0,
    "pointsCharged" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "app_economy_configs" (
    "id" VARCHAR(32) NOT NULL,
    "videoCallEnabled" BOOLEAN NOT NULL DEFAULT true,
    "videoCallPointsPerMinute" INTEGER NOT NULL DEFAULT 40,
    "videoCallRingTimeoutSec" INTEGER NOT NULL DEFAULT 45,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "app_economy_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "call_sessions_conversationId_status_idx" ON "call_sessions"("conversationId", "status");
CREATE INDEX IF NOT EXISTS "call_sessions_callerId_status_idx" ON "call_sessions"("callerId", "status");
CREATE INDEX IF NOT EXISTS "call_sessions_calleeId_status_idx" ON "call_sessions"("calleeId", "status");
CREATE INDEX IF NOT EXISTS "call_sessions_status_ringingAt_idx" ON "call_sessions"("status", "ringingAt");

DO $$ BEGIN
  ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "app_economy_configs" ("id", "videoCallEnabled", "videoCallPointsPerMinute", "videoCallRingTimeoutSec", "updatedAt")
VALUES ('default', true, 40, 45, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
