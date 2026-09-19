-- Free lifetime message allotment + unlimited-messaging plan flag.

ALTER TABLE "app_economy_configs"
  ADD COLUMN IF NOT EXISTS "freeMessageLimit" INTEGER NOT NULL DEFAULT 50;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "messagesSentCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "premium_plans"
  ADD COLUMN IF NOT EXISTS "unlimitedMessaging" BOOLEAN NOT NULL DEFAULT false;

-- Backfill lifetime outbound chat sends (TEXT + IMAGE only).
UPDATE "users" u
SET "messagesSentCount" = sub.cnt
FROM (
  SELECT m."senderId" AS id, COUNT(*)::int AS cnt
  FROM "messages" m
  WHERE m."type" IN ('TEXT', 'IMAGE')
  GROUP BY m."senderId"
) AS sub
WHERE u.id = sub.id;
