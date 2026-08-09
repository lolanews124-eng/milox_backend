-- Merge duplicate chat threads created when premium users messaged before interest accept.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      m.id AS match_id,
      m."userAId" AS user_a,
      m."userBId" AS user_b,
      mc.id AS match_conv_id,
      dc.id AS direct_conv_id
    FROM matches m
    INNER JOIN conversations mc
      ON mc."matchId" = m.id
      AND mc.status = 'ACTIVE'
    INNER JOIN conversations dc
      ON dc.kind = 'DIRECT'
      AND dc."directUserLowId" = m."userAId"
      AND dc."directUserHighId" = m."userBId"
      AND dc.status = 'ACTIVE'
      AND dc."matchId" IS NULL
    WHERE m.status = 'ACTIVE'
  LOOP
    UPDATE messages
    SET "conversationId" = r.direct_conv_id
    WHERE "conversationId" = r.match_conv_id;

    UPDATE conversation_members cm_direct
    SET "unreadCount" = GREATEST(
      cm_direct."unreadCount",
      COALESCE(cm_match."unreadCount", 0)
    )
    FROM conversation_members cm_match
    WHERE cm_direct."conversationId" = r.direct_conv_id
      AND cm_match."conversationId" = r.match_conv_id
      AND cm_direct."userId" = cm_match."userId";

    UPDATE conversations
    SET "matchId" = NULL, status = 'CLOSED'
    WHERE id = r.match_conv_id;

    UPDATE conversations
    SET "matchId" = r.match_id, kind = 'MATCH'
    WHERE id = r.direct_conv_id;

    UPDATE conversations c
    SET "updatedAt" = COALESCE(
      (
        SELECT MAX("createdAt")
        FROM messages
        WHERE "conversationId" = r.direct_conv_id
      ),
      c."updatedAt"
    )
    WHERE c.id = r.direct_conv_id;
  END LOOP;
END $$;
