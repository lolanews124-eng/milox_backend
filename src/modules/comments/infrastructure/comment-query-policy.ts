import type { Prisma } from "@prisma/client";

import { publicAuthorSelect } from "../../posts/infrastructure/post-query-policy.js";

export function commentViewSelect(viewerId?: string) {
  return {
    id: true,
    postId: true,
    parentId: true,
    body: true,
    likeCount: true,
    replyCount: true,
    depth: true,
    createdAt: true,
    updatedAt: true,
    author: { select: publicAuthorSelect() },
    likes: viewerId
      ? {
          where: { userId: viewerId },
          select: { userId: true },
          take: 1,
        }
      : {
          select: { userId: true },
          take: 0,
        },
  } satisfies Prisma.CommentSelect;
}
