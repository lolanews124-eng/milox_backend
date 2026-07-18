import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { ModerationRepository } from "../src/modules/moderation/application/ports/moderation-repository.js";
import { ModerationService } from "../src/modules/moderation/application/services/moderation-service.js";
import { ModerationController } from "../src/modules/moderation/presentation/moderation-controller.js";
import { createModerationRouters } from "../src/modules/moderation/presentation/moderation-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "moderation-router-secret-32bytes!!",
} as AppConfig;
const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const targetId = "fca0622f-cba7-4398-bfe7-11842c026990";

describe("moderation HTTP contract", () => {
  it("blocks a user by username", async () => {
    const repository = createRepository();
    vi.mocked(repository.block).mockResolvedValue(true);
    const response = await request(createTestApp(repository)).put(
      "/api/v1/users/nightboy/block",
    );

    expect(response.status).toBe(204);
    expect(repository.block).toHaveBeenCalledWith("nightboy", userId);
  });

  it("lists blocked users with pagination metadata", async () => {
    const repository = createRepository();
    vi.mocked(repository.listBlocks).mockResolvedValue([]);
    const response = await request(createTestApp(repository)).get(
      "/api/v1/blocks?limit=10",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: { items: [] },
      meta: { pagination: { nextCursor: null, hasMore: false } },
    });
  });

  it("creates a user report", async () => {
    const repository = createRepository();
    vi.mocked(repository.createReport).mockResolvedValue({
      id: "98ea1ca9-5f22-4207-8659-3db6e5d54861",
      status: "OPEN",
      createdAt: new Date(),
    });
    const response = await request(createTestApp(repository))
      .post("/api/v1/reports")
      .send({
        targetType: "USER",
        reportedUserId: targetId,
        reasonCode: "HARASSMENT",
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ message: "Report submitted" });
  });

  it("rejects an unsupported conversation report shape", async () => {
    const response = await request(createTestApp(createRepository()))
      .post("/api/v1/reports")
      .send({
        targetType: "CONVERSATION",
        reasonCode: "SPAM",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

function createTestApp(repository: ModerationRepository) {
  const service = new ModerationService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
  const controller = new ModerationController(service);
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = { userId, role: "USER", emailVerified: true };
    next();
  };
  const routers = createModerationRouters(controller, authenticate);
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use("/api/v1/users", routers.userBlocks);
  app.use("/api/v1/blocks", routers.blocks);
  app.use("/api/v1/reports", routers.reports);
  app.use(errorHandler);
  return app;
}

function createRepository(): ModerationRepository {
  return {
    block: vi.fn(),
    unblock: vi.fn(),
    listBlocks: vi.fn(),
    createReport: vi.fn(),
  };
}
