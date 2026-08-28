import type { Server, Socket } from "socket.io";
import { z } from "zod";

import type { AccessTokenClaims } from "../../auth/application/services/crypto-service.js";
import type { ChatService } from "../application/services/chat-service.js";
import type { CallService } from "../../calls/application/call-service.js";
import {
  listOnlineUserIds,
  markUserOffline,
  markUserOnline,
} from "./presence-registry.js";

export interface ChatClientToServerEvents {
  "call:accept": (
    payload: { callId: string },
    acknowledge?: (result: CallRealtimeAck) => void,
  ) => void;
  "call:reject": (
    payload: { callId: string },
    acknowledge?: (result: CallRealtimeAck) => void,
  ) => void;
  "call:end": (
    payload: { callId: string },
    acknowledge?: (result: CallRealtimeAck) => void,
  ) => void;
  "call:offer": (payload: CallSignalPayload) => void;
  "call:answer": (payload: CallSignalPayload) => void;
  "call:ice": (payload: CallSignalPayload) => void;
  "call:renegotiate": (payload: CallSignalPayload) => void;
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
  "call:invite": (payload: object) => void;
  "call:accepted": (payload: object) => void;
  "call:rejected": (payload: object) => void;
  "call:ended": (payload: object) => void;
  "call:billing": (payload: object) => void;
  "call:offer": (payload: object) => void;
  "call:answer": (payload: object) => void;
  "call:ice": (payload: object) => void;
  "call:renegotiate": (payload: object) => void;
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
  "match:ended": (payload: { matchId: string; conversationId: string }) => void;
  "conversation:left": (payload: {
    conversationId: string;
    actorId: string;
  }) => void;
  "typing:start": (payload: { conversationId: string; userId: string }) => void;
  "typing:stop": (payload: { conversationId: string; userId: string }) => void;
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
  { ok: true } | { ok: false; code: "FORBIDDEN" | "VALIDATION_ERROR" };

type CallRealtimeAck =
  { ok: true; call?: object } | { ok: false; code: string; message: string };

type CallSignalPayload = {
  callId: string;
  sdp?: unknown;
  candidate?: unknown;
};

const conversationPayload = z.object({ conversationId: z.uuid() });
const deliveredPayload = conversationPayload.extend({ messageId: z.uuid() });
const seenPayload = conversationPayload.extend({
  lastReadMessageId: z.uuid(),
});
const callIdPayload = z.object({ callId: z.uuid() });
const callSignalPayload = callIdPayload.extend({
  sdp: z.unknown().optional(),
  candidate: z.unknown().optional(),
});

export function registerChatGateway(
  io: ChatIo,
  chat: ChatService,
  calls?: CallService,
): void {
  io.on("connection", (socket) => {
    void connectSocket(io, socket, chat, calls).catch(() =>
      socket.disconnect(true),
    );
  });
}

async function connectSocket(
  io: ChatIo,
  socket: ChatSocket,
  chat: ChatService,
  calls?: CallService,
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

  for (const onlineUserId of listOnlineUserIds()) {
    if (onlineUserId === userId) continue;
    socket.emit("presence:update", { userId: onlineUserId, online: true });
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
  if (calls) {
    socket.on("call:accept", (payload, acknowledge) => {
      void handleCallAction(calls, userId, "accept", payload, acknowledge);
    });
    socket.on("call:reject", (payload, acknowledge) => {
      void handleCallAction(calls, userId, "reject", payload, acknowledge);
    });
    socket.on("call:end", (payload, acknowledge) => {
      void handleCallAction(calls, userId, "end", payload, acknowledge);
    });
    for (const type of ["offer", "answer", "ice", "renegotiate"] as const) {
      socket.on(`call:${type}`, (payload) => {
        const parsed = callSignalPayload.safeParse(payload);
        if (!parsed.success) return;
        void calls
          .relaySignal(userId, { ...parsed.data, type })
          .catch(() => undefined);
      });
    }
  }
  socket.on("disconnect", () => {
    if ((io.sockets.adapter.rooms.get(userRoom)?.size ?? 0) === 0) {
      void emitPresence(io, chat, userId, false).catch(() => undefined);
    }
  });
}

async function handleCallAction(
  calls: CallService,
  userId: string,
  action: "accept" | "reject" | "end",
  payload: unknown,
  acknowledge?: (result: CallRealtimeAck) => void,
): Promise<void> {
  const parsed = callIdPayload.safeParse(payload);
  if (!parsed.success) {
    acknowledge?.({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Invalid call id",
    });
    return;
  }
  try {
    if (action === "reject") {
      await calls.rejectCall(parsed.data.callId, userId);
      acknowledge?.({ ok: true });
      return;
    }
    const call =
      action === "accept"
        ? await calls.acceptCall(parsed.data.callId, userId)
        : await calls.endCall(parsed.data.callId, userId);
    acknowledge?.({ ok: true, call });
  } catch (error) {
    const detail = error as { code?: string; message?: string };
    acknowledge?.({
      ok: false,
      code: detail.code ?? "CALL_ERROR",
      message: detail.message ?? "Call action failed",
    });
  }
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
  socket.to(`conversation:${parsed.data.conversationId}`).emit(event, {
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
  socket
    .to(`conversation:${receipt.conversationId}`)
    .emit("message:delivered", {
      conversationId: receipt.conversationId,
      messageId: receipt.messageId,
      at: receipt.at.toISOString(),
    });
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
  if (online && presence.payload) {
    markUserOnline(userId);
  } else {
    markUserOffline(userId);
  }
  if (!presence.payload) return;
  io.emit("presence:update", presence.payload);
}
