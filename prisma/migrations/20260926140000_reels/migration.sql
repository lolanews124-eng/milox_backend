ALTER TYPE "MediaKind" ADD VALUE IF NOT EXISTS 'REEL_VIDEO';

CREATE TABLE "reels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "authorId" UUID NOT NULL,
    "mediaAssetId" UUID NOT NULL,
    "caption" VARCHAR(300),
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reels_mediaAssetId_key" ON "reels"("mediaAssetId");
CREATE INDEX "reels_authorId_createdAt_idx" ON "reels"("authorId", "createdAt");
CREATE INDEX "reels_createdAt_idx" ON "reels"("createdAt");
CREATE INDEX "reels_deletedAt_createdAt_idx" ON "reels"("deletedAt", "createdAt");

ALTER TABLE "reels" ADD CONSTRAINT "reels_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reels" ADD CONSTRAINT "reels_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "reel_likes" (
    "reelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_likes_pkey" PRIMARY KEY ("reelId","userId")
);

CREATE INDEX "reel_likes_userId_idx" ON "reel_likes"("userId");

ALTER TABLE "reel_likes" ADD CONSTRAINT "reel_likes_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reel_likes" ADD CONSTRAINT "reel_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reel_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reelId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reel_comments_reelId_createdAt_idx" ON "reel_comments"("reelId", "createdAt");
CREATE INDEX "reel_comments_authorId_idx" ON "reel_comments"("authorId");

ALTER TABLE "reel_comments" ADD CONSTRAINT "reel_comments_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reel_comments" ADD CONSTRAINT "reel_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
