ALTER TABLE "reels" ADD COLUMN "posterMediaId" UUID;

CREATE UNIQUE INDEX "reels_posterMediaId_key" ON "reels"("posterMediaId");

ALTER TABLE "reels" ADD CONSTRAINT "reels_posterMediaId_fkey" FOREIGN KEY ("posterMediaId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
