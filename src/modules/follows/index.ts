import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { FeedCursorCodec } from "../feed/application/services/feed-cursor.js";
import { FollowService } from "./application/services/follow-service.js";
import { PrismaFollowRepository } from "./infrastructure/prisma-follow-repository.js";
import { FollowController } from "./presentation/follow-controller.js";
import { createFollowRouters } from "./presentation/follow-router.js";

export interface FollowModule {
  router: Router;
  userRouter: Router;
  service: FollowService;
}

export function createFollowModule(
  config: AppConfig,
  database: PrismaClient,
  middleware: {
    authenticate: RequestHandler;
    optionalAuthenticate: RequestHandler;
    requireVerified: RequestHandler;
  },
): FollowModule {
  const repository = new PrismaFollowRepository(database);
  const cursors = new FeedCursorCodec(
    config.CURSOR_SIGNING_SECRET ?? config.JWT_ACCESS_SECRET,
  );
  const service = new FollowService(repository, cursors, config);
  const controller = new FollowController(service);
  const routers = createFollowRouters(
    controller,
    middleware.authenticate,
    middleware.optionalAuthenticate,
    middleware.requireVerified,
  );
  return {
    router: routers.requests,
    userRouter: routers.users,
    service,
  };
}
