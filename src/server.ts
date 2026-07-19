import "dotenv/config";

import { createServer } from "node:http";

import { Server } from "socket.io";

import { createApp } from "./app.js";
import { getConfig, getAllowedOrigins } from "./config/env.js";
import { prisma } from "./infrastructure/prisma/client.js";
import { ensureDefaultInterestTags } from "./infrastructure/interest-tags.js";
import { ChatOutboxWorker } from "./jobs/chat/chat-outbox-worker.js";
import { EmailWorker } from "./jobs/email/email-worker.js";
import { FeedScoreWorker } from "./jobs/feed/feed-score-worker.js";
import { NotificationOutboxWorker } from "./jobs/notifications/notification-outbox-worker.js";
import { CryptoService } from "./modules/auth/application/services/crypto-service.js";
import { createChatService } from "./modules/chat/index.js";
import {
  registerChatGateway,
  type ChatClientToServerEvents,
  type ChatServerToClientEvents,
  type ChatSocketData,
} from "./modules/chat/realtime/chat-gateway.js";
import { createNotificationService } from "./modules/notifications/index.js";

const config = getConfig();
const crypto = new CryptoService(config);
const emailWorker = new EmailWorker(prisma, config);
const feedScoreWorker = new FeedScoreWorker(prisma, config);
const port = config.PORT;
const app = createApp();
const httpServer = createServer(app);

const io = new Server<
  ChatClientToServerEvents,
  ChatServerToClientEvents,
  Record<never, never>,
  ChatSocketData
>(httpServer, {
  cors: {
    origin: getAllowedOrigins(config),
    credentials: true,
  },
});
const chatService = createChatService(config, prisma);
const chatOutboxWorker = new ChatOutboxWorker(
  prisma,
  chatService,
  io,
  config,
);
const notificationService = createNotificationService(config, prisma);
const notificationOutboxWorker = new NotificationOutboxWorker(
  prisma,
  notificationService,
  io,
  config,
);

io.use((socket, next) => {
  const token: unknown = socket.handshake.auth.token;
  if (typeof token !== "string") {
    next(unauthenticatedSocketError());
    return;
  }
  void crypto
    .verifyAccessToken(token)
    .then((claims) => {
      socket.data.auth = claims;
      next();
    })
    .catch(() => {
      next(unauthenticatedSocketError());
    });
});
registerChatGateway(io, chatService);

void (async () => {
  try {
    await ensureDefaultInterestTags(prisma);
  } catch (error: unknown) {
    console.error("Could not ensure default interest tags", error);
  }

  httpServer.listen(port, () => {
    console.info(`Milox API listening on port ${port}`);
    void emailWorker.start();
    feedScoreWorker.start();
    void chatOutboxWorker.start();
    void notificationOutboxWorker.start();
  });
})();

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}; shutting down`);
  emailWorker.stop();
  feedScoreWorker.stop();
  chatOutboxWorker.stop();
  notificationOutboxWorker.stop();
  await io.close();
  await prisma.$disconnect();
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

function unauthenticatedSocketError(): Error {
  const error = new Error("Authentication required") as Error & {
    data?: { code: string };
  };
  error.data = { code: "UNAUTHENTICATED" };
  return error;
}
