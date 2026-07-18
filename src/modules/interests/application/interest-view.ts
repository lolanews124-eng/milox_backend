import type { InterestStatus } from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import {
  presentPublicAuthor,
  type PostAuthorViewRecord,
} from "../../posts/application/post-view.js";

export interface InterestViewRecord {
  id: string;
  status: InterestStatus;
  message: string | null;
  createdAt: Date;
  respondedAt: Date | null;
  sender: PostAuthorViewRecord;
  recipient: PostAuthorViewRecord;
}

export interface MatchViewRecord {
  id: string;
  conversationId: string;
  matchedAt: Date;
  peer: PostAuthorViewRecord;
}

export function presentInterest(
  interest: InterestViewRecord,
  config: AppConfig,
): object {
  return {
    id: interest.id,
    sender: presentPublicAuthor(interest.sender, config),
    recipient: presentPublicAuthor(interest.recipient, config),
    status: interest.status,
    message: interest.message,
    createdAt: interest.createdAt.toISOString(),
    respondedAt: interest.respondedAt?.toISOString() ?? null,
  };
}

export function presentMatch(
  match: MatchViewRecord,
  config: AppConfig,
): object {
  return {
    id: match.id,
    peer: presentPublicAuthor(match.peer, config),
    conversationId: match.conversationId,
    matchedAt: match.matchedAt.toISOString(),
  };
}
