import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { FeedCursorCodec } from "../feed/application/services/feed-cursor.js";
import { NotificationService } from "./application/services/notification-service.js";
import { PrismaNotificationRepository } from "./infrastructure/prisma-notification-repository.js";
import { NotificationController } from "./presentation/notification-controller.js";
import { createNotificationRouter } from "./presentation/notification-router.js";

export interface NotificationModule {
  router: Router;
  service: NotificationService;
}

export function createNotificationService(
  config: AppConfig,
  database: PrismaClient,
): NotificationService {
  const repository = new PrismaNotificationRepository(database);
  const cursors = new FeedCursorCodec(
    config.CURSOR_SIGNING_SECRET ?? config.JWT_ACCESS_SECRET,
  );
  return new NotificationService(repository, cursors, config);
}

export function createNotificationModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
): NotificationModule {
  const service = createNotificationService(config, database);
  const controller = new NotificationController(service);
  return {
    router: createNotificationRouter(controller, authenticate),
    service,
  };
}
