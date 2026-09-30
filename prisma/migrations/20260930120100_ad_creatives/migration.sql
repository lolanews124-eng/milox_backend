CREATE TYPE "AdFormat" AS ENUM ('IMAGE', 'CAROUSEL', 'VIDEO');
CREATE TYPE "AdMediaKind" AS ENUM ('IMAGE', 'VIDEO');

ALTER TABLE "advertisements"
  ADD COLUMN "format" "AdFormat" NOT NULL DEFAULT 'IMAGE';

CREATE TABLE "advertisement_placements" (
  "adId" UUID NOT NULL,
  "placement" "AdPlacement" NOT NULL,
  CONSTRAINT "advertisement_placements_pkey" PRIMARY KEY ("adId", "placement")
);

CREATE INDEX "advertisement_placements_placement_idx"
  ON "advertisement_placements"("placement");

ALTER TABLE "advertisement_placements"
  ADD CONSTRAINT "advertisement_placements_adId_fkey"
  FOREIGN KEY ("adId") REFERENCES "advertisements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "advertisement_assets" (
  "id" UUID NOT NULL,
  "adId" UUID NOT NULL,
  "kind" "AdMediaKind" NOT NULL,
  "url" VARCHAR(512) NOT NULL,
  "posterUrl" VARCHAR(512),
  "targetUrl" VARCHAR(512),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "advertisement_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "advertisement_assets_adId_sortOrder_idx"
  ON "advertisement_assets"("adId", "sortOrder");

ALTER TABLE "advertisement_assets"
  ADD CONSTRAINT "advertisement_assets_adId_fkey"
  FOREIGN KEY ("adId") REFERENCES "advertisements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "advertisement_placements" ("adId", "placement")
SELECT "id", "placement" FROM "advertisements"
ON CONFLICT DO NOTHING;

INSERT INTO "advertisement_assets" ("id", "adId", "kind", "url", "sortOrder")
SELECT gen_random_uuid(), "id", 'IMAGE', "imageUrl", 0
FROM "advertisements"
WHERE "imageUrl" IS NOT NULL;

INSERT INTO "ad_placement_configs" ("placement", "label", "description", "isEnabled", "insertEvery", "updatedAt")
VALUES
  ('REELS', 'Reels', 'Full-screen sponsored card between reels', true, 6, CURRENT_TIMESTAMP),
  ('STORIES', 'Stories', 'Sponsored story in the stories row', true, 4, CURRENT_TIMESTAMP)
ON CONFLICT ("placement") DO NOTHING;
