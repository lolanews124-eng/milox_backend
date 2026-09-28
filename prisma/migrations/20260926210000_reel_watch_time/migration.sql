-- How long each viewer actually played a reel. Used only by reel ranking.
ALTER TABLE "reel_views" ADD COLUMN "watchedMs" INTEGER NOT NULL DEFAULT 0;
