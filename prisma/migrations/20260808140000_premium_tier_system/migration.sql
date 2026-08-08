-- Premium tiers with feature flags and seeded Milox Plus / Gold / Elite plans.

CREATE TYPE "PremiumTier" AS ENUM ('FREE', 'PLUS', 'GOLD', 'ELITE');

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "premiumTier" "PremiumTier" NOT NULL DEFAULT 'FREE',
  ADD COLUMN IF NOT EXISTS "premiumExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "discoverBoost" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "users_premiumTier_discoverBoost_idx"
  ON "users"("premiumTier", "discoverBoost");

ALTER TABLE "premium_plans"
  ADD COLUMN IF NOT EXISTS "tier" "PremiumTier" NOT NULL DEFAULT 'PLUS',
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "badgeLabel" VARCHAR(40) NOT NULL DEFAULT 'Premium',
  ADD COLUMN IF NOT EXISTS "adsFree" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "houseAdsFree" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "profileViews" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "discoverBoost" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "grantVerifiedBadge" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "dailyInterestLimit" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "interstitialAdsFree" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "incognitoBrowse" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "rewindPass" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "premium_plans_tier_isActive_idx"
  ON "premium_plans"("tier", "isActive");

INSERT INTO "premium_plans" (
  "id", "code", "name", "description", "tier", "sortOrder", "badgeLabel",
  "priceCents", "currency", "durationDays",
  "adsFree", "houseAdsFree", "profileViews", "discoverBoost", "grantVerifiedBadge",
  "dailyInterestLimit", "interstitialAdsFree", "incognitoBrowse", "rewindPass",
  "isActive", "createdAt", "updatedAt"
)
VALUES
  (
    gen_random_uuid(),
    'MILOX_PLUS',
    'Milox Plus',
    'Ad-free browsing, profile viewers, and more daily interests.',
    'PLUS', 1, 'Plus',
    499, 'USD', 30,
    true, false, true, 1, false,
    10, true, false, false,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'MILOX_GOLD',
    'Milox Gold',
    'Stronger discover presence and no house ads.',
    'GOLD', 2, 'Gold',
    999, 'USD', 30,
    true, true, true, 2, false,
    20, true, false, false,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'MILOX_ELITE',
    'Milox Elite',
    'Maximum visibility, verified badge, and unlimited interests.',
    'ELITE', 3, 'Elite',
    1999, 'USD', 30,
    true, true, true, 3, true,
    9999, true, false, false,
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO NOTHING;
