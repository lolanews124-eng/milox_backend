import type { InterestStatus } from "@prisma/client";

import type {
  InterestViewRecord,
  MatchViewRecord,
} from "../interest-view.js";

export interface CreateInterestData {
  senderId: string;
  recipientId: string;
  message: string | null;
  idempotencyKey: string;
  requestHash: string;
  dailyLimit: number;
  interestSendCost: number;
}

export interface InterestPageQuery {
  userId: string;
  status?: InterestStatus;
  limit: number;
  before?: { id: string; createdAt: Date };
}

export interface MatchPageQuery {
  userId: string;
  limit: number;
  before?: { id: string; matchedAt: Date };
}

export interface CreatedInterest {
  interest: InterestViewRecord;
  replayed: boolean;
}

export interface InterestRepository {
  create(data: CreateInterestData): Promise<CreatedInterest | null>;
  listIncoming(query: InterestPageQuery): Promise<InterestViewRecord[]>;
  listOutgoing(query: InterestPageQuery): Promise<InterestViewRecord[]>;
  accept(interestId: string, recipientId: string): Promise<MatchViewRecord | null>;
  reject(
    interestId: string,
    recipientId: string,
  ): Promise<InterestViewRecord | null>;
  cancel(
    interestId: string,
    senderId: string,
  ): Promise<InterestViewRecord | null>;
  listMatches(query: MatchPageQuery): Promise<MatchViewRecord[]>;
  unmatch(matchId: string, userId: string): Promise<boolean>;
}

export class CannotInterestSelfError extends Error {}
export class InterestConflictError extends Error {}
export class InterestDailyLimitError extends Error {}
export class InterestIdempotencyConflictError extends Error {}
