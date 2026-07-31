import type { Prisma } from "@prisma/client";
import { ConversationKind, MatchStatus } from "@prisma/client";

import { visibleUserCardWhere } from "../../posts/infrastructure/post-query-policy.js";
import { publicAuthorSelect } from "../../posts/infrastructure/post-query-policy.js";

export function messageViewSelect() {
  return {
    id: true,
    conversationId: true,
    senderId: true,
    replyToId: true,
    type: true,
    body: true,
    metadata: true,
    deliveryStatus: true,
    deletedForEveryoneAt: true,
    editedAt: true,
    createdAt: true,
    updatedAt: true,
    mediaAsset: {
      select: {
        id: true,
        kind: true,
        mimeType: true,
        width: true,
        height: true,
        blurHash: true,
        createdAt: true,
      },
    },
  } satisfies Prisma.MessageSelect;
}

export function conversationViewSelect(userId: string) {
  return {
    id: true,
    kind: true,
    matchId: true,
    recipientUserId: true,
    updatedAt: true,
    members: {
      where: { userId },
      take: 1,
      select: {
        unreadCount: true,
        isMuted: true,
        isPinned: true,
        isArchived: true,
      },
    },
    peerMembers: {
      where: { userId: { not: userId }, leftAt: null },
      take: 1,
      select: {
        user: { select: publicAuthorSelect() },
      },
    },
    match: {
      select: {
        userAId: true,
        userA: { select: publicAuthorSelect() },
        userB: { select: publicAuthorSelect() },
      },
    },
    messages: {
      where: { deletions: { none: { userId } } },
      orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
      take: 1,
      select: messageViewSelect(),
    },
  } satisfies Prisma.ConversationSelect;
}

export function activeConversationWhere(
  userId: string,
  conversationId?: string,
): Prisma.ConversationWhereInput {
  return {
    ...(conversationId ? { id: conversationId } : {}),
    status: "ACTIVE",
    members: { some: { userId, leftAt: null } },
    OR: [
      {
        kind: ConversationKind.OFFICIAL,
        recipientUserId: userId,
      },
      {
        kind: ConversationKind.MATCH,
        match: {
          is: {
            status: MatchStatus.ACTIVE,
            OR: [
              {
                userAId: userId,
                userB: { is: visibleUserCardWhere(userId) },
              },
              {
                userBId: userId,
                userA: { is: visibleUserCardWhere(userId) },
              },
            ],
          },
        },
      },
    ],
  };
}
