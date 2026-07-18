-- Manual / companion SQL for constraints Prisma cannot express in schema.prisma.
-- Applied via: prisma migrate diff / custom migration SQL in Module 15+ or:
--   pnpm --filter @milox/api prisma:migrate:dev
--
-- This file documents required partial indexes and checks. The first real
-- migration should include these statements after table creation.

-- Only one PENDING interest may exist per sender→recipient pair.
CREATE UNIQUE INDEX IF NOT EXISTS interests_one_pending_per_pair
  ON interests ("senderId", "recipientId")
  WHERE status = 'PENDING';

-- Prevent self-follow.
ALTER TABLE follows
  DROP CONSTRAINT IF EXISTS follows_no_self;
ALTER TABLE follows
  ADD CONSTRAINT follows_no_self CHECK ("followerId" <> "followeeId");

-- Prevent self-block.
ALTER TABLE blocks
  DROP CONSTRAINT IF EXISTS blocks_no_self;
ALTER TABLE blocks
  ADD CONSTRAINT blocks_no_self CHECK ("blockerId" <> "blockedId");

-- Match pair ordering: user_a_id must be lexicographically less than user_b_id.
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_ordered_pair;
ALTER TABLE matches
  ADD CONSTRAINT matches_ordered_pair CHECK ("userAId" < "userBId");

-- Comment depth limited to top-level + one reply level.
ALTER TABLE comments
  DROP CONSTRAINT IF EXISTS comments_depth_range;
ALTER TABLE comments
  ADD CONSTRAINT comments_depth_range CHECK (depth >= 0 AND depth <= 1);

-- Only one unresolved report per reporter/post pair. The application performs
-- the same check for friendly errors; this index closes concurrent races.
CREATE UNIQUE INDEX IF NOT EXISTS reports_one_open_post_per_reporter
  ON reports ("reporterId", "postId")
  WHERE "targetType" = 'POST'
    AND status IN ('OPEN', 'UNDER_REVIEW')
    AND "postId" IS NOT NULL;

-- Message payload must match its type. User-created TEXT messages carry only
-- body; IMAGE messages carry an owned media asset; SYSTEM rows carry body.
-- Soft-deleted-for-everyone rows may clear body/media while keeping type.
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_payload_matches_type;
ALTER TABLE messages
  ADD CONSTRAINT messages_payload_matches_type CHECK (
    (
      "deletedForEveryoneAt" IS NOT NULL
      AND body IS NULL
      AND "mediaAssetId" IS NULL
    )
    OR (type = 'TEXT' AND body IS NOT NULL AND "mediaAssetId" IS NULL)
    OR (type = 'IMAGE' AND "mediaAssetId" IS NOT NULL)
    OR (type = 'SYSTEM' AND body IS NOT NULL)
  );

ALTER TABLE conversation_members
  DROP CONSTRAINT IF EXISTS conversation_members_unread_nonnegative;
ALTER TABLE conversation_members
  ADD CONSTRAINT conversation_members_unread_nonnegative
  CHECK ("unreadCount" >= 0);
