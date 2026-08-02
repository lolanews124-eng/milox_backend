-- CreateTable
CREATE TABLE "profile_views" (
    "profileUserId" UUID NOT NULL,
    "viewerId" UUID NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_views_pkey" PRIMARY KEY ("profileUserId","viewerId")
);

-- CreateIndex
CREATE INDEX "profile_views_profileUserId_updatedAt_idx" ON "profile_views"("profileUserId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "profile_views_viewerId_idx" ON "profile_views"("viewerId");

-- AddForeignKey
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_profileUserId_fkey" FOREIGN KEY ("profileUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
