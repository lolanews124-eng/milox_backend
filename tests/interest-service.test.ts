import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { InterestRepository } from "../src/modules/interests/application/ports/interest-repository.js";
import {
  CannotInterestSelfError,
  InterestConflictError,
  InterestDailyLimitError,
} from "../src/modules/interests/application/ports/interest-repository.js";
import type {
  InterestViewRecord,
  MatchViewRecord,
} from "../src/modules/interests/application/interest-view.js";
import { InterestService } from "../src/modules/interests/application/services/interest-service.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "interest-service-secret-at-least-32",
  INTEREST_DAILY_LIMIT: 20,
  INTEREST_SEND_COST: 10,
} as AppConfig;
const senderId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const recipientId = "fca0622f-cba7-4398-bfe7-11842c026990";
const interestId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";
const matchId = "b9e27322-a92d-4b13-8ddc-3849a3b09a5a";
const key = "4c960e9a-592a-41e0-9942-2589f5dd0894";

describe("InterestService", () => {
  it("normalizes an idempotent send and applies the configured daily limit", async () => {
    const repository = createRepository();
    vi.mocked(repository.create).mockResolvedValue({
      interest: interestFixture(),
      replayed: false,
    });

    const result = await createService(repository).create(
      senderId,
      { recipientId, message: "  hello anonymously  " },
      key,
    );

    expect(result.replayed).toBe(false);
    expect(repository.create).toHaveBeenCalledWith({
      senderId,
      recipientId,
      message: "hello anonymously",
      idempotencyKey: key,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      dailyLimit: 20,
      interestSendCost: 10,
    });
  });

  it("maps self-interest and daily abuse limits", async () => {
    const repository = createRepository();
    vi.mocked(repository.create).mockRejectedValueOnce(
      new CannotInterestSelfError(),
    );
    await expect(
      createService(repository).create(
        senderId,
        { recipientId: senderId },
        key,
      ),
    ).rejects.toMatchObject({
      code: "CANNOT_INTEREST_SELF",
      statusCode: 422,
    });

    vi.mocked(repository.create).mockRejectedValueOnce(
      new InterestDailyLimitError(),
    );
    await expect(
      createService(repository).create(senderId, { recipientId }, key),
    ).rejects.toMatchObject({
      code: "INTEREST_DAILY_LIMIT",
      statusCode: 429,
    });
  });

  it("maps duplicate and non-pending state conflicts", async () => {
    const repository = createRepository();
    vi.mocked(repository.create).mockRejectedValue(
      new InterestConflictError("already_pending"),
    );
    await expect(
      createService(repository).create(senderId, { recipientId }, key),
    ).rejects.toMatchObject({ code: "INTEREST_ALREADY_PENDING" });

    vi.mocked(repository.accept).mockRejectedValue(
      new InterestConflictError("not_pending"),
    );
    await expect(
      createService(repository).accept(interestId, recipientId),
    ).rejects.toMatchObject({ code: "INTEREST_NOT_PENDING" });
  });

  it("returns privacy-safe incoming pages with signed cursors", async () => {
    const repository = createRepository();
    vi.mocked(repository.listIncoming).mockResolvedValue([
      interestFixture({ hideAge: true, hideCountry: true }),
      interestFixture(),
    ]);

    const page = await createService(repository).listIncoming(recipientId, {
      status: "PENDING",
      limit: 1,
    });

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(repository.listIncoming).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PENDING", limit: 1 }),
    );
    const sender = (page.items[0] as {
      sender: Record<string, unknown>;
    }).sender;
    expect(sender).not.toHaveProperty("age");
    expect(sender).not.toHaveProperty("countryCode");
    expect(sender).not.toHaveProperty("email");
  });

  it("presents accepted matches with conversation IDs", async () => {
    const repository = createRepository();
    vi.mocked(repository.accept).mockResolvedValue(matchFixture());

    const match = await createService(repository).accept(
      interestId,
      recipientId,
    );

    expect(match).toMatchObject({
      id: matchId,
      conversationId: "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e",
      peer: { id: senderId },
    });
  });

  it("hides unknown or unauthorized active matches", async () => {
    const repository = createRepository();
    vi.mocked(repository.unmatch).mockResolvedValue(false);

    await expect(
      createService(repository).unmatch(matchId, senderId),
    ).rejects.toMatchObject({ code: "MATCH_NOT_FOUND", statusCode: 404 });
  });
});

function createService(repository: InterestRepository): InterestService {
  return new InterestService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
}

function createRepository(): InterestRepository {
  return {
    create: vi.fn(),
    listIncoming: vi.fn(),
    listOutgoing: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    cancel: vi.fn(),
    listMatches: vi.fn(),
    unmatch: vi.fn(),
  };
}

function interestFixture(
  overrides: { hideAge?: boolean; hideCountry?: boolean } = {},
): InterestViewRecord {
  return {
    id: interestId,
    status: "PENDING",
    message: "hello anonymously",
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    respondedAt: null,
    sender: userFixture(senderId, "sender", overrides),
    recipient: userFixture(recipientId, "recipient"),
  };
}

function matchFixture(): MatchViewRecord {
  return {
    id: matchId,
    conversationId: "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e",
    matchedAt: new Date("2026-07-17T00:00:00.000Z"),
    peer: userFixture(senderId, "sender"),
  };
}

function userFixture(
  id: string,
  username: string,
  overrides: { hideAge?: boolean; hideCountry?: boolean } = {},
) {
  return {
    id,
    username,
    displayName: null,
    bio: null,
    dateOfBirth: new Date("2000-01-01T00:00:00.000Z"),
    gender: "OTHER" as const,
    countryCode: "IN",
    relationshipGoal: null,
    websiteUrl: null,
    instagramHandle: null,
    isVerifiedBadge: false,
    isPrivateAccount: false,
    hideAge: overrides.hideAge ?? false,
    hideCountry: overrides.hideCountry ?? false,
    hideOnline: false,
    lastSeenAt: null,
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    profilePhoto: null,
    coverPhoto: null,
    interests: [],
  };
}
