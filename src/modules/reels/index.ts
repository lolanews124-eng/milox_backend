import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { FeedCursorCodec } from "../feed/application/services/feed-cursor.js";
import type { MediaService } from "../media/application/services/media-service.js";
import { ReelService } from "./application/services/reel-service.js";
import { PrismaReelRepository } from "./infrastructure/prisma-reel-repository.js";
import { ReelController } from "./presentation/reel-controller.js";
import {
  createReelRouter,
  createUserReelsRouter,
} from "./presentation/reel-router.js";

export interface ReelModule {
  router: Router;
  userRouter: Router;
  service: ReelService;
}

export function createReelModule(
  config: AppConfig,
  database: PrismaClient,
  middleware: {
    authenticate: RequestHandler;
    requireVerified: RequestHandler;
  },
  media: MediaService,
): ReelModule {
  const repository = new PrismaReelRepository(database);
  const cursors = new FeedCursorCodec(
    config.CURSOR_SIGNING_SECRET ?? config.JWT_ACCESS_SECRET,
  );
  const service = new ReelService(repository, media, cursors, config);
  const controller = new ReelController(service);
  return {
    router: createReelRouter(
      controller,
      config,
      middleware.authenticate,
      middleware.requireVerified,
    ),
    userRouter: createUserReelsRouter(controller, middleware.authenticate),
    service,
  };
}
