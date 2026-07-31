-- Lock existing usernames from account creation date when no change timestamp exists.
UPDATE "users"
SET "usernameChangedAt" = "createdAt"
WHERE "usernameChangedAt" IS NULL;
