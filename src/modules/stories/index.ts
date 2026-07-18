import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { StoryService } from "./application/services/story-service.js";
import { PrismaStoryRepository } from "./infrastructure/prisma-story-repository.js";
import { StoryController } from "./presentation/story-controller.js";
import { createStoryRouter } from "./presentation/story-router.js";

export interface StoryModule {
  router: Router;
  service: StoryService;
}

export function createStoryModule(
  config: AppConfig,
  database: PrismaClient,
  middleware: {
    authenticate: RequestHandler;
    requireVerified: RequestHandler;
  },
): StoryModule {
  const repository = new PrismaStoryRepository(database);
  const service = new StoryService(repository, config);
  const controller = new StoryController(service);
  const router = createStoryRouter(
    controller,
    middleware.authenticate,
    middleware.requireVerified,
  );
  return { router, service };
}
