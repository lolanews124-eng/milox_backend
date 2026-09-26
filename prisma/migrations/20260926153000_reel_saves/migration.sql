CREATE TABLE "reel_saves" (
    "reelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_saves_pkey" PRIMARY KEY ("reelId","userId")
);

CREATE INDEX "reel_saves_userId_idx" ON "reel_saves"("userId");

ALTER TABLE "reel_saves" ADD CONSTRAINT "reel_saves_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "reels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reel_saves" ADD CONSTRAINT "reel_saves_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
