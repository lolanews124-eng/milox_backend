-- Broadcast lists: admin-approved creators, unlimited match recipients, DM fan-out.
ALTER TYPE "ConversationKind" ADD VALUE IF NOT EXISTS 'BROADCAST';

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "broadcastEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "broadcast_recipients" (
  "conversationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("conversationId", "userId")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_recipients_conversationId_fkey'
  ) THEN
    ALTER TABLE "broadcast_recipients"
      ADD CONSTRAINT "broadcast_recipients_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_recipients_userId_fkey'
  ) THEN
    ALTER TABLE "broadcast_recipients"
      ADD CONSTRAINT "broadcast_recipients_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "broadcast_recipients_userId_idx" ON "broadcast_recipients"("userId");
