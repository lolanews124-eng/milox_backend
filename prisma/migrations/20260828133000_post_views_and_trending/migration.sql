ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "viewCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "post_views" (
  "postId" UUID NOT NULL,
  "viewerId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_views_pkey" PRIMARY KEY ("postId","viewerId")
);

CREATE INDEX IF NOT EXISTS "post_views_viewerId_idx" ON "post_views"("viewerId");
CREATE INDEX IF NOT EXISTS "post_views_postId_createdAt_idx" ON "post_views"("postId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "post_views"
    ADD CONSTRAINT "post_views_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "post_views"
    ADD CONSTRAINT "post_views_viewerId_fkey"
    FOREIGN KEY ("viewerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
