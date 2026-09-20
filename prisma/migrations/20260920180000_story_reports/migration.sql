-- Story reports: any report soft-deletes the story immediately.
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'STORY';

ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "storyId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reports_storyId_fkey'
  ) THEN
    ALTER TABLE "reports"
      ADD CONSTRAINT "reports_storyId_fkey"
      FOREIGN KEY ("storyId") REFERENCES "stories"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "reports_storyId_idx" ON "reports"("storyId");
