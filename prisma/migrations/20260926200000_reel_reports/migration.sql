-- Reel reports are stored for admin review. They do not hide the reel.
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'REEL';

ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "reelId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reports_reelId_fkey'
  ) THEN
    ALTER TABLE "reports"
      ADD CONSTRAINT "reports_reelId_fkey"
      FOREIGN KEY ("reelId") REFERENCES "reels"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "reports_reelId_idx" ON "reports"("reelId");
