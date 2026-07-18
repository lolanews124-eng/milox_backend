import type { Prisma } from "@prisma/client";

import { publicAuthorSelect } from "../../posts/infrastructure/post-query-policy.js";

export function notificationViewSelect() {
  return {
    id: true,
    type: true,
    payload: true,
    isRead: true,
    readAt: true,
    createdAt: true,
    actor: { select: publicAuthorSelect() },
  } satisfies Prisma.NotificationSelect;
}
