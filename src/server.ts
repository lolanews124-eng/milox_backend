import "dotenv/config";

import { createServer } from "node:http";

import { Server } from "socket.io";

import { createApp } from "./app.js";
import { getConfig, createCorsOriginChecker } from "./config/env.js";
import { prisma } from "./infrastructure/prisma/client.js";
import { ensureDefaultInterestTags } from "./infrastructure/interest-tags.js";
import { ensureMiloxOfficialUser } from "./infrastructure/milox-official-user.js";
import { notifyIndexNow } from "./infrastructure/indexnow.js";
import { ensureLaunchBlogPost } from "./infrastructure/launch-blog-post.js";
import { ChatOutboxWorker } from "./jobs/chat/chat-outbox-worker.js";
import { EmailWorker } from "./jobs/email/email-worker.js";
import { FeedScoreWorker } from "./jobs/feed/feed-score-worker.js";
import { NotificationOutboxWorker } from "./jobs/notifications/notification-outbox-worker.js";
import { CryptoService } from "./modules/auth/application/services/crypto-service.js";
import { createChatService } from "./modules/chat/index.js";
import { createOfficialChatModule } from "./modules/official-chat/index.js";
import {
  registerChatGateway,
  type ChatClientToServerEvents,
  type ChatServerToClientEvents,
  type ChatSocketData,
} from "./modules/chat/realtime/chat-gateway.js";
import { createNotificationService } from "./modules/notifications/index.js";
import { PrismaPushDeviceRepository } from "./modules/push/infrastructure/prisma-push-device-repository.js";
import { createPushSender } from "./modules/push/application/services/fcm-push-sender.js";

const config = getConfig();
const crypto = new CryptoService(config);
const emailWorker = new EmailWorker(prisma, config);
const feedScoreWorker = new FeedScoreWorker(prisma, config);
const port = config.PORT;
const chatOutboxHooks = {
  wake: () => {},
};

let io: Server<
  ChatClientToServerEvents,
  ChatServerToClientEvents,
  Record<never, never>,
  ChatSocketData
>;
let chatOutboxWorker: ChatOutboxWorker;
let notificationOutboxWorker: NotificationOutboxWorker;
let httpServer: ReturnType<typeof createServer>;

async function bootstrap(): Promise<void> {
  const officialChat = await createOfficialChatModule(prisma, {
    wakeOutbox: () => chatOutboxHooks.wake(),
  });
  const app = createApp({
    chatOutboxWake: () => chatOutboxHooks.wake(),
    signupOfficialChat: officialChat.signupWriter,
    officialChat: officialChat.service,
  });
  httpServer = createServer(app);

  io = new Server(httpServer, {
    cors: {
      origin: createCorsOriginChecker(config),
      credentials: true,
    },
  });
  const chatService = createChatService(config, prisma);
  chatOutboxWorker = new ChatOutboxWorker(prisma, chatService, io, config);
  chatOutboxHooks.wake = () => chatOutboxWorker.wake();
  const notificationService = createNotificationService(config, prisma);
  const pushSender = createPushSender(
    new PrismaPushDeviceRepository(prisma),
    config,
  );
  notificationOutboxWorker = new NotificationOutboxWorker(
    prisma,
    notificationService,
    io,
    config,
    pushSender,
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

  try {
    await ensureDefaultInterestTags(prisma);
  } catch (error: unknown) {
    console.error("Could not ensure default interest tags", error);
  }

  try {
    await ensureMiloxOfficialUser(prisma);
  } catch (error: unknown) {
    console.error("Could not ensure Milox Official user", error);
  }

  try {
    const blog = await ensureLaunchBlogPost(prisma);
    console.info(
      `Launch blog post ensured (${blog.slug})${blog.created ? " — created" : " — updated"}`,
    );
    void notifyIndexNow(["/blog", `/blog/${blog.slug}`, "/sitemap.xml"]);
  } catch (error: unknown) {
    console.error("Could not ensure launch blog post", error);
  }

  httpServer.listen(port, () => {
    console.info(`Milox API listening on port ${port}`);
    void emailWorker.start();
    feedScoreWorker.start();
    void chatOutboxWorker.start();
    void notificationOutboxWorker.start();
  });
}

void bootstrap().catch((error: unknown) => {
  console.error("Failed to start Milox API", error);
  process.exit(1);
});

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
