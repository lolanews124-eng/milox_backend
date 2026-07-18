import { describe, expect, it, vi } from "vitest";

import type { ChatService } from "../src/modules/chat/application/services/chat-service.js";
import {
  registerChatGateway,
  type ChatIo,
} from "../src/modules/chat/realtime/chat-gateway.js";

const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const conversationId = "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e";
const messageId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";

describe("chat realtime gateway", () => {
  it("joins authorized rooms and relays validated typing", async () => {
    const harness = createHarness();
    registerChatGateway(harness.io, harness.chat);
    harness.connect();
    await flush();

    expect(harness.socket.join).toHaveBeenCalledWith(`user:${userId}`);
    expect(harness.socket.join).toHaveBeenCalledWith(
      `conversation:${conversationId}`,
    );

    harness.handlers["typing:start"]?.({ conversationId });
    await flush();

    expect(harness.chat.canAccessConversation).toHaveBeenCalledWith(
      conversationId,
      userId,
    );
    expect(harness.roomEmit).toHaveBeenCalledWith("typing:start", {
      conversationId,
      userId,
    });
  });

  it("acknowledges delivery only after repository authorization", async () => {
    const harness = createHarness();
    registerChatGateway(harness.io, harness.chat);
    harness.connect();
    await flush();
    const acknowledge = vi.fn();

    harness.handlers["message:markDelivered"]?.(
      { conversationId, messageId },
      acknowledge,
    );
    await flush();

    expect(acknowledge).toHaveBeenCalledWith({ ok: true });
    expect(harness.roomEmit).toHaveBeenCalledWith("message:delivered", {
      conversationId,
      messageId,
      at: "2026-07-17T00:00:00.000Z",
    });
  });
});

function createHarness() {
  type Handler = (...args: any[]) => void;
  interface TestSocket {
    id: string;
    data: {
      auth: { userId: string; role: string; emailVerified: boolean };
    };
    join: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    to: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }
  const handlers: Record<string, Handler> = {};
  let connection:
    | ((socket: TestSocket) => void)
    | undefined;
  const roomEmit = vi.fn();
  const rooms = new Map<string, Set<string>>();
  const socket: TestSocket = {
    id: "socket-1",
    data: {
      auth: { userId, role: "USER", emailVerified: true },
    },
    join: vi.fn(async (room: string) => {
      const members = rooms.get(room) ?? new Set<string>();
      members.add("socket-1");
      rooms.set(room, members);
    }),
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handler;
    }),
    to: vi.fn(() => ({ emit: roomEmit })),
    disconnect: vi.fn(),
  };
  const ioObject = {
    on: vi.fn(
      (
        event: string,
        handler: (connectedSocket: TestSocket) => void,
      ) => {
        if (event === "connection") connection = handler;
      },
    ),
    sockets: { adapter: { rooms } },
    to: vi.fn(() => ({ emit: vi.fn() })),
  };
  const chatObject = {
    activeConversationIds: vi.fn().mockResolvedValue([conversationId]),
    canAccessConversation: vi.fn().mockResolvedValue(true),
    updatePresence: vi.fn().mockResolvedValue({
      recipientIds: [],
      payload: null,
    }),
    markDelivered: vi.fn().mockResolvedValue({
      conversationId,
      messageId,
      at: new Date("2026-07-17T00:00:00.000Z"),
    }),
    markRead: vi.fn(),
  };
  return {
    io: ioObject as unknown as ChatIo,
    chat: chatObject as unknown as ChatService,
    socket,
    handlers,
    roomEmit,
    connect: () => connection?.(socket),
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
