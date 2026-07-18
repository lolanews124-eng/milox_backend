import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { NotificationRepository } from "../src/modules/notifications/application/ports/notification-repository.js";
import { NotificationService } from "../src/modules/notifications/application/services/notification-service.js";
import { NotificationController } from "../src/modules/notifications/presentation/notification-controller.js";
import { createNotificationRouter } from "../src/modules/notifications/presentation/notification-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "notification-router-secret-32bytes",
} as AppConfig;
const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const notificationId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";

describe("notification HTTP contract", () => {
  it("lists unread notifications with cursor metadata", async () => {
    const repository = createRepository();
    vi.mocked(repository.list).mockResolvedValue([]);
    const response = await request(createTestApp(repository)).get(
      "/api/v1/notifications?unreadOnly=true&limit=10",
    );

    expect(response.status).toBe(200);
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: userId, unreadOnly: true }),
    );
    expect(response.body).toMatchObject({
      data: { items: [] },
      meta: { pagination: { nextCursor: null, hasMore: false } },
    });
  });

  it("returns unread badge count", async () => {
    const repository = createRepository();
    vi.mocked(repository.unreadCount).mockResolvedValue(3);
    const response = await request(createTestApp(repository)).get(
      "/api/v1/notifications/unread-count",
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ count: 3 });
  });

  it("marks selected recipient notifications read", async () => {
    const repository = createRepository();
    vi.mocked(repository.markRead).mockResolvedValue(1);
    const response = await request(createTestApp(repository))
      .post("/api/v1/notifications/read")
      .send({ ids: [notificationId] });

    expect(response.status).toBe(204);
    expect(repository.markRead).toHaveBeenCalledWith(userId, {
      all: false,
      ids: [notificationId],
    });
  });

  it("rejects an ambiguous mark-read request", async () => {
    const response = await request(createTestApp(createRepository()))
      .post("/api/v1/notifications/read")
      .send({ all: true, ids: [notificationId] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

function createTestApp(repository: NotificationRepository) {
  const service = new NotificationService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
  const controller = new NotificationController(service);
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = { userId, role: "USER", emailVerified: true };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use(
    "/api/v1/notifications",
    createNotificationRouter(controller, authenticate),
  );
  app.use(errorHandler);
  return app;
}

function createRepository(): NotificationRepository {
  return {
    list: vi.fn(),
    unreadCount: vi.fn(),
    markRead: vi.fn(),
    create: vi.fn(),
    resolveMessageTarget: vi.fn(),
  };
}
