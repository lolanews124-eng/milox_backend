-- Milox Connect: ultimate all-in-one premium plan (most expensive, every feature).

UPDATE "premium_plans"
SET "sortOrder" = CASE "code"
  WHEN 'MILOX_PLUS' THEN 1
  WHEN 'MILOX_GOLD' THEN 2
  WHEN 'MILOX_ELITE' THEN 3
  WHEN 'MILOX_CONNECT' THEN 4
  ELSE "sortOrder"
END
WHERE "code" IN ('MILOX_PLUS', 'MILOX_GOLD', 'MILOX_ELITE', 'MILOX_CONNECT');

UPDATE "premium_plans"
SET
  "name" = 'Milox Connect',
  "description" = 'Everything in Milox — direct messages, verified badge, unlimited interests, max discover boost, and fully ad-free.',
  "tier" = 'ELITE',
  "sortOrder" = 4,
  "badgeLabel" = 'Connect',
  "priceCents" = 2499,
  "adsFree" = true,
  "houseAdsFree" = true,
  "profileViews" = true,
  "discoverBoost" = 3,
  "grantVerifiedBadge" = true,
  "dailyInterestLimit" = 9999,
  "interstitialAdsFree" = true,
  "directMessageEnabled" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'MILOX_CONNECT';
