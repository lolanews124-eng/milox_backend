-- Extend ad system for placement-managed house ads (Meta-style admin control).

ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'NOTIFICATIONS';
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'MATCHES';
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'INTERESTS';
ALTER TYPE "AdPlacement" ADD VALUE IF NOT EXISTS 'PROFILE';

ALTER TABLE "advertisements"
  ADD COLUMN IF NOT EXISTS "ctaLabel" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "insertEvery" INTEGER,
  ADD COLUMN IF NOT EXISTS "impressionCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "clickCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "advertisements_placement_priority_idx"
  ON "advertisements"("placement", "priority" DESC);

CREATE TABLE IF NOT EXISTS "ad_placement_configs" (
  "placement" "AdPlacement" NOT NULL,
  "label" VARCHAR(80) NOT NULL,
  "description" VARCHAR(255),
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "insertEvery" INTEGER NOT NULL DEFAULT 5,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ad_placement_configs_pkey" PRIMARY KEY ("placement")
);

INSERT INTO "ad_placement_configs" ("placement", "label", "description", "isEnabled", "insertEvery", "updatedAt")
VALUES
  ('FEED', 'Home feed', 'Inline sponsored cards between posts', true, 5, CURRENT_TIMESTAMP),
  ('DISCOVER', 'Discover', 'Inline cards in the discover people grid', true, 5, CURRENT_TIMESTAMP),
  ('NOTIFICATIONS', 'Alerts', 'Inline cards in the notifications list', true, 5, CURRENT_TIMESTAMP),
  ('MATCHES', 'Matches', 'Cards in matches and interests surfaces', true, 6, CURRENT_TIMESTAMP),
  ('INTERESTS', 'Interests', 'Cards in sent/received interests lists', true, 6, CURRENT_TIMESTAMP),
  ('PROFILE', 'Profile', 'Banner on profile views', true, 1, CURRENT_TIMESTAMP),
  ('SIDEBAR', 'Web sidebar', 'Desktop web right rail', true, 1, CURRENT_TIMESTAMP),
  ('SPLASH', 'App splash', 'Full-screen promo on app open (future)', false, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("placement") DO NOTHING;
