CREATE TYPE "ProfileWarningKind" AS ENUM ('WARN', 'CONTENT_REMOVED', 'RESTRICT', 'SUSPEND');

CREATE TABLE "profile_warnings" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "actorId" UUID,
  "reportId" UUID,
  "kind" "ProfileWarningKind" NOT NULL,
  "reasonCode" VARCHAR(64) NOT NULL,
  "message" VARCHAR(500) NOT NULL,
  "scoreDelta" INTEGER NOT NULL,
  "restrictUntil" TIMESTAMP(3),
  "postId" UUID,
  "storyId" UUID,
  "reelId" UUID,
  "commentId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profile_warnings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "profile_warnings_userId_createdAt_idx"
  ON "profile_warnings"("userId", "createdAt");

CREATE INDEX "profile_warnings_userId_restrictUntil_idx"
  ON "profile_warnings"("userId", "restrictUntil");

CREATE INDEX "profile_warnings_userId_reasonCode_createdAt_idx"
  ON "profile_warnings"("userId", "reasonCode", "createdAt");

ALTER TABLE "profile_warnings"
  ADD CONSTRAINT "profile_warnings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "profile_warnings"
  ADD CONSTRAINT "profile_warnings_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "profile_warnings"
  ADD CONSTRAINT "profile_warnings_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
