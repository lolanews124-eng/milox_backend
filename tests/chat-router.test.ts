import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { ChatRepository } from "../src/modules/chat/application/ports/chat-repository.js";
import type { MessageViewRecord } from "../src/modules/chat/application/chat-view.js";
import { ChatService } from "../src/modules/chat/application/services/chat-service.js";
import { ChatController } from "../src/modules/chat/presentation/chat-controller.js";
import { createChatRouters } from "../src/modules/chat/presentation/chat-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  UPLOAD_ROOT: "../../uploads-test",
  JWT_ACCESS_SECRET: "chat-router-secret-at-least-32",
} as AppConfig;
const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const conversationId = "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e";
const messageId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";
const key = "4c960e9a-592a-41e0-9942-2589f5dd0894";

describe("chat HTTP contract", () => {
  it("lists conversations with cursor metadata", async () => {
    const repository = createRepository();
    vi.mocked(repository.listConversations).mockResolvedValue([]);
    const response = await request(createTestApp(repository)).get(
      "/api/v1/conversations?filter=all&limit=10",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: { items: [] },
      meta: { pagination: { nextCursor: null, hasMore: false } },
    });
  });

  it("sends an idempotent message", async () => {
    const repository = createRepository();
    vi.mocked(repository.sendMessage).mockResolvedValue({
      message: messageFixture(),
      replayed: false,
    });
    const response = await request(createTestApp(repository))
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set("Idempotency-Key", key)
      .send({ type: "TEXT", body: "hello" });

    expect(response.status).toBe(201);
    expect(response.header["idempotency-replayed"]).toBe("false");
    expect(response.body).toMatchObject({
      success: true,
      data: { id: messageId, body: "hello" },
    });
  });

  it("rejects send without an idempotency key", async () => {
    const response = await request(createTestApp(createRepository()))
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .send({ type: "TEXT", body: "hello" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("marks a valid message read through the REST fallback", async () => {
    const repository = createRepository();
    vi.mocked(repository.markRead).mockResolvedValue({
      conversationId,
      lastReadMessageId: messageId,
      at: new Date(),
    });
    const response = await request(createTestApp(repository))
      .post(`/api/v1/conversations/${conversationId}/read`)
      .send({ lastReadMessageId: messageId });

    expect(response.status).toBe(204);
    expect(repository.markRead).toHaveBeenCalledWith(
      conversationId,
      userId,
      messageId,
    );
  });
});

function createTestApp(repository: ChatRepository) {
  const service = new ChatService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
  const controller = new ChatController(service);
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = { userId, role: "USER", emailVerified: true };
    next();
  };
  const pass: RequestHandler = (_req, _res, next) => {
    next();
  };
  const routers = createChatRouters(controller, authenticate, pass);
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use("/api/v1/conversations", routers.conversations);
  app.use("/api/v1/messages", routers.messages);
  app.use(errorHandler);
  return app;
}

function createRepository(): ChatRepository {
  return {
    listConversations: vi.fn(),
    findConversation: vi.fn(),
    updateSettings: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    markRead: vi.fn(),
    markDelivered: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
    activeConversationIds: vi.fn(),
    activeConversationMemberIds: vi.fn(),
    canAccessConversation: vi.fn(),
    updatePresence: vi.fn(),
    resolveChatMedia: vi.fn(),
    findMessageForRealtime: vi.fn(),
  };
}

function messageFixture(): MessageViewRecord {
  return {
    id: messageId,
    conversationId,
    senderId: userId,
    replyToId: null,
    type: "TEXT",
    body: "hello",
    deliveryStatus: "SENT",
    editedAt: null,
    deletedForEveryoneAt: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    mediaAsset: null,
  };
}
