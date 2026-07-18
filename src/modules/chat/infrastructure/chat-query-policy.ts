import type { Prisma } from "@prisma/client";

import { publicAuthorSelect } from "../../posts/infrastructure/post-query-policy.js";

export function messageViewSelect() {
  return {
    id: true,
    conversationId: true,
    senderId: true,
    replyToId: true,
    type: true,
    body: true,
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
    matchId: true,
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
