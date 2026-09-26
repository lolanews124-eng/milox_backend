-- Unique reel views, and hashtags / mentions stored with the caption.
ALTER TABLE "reels" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "reel_views" (
  "reelId" UUID NOT NULL,
  "viewerId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reel_views_pkey" PRIMARY KEY ("reelId", "viewerId")
);

CREATE INDEX "reel_views_viewerId_idx" ON "reel_views"("viewerId");

ALTER TABLE "reel_views"
  ADD CONSTRAINT "reel_views_reelId_fkey"
  FOREIGN KEY ("reelId") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reel_views"
  ADD CONSTRAINT "reel_views_viewerId_fkey"
  FOREIGN KEY ("viewerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reel_hashtags" (
  "reelId" UUID NOT NULL,
  "hashtagId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reel_hashtags_pkey" PRIMARY KEY ("reelId", "hashtagId")
);

CREATE INDEX "reel_hashtags_hashtagId_createdAt_idx"
  ON "reel_hashtags"("hashtagId", "createdAt");

ALTER TABLE "reel_hashtags"
  ADD CONSTRAINT "reel_hashtags_reelId_fkey"
  FOREIGN KEY ("reelId") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reel_hashtags"
  ADD CONSTRAINT "reel_hashtags_hashtagId_fkey"
  FOREIGN KEY ("hashtagId") REFERENCES "hashtags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
