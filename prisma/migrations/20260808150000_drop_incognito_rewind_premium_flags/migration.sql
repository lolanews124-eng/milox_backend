-- Remove incognito / rewind from premium plans (features not offered).

UPDATE "premium_plans"
SET
  "incognitoBrowse" = false,
  "rewindPass" = false,
  "description" = CASE "code"
    WHEN 'MILOX_GOLD' THEN 'Stronger discover presence and no house ads.'
    ELSE "description"
  END
WHERE "incognitoBrowse" = true OR "rewindPass" = true OR "code" = 'MILOX_GOLD';
