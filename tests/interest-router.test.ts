import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { InterestRepository } from "../src/modules/interests/application/ports/interest-repository.js";
import type { InterestViewRecord } from "../src/modules/interests/application/interest-view.js";
import { InterestService } from "../src/modules/interests/application/services/interest-service.js";
import { InterestController } from "../src/modules/interests/presentation/interest-controller.js";
import { createInterestRouters } from "../src/modules/interests/presentation/interest-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "interest-router-secret-at-least-32",
  INTEREST_DAILY_LIMIT: 20,
} as AppConfig;
const senderId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const recipientId = "fca0622f-cba7-4398-bfe7-11842c026990";
const interestId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";
const matchId = "b9e27322-a92d-4b13-8ddc-3849a3b09a5a";
const key = "4c960e9a-592a-41e0-9942-2589f5dd0894";

describe("interest HTTP contract", () => {
  it("requires and reports idempotency metadata on send", async () => {
    const repository = createRepository();
    vi.mocked(repository.create).mockResolvedValue({
      interest: interestFixture(),
      replayed: false,
    });
    const response = await request(createTestApp(repository))
      .post("/api/v1/interests")
      .set("Idempotency-Key", key)
      .send({ recipientId, message: "hello" });

    expect(response.status).toBe(201);
    expect(response.header["idempotency-replayed"]).toBe("false");
    expect(response.body).toMatchObject({
      success: true,
      data: { id: interestId, status: "PENDING" },
    });
  });

  it("rejects send without an idempotency key", async () => {
    const response = await request(createTestApp(createRepository()))
      .post("/api/v1/interests")
      .send({ recipientId });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns filtered incoming interests in a cursor envelope", async () => {
    const repository = createRepository();
    vi.mocked(repository.listIncoming).mockResolvedValue([]);
    const response = await request(createTestApp(repository)).get(
      "/api/v1/interests/incoming?status=PENDING&limit=10",
    );

    expect(response.status).toBe(200);
    expect(repository.listIncoming).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PENDING", limit: 10 }),
    );
    expect(response.body.meta.pagination).toEqual({
      nextCursor: null,
      hasMore: false,
    });
  });

  it("unmatches through a member-authorized endpoint", async () => {
    const repository = createRepository();
    vi.mocked(repository.unmatch).mockResolvedValue(true);
    const response = await request(createTestApp(repository)).delete(
      `/api/v1/matches/${matchId}`,
    );

    expect(response.status).toBe(204);
    expect(repository.unmatch).toHaveBeenCalledWith(matchId, senderId);
  });
});

function createTestApp(repository: InterestRepository) {
  const service = new InterestService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
  const controller = new InterestController(service);
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = { userId: senderId, role: "USER", emailVerified: true };
    next();
  };
  const pass: RequestHandler = (_req, _res, next) => {
    next();
  };
  const routers = createInterestRouters(controller, authenticate, pass);
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use("/api/v1/interests", routers.interests);
  app.use("/api/v1/matches", routers.matches);
  app.use(errorHandler);
  return app;
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

function interestFixture(): InterestViewRecord {
  const user = (id: string, username: string) => ({
    id,
    username,
    displayName: null,
    bio: null,
    dateOfBirth: new Date("2000-01-01T00:00:00.000Z"),
    gender: "OTHER" as const,
    countryCode: null,
    relationshipGoal: null,
    websiteUrl: null,
    instagramHandle: null,
    isVerifiedBadge: false,
    isPrivateAccount: false,
    hideAge: true,
    hideCountry: true,
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    profilePhoto: null,
    coverPhoto: null,
    interests: [],
  });
  return {
    id: interestId,
    status: "PENDING",
    message: "hello",
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    respondedAt: null,
    sender: user(senderId, "sender"),
    recipient: user(recipientId, "recipient"),
  };
}
