-- Milox Connect: premium direct messaging without interest + DIRECT conversation kind.

ALTER TYPE "ConversationKind" ADD VALUE IF NOT EXISTS 'DIRECT';

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "directUserLowId" UUID,
  ADD COLUMN IF NOT EXISTS "directUserHighId" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_directUserLowId_directUserHighId_key"
  ON "conversations"("directUserLowId", "directUserHighId");

CREATE INDEX IF NOT EXISTS "conversations_kind_directUserLowId_directUserHighId_idx"
  ON "conversations"("kind", "directUserLowId", "directUserHighId");

ALTER TABLE "premium_plans"
  ADD COLUMN IF NOT EXISTS "directMessageEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "premium_plans"
SET "sortOrder" = CASE "code"
  WHEN 'MILOX_GOLD' THEN 3
  WHEN 'MILOX_ELITE' THEN 4
  ELSE "sortOrder"
END
WHERE "code" IN ('MILOX_GOLD', 'MILOX_ELITE');

INSERT INTO "premium_plans" (
  "id", "code", "name", "description", "tier", "sortOrder", "badgeLabel",
  "priceCents", "currency", "durationDays",
  "adsFree", "houseAdsFree", "profileViews", "discoverBoost", "grantVerifiedBadge",
  "dailyInterestLimit", "interstitialAdsFree", "directMessageEnabled",
  "incognitoBrowse", "rewindPass",
  "isActive", "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid(),
  'MILOX_CONNECT',
  'Milox Connect',
  'Everything in Milox — direct messages, verified badge, unlimited interests, max discover boost, and fully ad-free.',
  'ELITE', 4, 'Connect',
  2499, 'USD', 30,
  true, true, true, 3, true,
  9999, true, true,
  false, false,
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "tier" = EXCLUDED."tier",
  "sortOrder" = EXCLUDED."sortOrder",
  "badgeLabel" = EXCLUDED."badgeLabel",
  "priceCents" = EXCLUDED."priceCents",
  "adsFree" = EXCLUDED."adsFree",
  "houseAdsFree" = EXCLUDED."houseAdsFree",
  "profileViews" = EXCLUDED."profileViews",
  "discoverBoost" = EXCLUDED."discoverBoost",
  "grantVerifiedBadge" = EXCLUDED."grantVerifiedBadge",
  "dailyInterestLimit" = EXCLUDED."dailyInterestLimit",
  "directMessageEnabled" = EXCLUDED."directMessageEnabled",
  "interstitialAdsFree" = EXCLUDED."interstitialAdsFree",
  "updatedAt" = CURRENT_TIMESTAMP;
