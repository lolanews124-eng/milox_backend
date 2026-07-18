import type { Prisma } from "@prisma/client";

import { publicAuthorSelect } from "../../posts/infrastructure/post-query-policy.js";

export function interestViewSelect() {
  return {
    id: true,
    status: true,
    message: true,
    createdAt: true,
    respondedAt: true,
    sender: { select: publicAuthorSelect() },
    recipient: { select: publicAuthorSelect() },
  } satisfies Prisma.InterestSelect;
}

export function matchViewSelect() {
  return {
    id: true,
    matchedAt: true,
    userAId: true,
    userA: { select: publicAuthorSelect() },
    userB: { select: publicAuthorSelect() },
    conversation: { select: { id: true } },
  } satisfies Prisma.MatchSelect;
}
