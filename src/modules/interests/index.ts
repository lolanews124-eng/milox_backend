import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { FeedCursorCodec } from "../feed/application/services/feed-cursor.js";
import { InterestService } from "./application/services/interest-service.js";
import { PrismaInterestRepository } from "./infrastructure/prisma-interest-repository.js";
import { InterestController } from "./presentation/interest-controller.js";
import { createInterestRouters } from "./presentation/interest-router.js";
import type { RewardsRepository } from "../rewards/application/ports/rewards-repository.js";

export interface InterestModule {
  router: Router;
  matchesRouter: Router;
  service: InterestService;
}

export function createInterestModule(
  config: AppConfig,
  database: PrismaClient,
  middleware: {
    authenticate: RequestHandler;
    requireVerified: RequestHandler;
  },
  rewards?: RewardsRepository,
): InterestModule {
  const repository = new PrismaInterestRepository(database, rewards);
  const cursors = new FeedCursorCodec(
    config.CURSOR_SIGNING_SECRET ?? config.JWT_ACCESS_SECRET,
  );
  const service = new InterestService(repository, cursors, config);
  const controller = new InterestController(service);
  const routers = createInterestRouters(
    controller,
    middleware.authenticate,
    middleware.requireVerified,
  );
  return {
    router: routers.interests,
    matchesRouter: routers.matches,
    service,
  };
}
