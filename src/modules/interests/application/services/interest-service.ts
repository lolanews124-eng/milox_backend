import { createHash } from "node:crypto";

import type { InterestStatus } from "@prisma/client";

import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type { FeedCursorCodec } from "../../../feed/application/services/feed-cursor.js";
import type {
  InterestPageQuery,
  InterestRepository,
} from "../ports/interest-repository.js";
import {
  CannotInterestSelfError,
  InterestConflictError,
  InterestDailyLimitError,
  InterestIdempotencyConflictError,
} from "../ports/interest-repository.js";
import { InsufficientWalletBalanceError } from "../../../rewards/application/ports/rewards-repository.js";
import {
  presentInterest,
  presentMatch,
} from "../interest-view.js";

export interface InterestPage {
  items: object[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class InterestService {
  constructor(
    private readonly repository: InterestRepository,
    private readonly cursors: FeedCursorCodec,
    private readonly config: AppConfig,
  ) {}

  async create(
    senderId: string,
    input: { recipientId: string; message?: string | undefined },
    idempotencyKey: string,
  ): Promise<{ item: object; replayed: boolean }> {
    const message = normalizeMessage(input.message);
    try {
      const created = await this.repository.create({
        senderId,
        recipientId: input.recipientId,
        message,
        idempotencyKey,
        requestHash: hashRequest({
          recipientId: input.recipientId,
          message,
        }),
        dailyLimit: this.config.INTEREST_DAILY_LIMIT,
        interestSendCost: this.config.INTEREST_SEND_COST,
      });
      if (!created) throw new AppError("NOT_FOUND", "User not found", 404);
      return {
        item: presentInterest(created.interest, this.config),
        replayed: created.replayed,
      };
    } catch (error) {
      this.mapDomainError(error);
    }
  }

  listIncoming(
    userId: string,
    options: {
      status?: InterestStatus;
      cursor?: string;
      limit: number;
    },
  ): Promise<InterestPage> {
    return this.listInterests(userId, options, "incoming");
  }

  listOutgoing(
    userId: string,
    options: {
      status?: InterestStatus;
      cursor?: string;
      limit: number;
    },
  ): Promise<InterestPage> {
    return this.listInterests(userId, options, "outgoing");
  }

  async accept(interestId: string, recipientId: string): Promise<object> {
    try {
      const match = await this.repository.accept(interestId, recipientId);
      if (!match) throw interestNotFound();
      return presentMatch(match, this.config);
    } catch (error) {
      this.mapDomainError(error);
    }
  }

  async reject(interestId: string, recipientId: string): Promise<object> {
    return this.changeInterest("reject", interestId, recipientId);
  }

  async cancel(interestId: string, senderId: string): Promise<object> {
    return this.changeInterest("cancel", interestId, senderId);
  }

  async listMatches(
    userId: string,
    options: { cursor?: string; limit: number },
  ): Promise<InterestPage> {
    const cursor = this.decodeChronologicalCursor(options.cursor, "matches");
    const rows = await this.repository.listMatches({
      userId,
      limit: options.limit,
      ...(cursor
        ? {
            before: {
              id: cursor.id,
              matchedAt: new Date(cursor.createdAt),
            },
          }
        : {}),
    });
    return this.page(
      rows,
      options.limit,
      (match) => presentMatch(match, this.config),
      (match) => match.matchedAt,
    );
  }

  async unmatch(matchId: string, userId: string): Promise<void> {
    if (!(await this.repository.unmatch(matchId, userId))) {
      throw new AppError("MATCH_NOT_FOUND", "Active match not found", 404);
    }
  }

  private async listInterests(
    userId: string,
    options: {
      status?: InterestStatus;
      cursor?: string;
      limit: number;
    },
    direction: "incoming" | "outgoing",
  ): Promise<InterestPage> {
    const cursor = this.decodeChronologicalCursor(
      options.cursor,
      "interests",
    );
    const query: InterestPageQuery = {
      userId,
      limit: options.limit,
      ...(options.status ? { status: options.status } : {}),
      ...(cursor
        ? {
            before: {
              id: cursor.id,
              createdAt: new Date(cursor.createdAt),
            },
          }
        : {}),
    };
    const rows =
      direction === "incoming"
        ? await this.repository.listIncoming(query)
        : await this.repository.listOutgoing(query);
    return this.page(
      rows,
      options.limit,
      (interest) => presentInterest(interest, this.config),
      (interest) => interest.createdAt,
    );
  }

  private async changeInterest(
    action: "reject" | "cancel",
    interestId: string,
    userId: string,
  ): Promise<object> {
    try {
      const interest = await this.repository[action](interestId, userId);
      if (!interest) throw interestNotFound();
      return presentInterest(interest, this.config);
    } catch (error) {
      this.mapDomainError(error);
    }
  }

  private page<T extends { id: string }>(
    rows: T[],
    limit: number,
    present: (row: T) => object,
    timestamp: (row: T) => Date,
  ): InterestPage {
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(present),
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.id,
              createdAt: timestamp(last).toISOString(),
            })
          : null,
      hasMore,
    };
  }

  private decodeChronologicalCursor(
    encoded: string | undefined,
    resource: string,
  ) {
    const cursor = encoded ? this.cursors.decode(encoded) : undefined;
    if (cursor && cursor.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        `This cursor cannot be used for ${resource}`,
        400,
      );
    }
    return cursor;
  }

  private mapDomainError(error: unknown): never {
    if (error instanceof CannotInterestSelfError) {
      throw new AppError(
        "CANNOT_INTEREST_SELF",
        "You cannot send interest to yourself",
        422,
      );
    }
    if (error instanceof InterestDailyLimitError) {
      throw new AppError(
        "INTEREST_DAILY_LIMIT",
        "Daily interest limit reached",
        429,
      );
    }
    if (error instanceof InsufficientWalletBalanceError) {
      throw new AppError(
        "INSUFFICIENT_WALLET_BALANCE",
        "Not enough Milox Points to send interest",
        402,
      );
    }
    if (error instanceof InterestIdempotencyConflictError) {
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        "This idempotency key was used with different input",
        409,
      );
    }
    if (error instanceof InterestConflictError) {
      const codeByReason: Record<string, string> = {
        already_pending: "INTEREST_ALREADY_PENDING",
        already_matched: "ALREADY_MATCHED",
        not_pending: "INTEREST_NOT_PENDING",
      };
      throw new AppError(
        codeByReason[error.message] ?? "CONFLICT",
        "The interest action conflicts with its current state",
        409,
      );
    }
    throw error;
  }
}

function normalizeMessage(message: string | undefined): string | null {
  const normalized = message?.trim();
  return normalized ? normalized : null;
}

function hashRequest(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function interestNotFound(): AppError {
  return new AppError("INTEREST_NOT_FOUND", "Interest not found", 404);
}
