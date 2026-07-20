import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import type { RewardsRepository } from "../rewards/application/ports/rewards-repository.js";
import { FeedCursorCodec } from "../feed/application/services/feed-cursor.js";
import { PostService } from "./application/services/post-service.js";
import { PrismaPostRepository } from "./infrastructure/prisma-post-repository.js";
import { PostController } from "./presentation/post-controller.js";
import { createPostRouters } from "./presentation/post-router.js";

export interface PostModule {
  router: Router;
  userPostsRouter: Router;
  hashtags: Router;
  service: PostService;
}

export function createPostModule(
  config: AppConfig,
  database: PrismaClient,
  middleware: {
    authenticate: RequestHandler;
    optionalAuthenticate: RequestHandler;
    requireVerified: RequestHandler;
  },
  rewards?: RewardsRepository,
): PostModule {
  const repository = new PrismaPostRepository(database, rewards);
  const cursors = new FeedCursorCodec(
    config.CURSOR_SIGNING_SECRET ?? config.JWT_ACCESS_SECRET,
  );
  const service = new PostService(repository, cursors, config);
  const controller = new PostController(service);
  const routers = createPostRouters(
    controller,
    middleware.authenticate,
    middleware.optionalAuthenticate,
    middleware.requireVerified,
  );
  return {
    router: routers.posts,
    userPostsRouter: routers.userPosts,
    hashtags: routers.hashtags,
    service,
  };
}
