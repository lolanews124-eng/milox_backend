-- Lock existing usernames from account creation date when no change timestamp exists.
UPDATE "User"
SET "usernameChangedAt" = "createdAt"
WHERE "usernameChangedAt" IS NULL;
