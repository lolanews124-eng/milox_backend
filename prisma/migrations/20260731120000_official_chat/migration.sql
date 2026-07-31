-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('MATCH', 'OFFICIAL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "isSystemAccount" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "kind" "ConversationKind" NOT NULL DEFAULT 'MATCH';
ALTER TABLE "conversations" ADD COLUMN "recipientUserId" UUID;
ALTER TABLE "conversations" ALTER COLUMN "matchId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "conversations_recipientUserId_key" ON "conversations"("recipientUserId");
CREATE INDEX "conversations_kind_recipientUserId_idx" ON "conversations"("kind", "recipientUserId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
