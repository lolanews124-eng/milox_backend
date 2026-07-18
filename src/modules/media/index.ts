import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { MediaService } from "./application/services/media-service.js";
import { PrismaMediaRepository } from "./infrastructure/prisma-media-repository.js";
import { MediaController } from "./presentation/media-controller.js";
import { createMediaRouter } from "./presentation/media-router.js";

export interface MediaModule {
  router: Router;
  service: MediaService;
}

export function createMediaModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
  requireVerified: RequestHandler,
): MediaModule {
  const repository = new PrismaMediaRepository(database);
  const service = new MediaService(repository, config);
  const controller = new MediaController(service);
  return {
    router: createMediaRouter(controller, authenticate, requireVerified),
    service,
  };
}
