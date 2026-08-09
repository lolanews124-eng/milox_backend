-- Milox Plus should allow more daily interests than the free tier (20).
UPDATE "premium_plans"
SET "dailyInterestLimit" = 30
WHERE "code" = 'MILOX_PLUS'
  AND "dailyInterestLimit" < 30;
