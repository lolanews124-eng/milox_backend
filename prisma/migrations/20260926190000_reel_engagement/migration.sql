-- Reel shares, comment replies/likes, and hashtag reel counts.
ALTER TABLE "reels" ADD COLUMN "shareCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "reel_comments" ADD COLUMN "parentId" UUID;
ALTER TABLE "reel_comments" ADD COLUMN "likeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "reel_comments" ADD COLUMN "replyCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "reel_comments" ADD COLUMN "depth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "reel_comments" ALTER COLUMN "body" SET DATA TYPE VARCHAR(1000);

ALTER TABLE "reel_comments"
  ADD CONSTRAINT "reel_comments_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "reel_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "reel_comments_parentId_idx" ON "reel_comments"("parentId");

CREATE TABLE "reel_comment_likes" (
  "commentId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reel_comment_likes_pkey" PRIMARY KEY ("commentId", "userId")
);

CREATE INDEX "reel_comment_likes_userId_idx" ON "reel_comment_likes"("userId");

ALTER TABLE "reel_comment_likes"
  ADD CONSTRAINT "reel_comment_likes_commentId_fkey"
  FOREIGN KEY ("commentId") REFERENCES "reel_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reel_comment_likes"
  ADD CONSTRAINT "reel_comment_likes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reel_shares" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reelId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reel_shares_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reel_shares_reelId_createdAt_idx" ON "reel_shares"("reelId", "createdAt");
CREATE INDEX "reel_shares_userId_createdAt_idx" ON "reel_shares"("userId", "createdAt");

ALTER TABLE "reel_shares"
  ADD CONSTRAINT "reel_shares_reelId_fkey"
  FOREIGN KEY ("reelId") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reel_shares"
  ADD CONSTRAINT "reel_shares_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hashtags" ADD COLUMN "reelCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "hashtags_reelCount_lastUsedAt_idx" ON "hashtags"("reelCount", "lastUsedAt");

UPDATE "hashtags" AS h
SET "reelCount" = sub.cnt
FROM (
  SELECT rh."hashtagId", COUNT(*)::int AS cnt
  FROM "reel_hashtags" rh
  INNER JOIN "reels" r ON r.id = rh."reelId"
  WHERE r."deletedAt" IS NULL
  GROUP BY rh."hashtagId"
) AS sub
WHERE h.id = sub."hashtagId";
