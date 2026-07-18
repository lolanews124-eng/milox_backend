import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { FeedCursorCodec } from "../feed/application/services/feed-cursor.js";
import { ModerationService } from "./application/services/moderation-service.js";
import { PrismaModerationRepository } from "./infrastructure/prisma-moderation-repository.js";
import { ModerationController } from "./presentation/moderation-controller.js";
import { createModerationRouters } from "./presentation/moderation-router.js";

export interface ModerationModule {
  userBlocksRouter: Router;
  blocksRouter: Router;
  reportsRouter: Router;
  service: ModerationService;
}

export function createModerationModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
): ModerationModule {
  const repository = new PrismaModerationRepository(database);
  const cursors = new FeedCursorCodec(
    config.CURSOR_SIGNING_SECRET ?? config.JWT_ACCESS_SECRET,
  );
  const service = new ModerationService(repository, cursors, config);
  const controller = new ModerationController(service);
  const routers = createModerationRouters(controller, authenticate);
  return {
    userBlocksRouter: routers.userBlocks,
    blocksRouter: routers.blocks,
    reportsRouter: routers.reports,
    service,
  };
}
