import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { ChatRepository } from "../src/modules/chat/application/ports/chat-repository.js";
import { ChatActionConflictError } from "../src/modules/chat/application/ports/chat-repository.js";
import type {
  ConversationViewRecord,
  MessageViewRecord,
} from "../src/modules/chat/application/chat-view.js";
import { ChatService } from "../src/modules/chat/application/services/chat-service.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  UPLOAD_ROOT: "../../uploads-test",
  JWT_ACCESS_SECRET: "chat-service-secret-at-least-32",
} as AppConfig;
const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const peerId = "fca0622f-cba7-4398-bfe7-11842c026990";
const conversationId = "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e";
const messageId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";
const key = "4c960e9a-592a-41e0-9942-2589f5dd0894";

describe("ChatService", () => {
  it("normalizes and sends an idempotent text message", async () => {
    const repository = createRepository();
    vi.mocked(repository.sendMessage).mockResolvedValue({
      message: messageFixture(),
      replayed: false,
    });

    const result = await createService(repository).sendMessage(
      conversationId,
      userId,
      { type: "TEXT", body: "  hello privately  " },
      key,
    );

    expect(result.replayed).toBe(false);
    expect(repository.sendMessage).toHaveBeenCalledWith({
      conversationId,
      senderId: userId,
      type: "TEXT",
      body: "hello privately",
      mediaId: null,
      replyToId: null,
      idempotencyKey: key,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("validates payloads before opening a transaction", async () => {
    const repository = createRepository();
    const service = createService(repository);

    await expect(
      service.sendMessage(
        conversationId,
        userId,
        { type: "TEXT", body: "  " },
        key,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.sendMessage(conversationId, userId, { type: "IMAGE" }, key),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(repository.sendMessage).not.toHaveBeenCalled();
  });

  it("returns privacy-safe conversation pages and signed cursors", async () => {
    const repository = createRepository();
    vi.mocked(repository.listConversations).mockResolvedValue([
      conversationFixture(true),
      conversationFixture(false),
    ]);

    const page = await createService(repository).listConversations(userId, {
      filter: "all",
      limit: 1,
    });

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));
    const peer = (page.items[0] as { peer: Record<string, unknown> }).peer;
    expect(peer).not.toHaveProperty("ageRange");
    expect(peer).not.toHaveProperty("country");
    expect(peer).not.toHaveProperty("email");
  });

  it("masks message content deleted for everyone", async () => {
    const repository = createRepository();
    vi.mocked(repository.listMessages).mockResolvedValue([
      messageFixture({ deleted: true }),
    ]);

    const page = await createService(repository).listMessages(
      conversationId,
      userId,
      { limit: 30 },
    );

    expect(page.items[0]).toMatchObject({
      body: null,
      media: null,
      deletedForEveryone: true,
    });
  });

  it("prevents deleting another sender's message for everyone", async () => {
    const repository = createRepository();
    vi.mocked(repository.deleteMessage).mockRejectedValue(
      new ChatActionConflictError("not_sender"),
    );

    await expect(
      createService(repository).deleteMessage(messageId, userId, "everyone"),
    ).rejects.toMatchObject({
      code: "CANNOT_DELETE_OTHERS_MESSAGE",
      statusCode: 403,
    });
  });

  it("hides unauthorized read receipts and unsafe media paths", async () => {
    const repository = createRepository();
    vi.mocked(repository.markRead).mockResolvedValue(null);
    await expect(
      createService(repository).markRead(
        conversationId,
        userId,
        messageId,
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    vi.mocked(repository.resolveChatMedia).mockResolvedValue({
      storageKey: "../secret.webp",
      mimeType: "image/webp",
      checksum: null,
    });
    await expect(
      createService(repository).resolveChatMedia(
        conversationId,
        messageId,
        userId,
      ),
    ).rejects.toMatchObject({ code: "MEDIA_NOT_FOUND" });
  });
});

function createService(repository: ChatRepository): ChatService {
  return new ChatService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
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

function messageFixture(
  overrides: { deleted?: boolean } = {},
): MessageViewRecord {
  return {
    id: messageId,
    conversationId,
    senderId: userId,
    replyToId: null,
    type: "TEXT",
    body: "hello privately",
    deliveryStatus: "SENT",
    editedAt: null,
    deletedForEveryoneAt: overrides.deleted
      ? new Date("2026-07-17T00:01:00.000Z")
      : null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    mediaAsset: null,
  };
}

function conversationFixture(hidePrivateFields: boolean): ConversationViewRecord {
  return {
    id: conversationId,
    matchId: "11111111-1111-4111-8111-111111111111",
    peer: {
      id: peerId,
      username: "peer",
      displayName: null,
      bio: null,
      ageRange: "AGE_25_28",
      gender: "OTHER",
      country: "India",
      relationshipGoal: null,
      websiteUrl: null,
      instagramHandle: null,
      isVerifiedBadge: false,
      isPrivateAccount: true,
      hideAge: hidePrivateFields,
      hideCountry: hidePrivateFields,
      followerCount: 0,
      followingCount: 0,
      postCount: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      profilePhoto: null,
      coverPhoto: null,
      interests: [],
    },
    unreadCount: 1,
    isMuted: false,
    isPinned: false,
    isArchived: false,
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    lastMessage: messageFixture(),
  };
}
