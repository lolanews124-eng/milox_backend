import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { FeedCursorCodec } from "./application/services/feed-cursor.js";
import { FeedService } from "./application/services/feed-service.js";
import { PrismaFeedRepository } from "./infrastructure/prisma-feed-repository.js";
import { FeedController } from "./presentation/feed-controller.js";
import { createFeedRouter } from "./presentation/feed-router.js";

export interface FeedModule {
  router: Router;
  service: FeedService;
}

export function createFeedModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
  optionalAuthenticate: RequestHandler,
): FeedModule {
  const repository = new PrismaFeedRepository(database);
  const cursors = new FeedCursorCodec(
    config.CURSOR_SIGNING_SECRET ?? config.JWT_ACCESS_SECRET,
  );
  const service = new FeedService(repository, cursors, config);
  const controller = new FeedController(service);
  return {
    router: createFeedRouter(controller, authenticate, optionalAuthenticate),
    service,
  };
}
