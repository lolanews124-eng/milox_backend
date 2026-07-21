import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { PrismaPushDeviceRepository } from "./infrastructure/prisma-push-device-repository.js";
import { PushDeviceService } from "./application/services/push-device-service.js";
import {
  createPushSender,
  type PushSender,
} from "./application/services/fcm-push-sender.js";
import { PushDeviceController } from "./presentation/push-device-controller.js";
import { createPushDeviceRouter } from "./presentation/push-device-router.js";

export interface PushModule {
  router: Router;
  sender: PushSender;
}

export function createPushModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
): PushModule {
  const repository = new PrismaPushDeviceRepository(database);
  const service = new PushDeviceService(repository);
  const controller = new PushDeviceController(service);
  return {
    router: createPushDeviceRouter(controller, authenticate),
    sender: createPushSender(repository, config),
  };
}

export { buildPushNotificationMessage } from "./application/push-notification-builder.js";
export type { PushSender } from "./application/services/fcm-push-sender.js";
