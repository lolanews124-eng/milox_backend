import type { Server, Socket } from "socket.io";
import { z } from "zod";

import type { AccessTokenClaims } from "../../auth/application/services/crypto-service.js";
import type { ChatService } from "../application/services/chat-service.js";

export interface ChatClientToServerEvents {
  "message:markDelivered": (
    payload: { conversationId: string; messageId: string },
    acknowledge?: (result: RealtimeAck) => void,
  ) => void;
  "message:markSeen": (
    payload: { conversationId: string; lastReadMessageId: string },
    acknowledge?: (result: RealtimeAck) => void,
  ) => void;
  "typing:start": (payload: { conversationId: string }) => void;
  "typing:stop": (payload: { conversationId: string }) => void;
}

export interface ChatServerToClientEvents {
  "message:new": (message: object) => void;
  "message:delivered": (payload: {
    conversationId: string;
    messageId: string;
    at: string;
  }) => void;
  "message:seen": (payload: {
    conversationId: string;
    lastReadMessageId: string;
    at: string;
  }) => void;
  "message:deleted": (payload: {
    conversationId: string;
    messageId: string;
    scope: "me" | "everyone";
  }) => void;
  "message:edited": (message: object) => void;
  "match:ended": (payload: {
    matchId: string;
    conversationId: string;
  }) => void;
  "typing:start": (payload: {
    conversationId: string;
    userId: string;
  }) => void;
  "typing:stop": (payload: {
    conversationId: string;
    userId: string;
  }) => void;
  "presence:update": (payload: {
    userId: string;
    online: boolean;
    lastSeenAt?: string;
  }) => void;
  "notification:new": (notification: object) => void;
}

export interface ChatSocketData {
  auth?: AccessTokenClaims;
}

export type ChatIo = Server<
  ChatClientToServerEvents,
  ChatServerToClientEvents,
  Record<never, never>,
  ChatSocketData
>;

type ChatSocket = Socket<
  ChatClientToServerEvents,
  ChatServerToClientEvents,
  Record<never, never>,
  ChatSocketData
>;

type RealtimeAck =
  | { ok: true }
  | { ok: false; code: "FORBIDDEN" | "VALIDATION_ERROR" };

const conversationPayload = z.object({ conversationId: z.uuid() });
const deliveredPayload = conversationPayload.extend({ messageId: z.uuid() });
const seenPayload = conversationPayload.extend({
  lastReadMessageId: z.uuid(),
});

export function registerChatGateway(io: ChatIo, chat: ChatService): void {
  io.on("connection", (socket) => {
    void connectSocket(io, socket, chat).catch(() => socket.disconnect(true));
  });
}

async function connectSocket(
  io: ChatIo,
  socket: ChatSocket,
  chat: ChatService,
): Promise<void> {
  const userId = socket.data.auth?.userId;
  if (!userId) {
    socket.disconnect(true);
    return;
  }
  const userRoom = `user:${userId}`;
  await socket.join(userRoom);
  const conversationIds = await chat.activeConversationIds(userId);
  for (const id of conversationIds) {
    await socket.join(`conversation:${id}`);
  }
  if ((io.sockets.adapter.rooms.get(userRoom)?.size ?? 0) === 1) {
    await emitPresence(io, chat, userId, true);
  }

  socket.on("typing:start", (payload) => {
    void relayTyping(socket, chat, userId, "typing:start", payload).catch(
      () => undefined,
    );
  });
  socket.on("typing:stop", (payload) => {
    void relayTyping(socket, chat, userId, "typing:stop", payload).catch(
      () => undefined,
    );
  });
  socket.on("message:markDelivered", (payload, acknowledge) => {
    void markDelivered(socket, chat, userId, payload, acknowledge).catch(() =>
      acknowledge?.({ ok: false, code: "FORBIDDEN" }),
    );
  });
  socket.on("message:markSeen", (payload, acknowledge) => {
    void markSeen(socket, chat, userId, payload, acknowledge).catch(() =>
      acknowledge?.({ ok: false, code: "FORBIDDEN" }),
    );
  });
  socket.on("disconnect", () => {
    if ((io.sockets.adapter.rooms.get(userRoom)?.size ?? 0) === 0) {
      void emitPresence(io, chat, userId, false).catch(() => undefined);
    }
  });
}

async function relayTyping(
  socket: ChatSocket,
  chat: ChatService,
  userId: string,
  event: "typing:start" | "typing:stop",
  payload: unknown,
): Promise<void> {
  const parsed = conversationPayload.safeParse(payload);
  if (
    !parsed.success ||
    !(await chat.canAccessConversation(parsed.data.conversationId, userId))
  ) {
    return;
  }
  socket
    .to(`conversation:${parsed.data.conversationId}`)
    .emit(event, {
      conversationId: parsed.data.conversationId,
      userId,
    });
}

async function markDelivered(
  socket: ChatSocket,
  chat: ChatService,
  userId: string,
  payload: unknown,
  acknowledge?: (result: RealtimeAck) => void,
): Promise<void> {
  const parsed = deliveredPayload.safeParse(payload);
  if (!parsed.success) {
    acknowledge?.({ ok: false, code: "VALIDATION_ERROR" });
    return;
  }
  const receipt = await chat.markDelivered(
    parsed.data.conversationId,
    userId,
    parsed.data.messageId,
  );
  if (!receipt) {
    acknowledge?.({ ok: false, code: "FORBIDDEN" });
    return;
  }
  socket.to(`conversation:${receipt.conversationId}`).emit(
    "message:delivered",
    {
      conversationId: receipt.conversationId,
      messageId: receipt.messageId,
      at: receipt.at.toISOString(),
    },
  );
  acknowledge?.({ ok: true });
}

async function markSeen(
  socket: ChatSocket,
  chat: ChatService,
  userId: string,
  payload: unknown,
  acknowledge?: (result: RealtimeAck) => void,
): Promise<void> {
  const parsed = seenPayload.safeParse(payload);
  if (!parsed.success) {
    acknowledge?.({ ok: false, code: "VALIDATION_ERROR" });
    return;
  }
  try {
    const receipt = await chat.markRead(
      parsed.data.conversationId,
      userId,
      parsed.data.lastReadMessageId,
    );
    socket.to(`conversation:${receipt.conversationId}`).emit("message:seen", {
      conversationId: receipt.conversationId,
      lastReadMessageId: receipt.lastReadMessageId,
      at: receipt.at.toISOString(),
    });
    acknowledge?.({ ok: true });
  } catch {
    acknowledge?.({ ok: false, code: "FORBIDDEN" });
  }
}

async function emitPresence(
  io: ChatIo,
  chat: ChatService,
  userId: string,
  online: boolean,
): Promise<void> {
  const presence = await chat.updatePresence(userId, online);
  if (!presence.payload) return;
  for (const recipientId of presence.recipientIds) {
    io.to(`user:${recipientId}`).emit("presence:update", presence.payload);
  }
}
