-- Group chats: kind, title, creator, member roles.

ALTER TYPE "ConversationKind" ADD VALUE IF NOT EXISTS 'GROUP';

DO $$ BEGIN
  CREATE TYPE "ConversationMemberRole" AS ENUM ('MEMBER', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "title" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "createdByUserId" UUID;

CREATE INDEX IF NOT EXISTS "conversations_kind_createdByUserId_idx"
  ON "conversations" ("kind", "createdByUserId");

DO $$ BEGIN
  ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "conversation_members"
  ADD COLUMN IF NOT EXISTS "role" "ConversationMemberRole" NOT NULL DEFAULT 'MEMBER';
