-- CreateEnum
CREATE TYPE "UgcModerationState" AS ENUM ('APPROVED', 'PENDING', 'REJECTED', 'REMOVED');

-- AlterTable posts
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "moderationState" "UgcModerationState" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "moderationReason" VARCHAR(500);
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "moderatedAt" TIMESTAMP(3);

-- AlterTable comments
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "moderationState" "UgcModerationState" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "moderationReason" VARCHAR(500);
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "moderatedAt" TIMESTAMP(3);

-- AlterTable users (bio gate)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bioModerationState" "UgcModerationState" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bioModerationReason" VARCHAR(500);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bioModeratedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "posts_moderationState_createdAt_idx" ON "posts"("moderationState", "createdAt");
CREATE INDEX IF NOT EXISTS "comments_moderationState_createdAt_idx" ON "comments"("moderationState", "createdAt");
