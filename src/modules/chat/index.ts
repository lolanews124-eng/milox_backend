import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { FeedCursorCodec } from "../feed/application/services/feed-cursor.js";
import { ChatService } from "./application/services/chat-service.js";
import { PrismaChatRepository } from "./infrastructure/prisma-chat-repository.js";
import { ChatController } from "./presentation/chat-controller.js";
import { createChatRouters } from "./presentation/chat-router.js";

export interface ChatModule {
  router: Router;
  messagesRouter: Router;
  service: ChatService;
}

export function createChatService(
  config: AppConfig,
  database: PrismaClient,
): ChatService {
  const repository = new PrismaChatRepository(database);
  const cursors = new FeedCursorCodec(
    config.CURSOR_SIGNING_SECRET ?? config.JWT_ACCESS_SECRET,
  );
  return new ChatService(repository, cursors, config);
}

export function createChatModule(
  config: AppConfig,
  database: PrismaClient,
  middleware: {
    authenticate: RequestHandler;
    requireVerified: RequestHandler;
  },
): ChatModule {
  const service = createChatService(config, database);
  const controller = new ChatController(service);
  const routers = createChatRouters(
    controller,
    middleware.authenticate,
    middleware.requireVerified,
  );
  return {
    router: routers.conversations,
    messagesRouter: routers.messages,
    service,
  };
}
