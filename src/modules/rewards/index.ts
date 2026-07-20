import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { RewardsService } from "./application/services/rewards-service.js";
import { PrismaRewardsRepository } from "./infrastructure/prisma-rewards-repository.js";
import type { RewardsRepository } from "./application/ports/rewards-repository.js";
import { RewardsController } from "./presentation/rewards-controller.js";
import { createRewardsRouter } from "./presentation/rewards-router.js";

export interface RewardsModule {
  router: Router;
  service: RewardsService;
  repository: RewardsRepository;
}

export function createRewardsModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
  repository: RewardsRepository = new PrismaRewardsRepository(database, config),
): RewardsModule {
  const service = new RewardsService(repository, config);
  const controller = new RewardsController(service);

  return {
    router: createRewardsRouter(controller, authenticate),
    service,
    repository,
  };
}
