-- Reel review queue, and an admin switch for the app's Reels tab.
CREATE TYPE "ReelReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "reels" ADD COLUMN "status" "ReelReviewStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "reels" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "reels" ADD COLUMN "reviewedById" UUID;
ALTER TABLE "reels" ADD COLUMN "rejectReason" VARCHAR(300);

-- Reels that already existed were public. Keep them in the feed.
UPDATE "reels" SET "status" = 'APPROVED', "reviewedAt" = "createdAt";

ALTER TABLE "reels"
  ADD CONSTRAINT "reels_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "reels_status_deletedAt_createdAt_idx"
  ON "reels"("status", "deletedAt", "createdAt");

ALTER TABLE "mobile_app_configs"
  ADD COLUMN "reelsEnabled" BOOLEAN NOT NULL DEFAULT true;
