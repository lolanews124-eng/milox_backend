import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { FeedCursorCodec } from "../feed/application/services/feed-cursor.js";
import { CommentService } from "./application/services/comment-service.js";
import { PrismaCommentRepository } from "./infrastructure/prisma-comment-repository.js";
import { CommentController } from "./presentation/comment-controller.js";
import { createCommentRouters } from "./presentation/comment-router.js";

export interface CommentModule {
  router: Router;
  postCommentsRouter: Router;
  service: CommentService;
}

export function createCommentModule(
  config: AppConfig,
  database: PrismaClient,
  middleware: {
    authenticate: RequestHandler;
    optionalAuthenticate: RequestHandler;
    requireVerified: RequestHandler;
  },
): CommentModule {
  const repository = new PrismaCommentRepository(database);
  const cursors = new FeedCursorCodec(
    config.CURSOR_SIGNING_SECRET ?? config.JWT_ACCESS_SECRET,
  );
  const service = new CommentService(repository, cursors, config);
  const controller = new CommentController(service);
  const routers = createCommentRouters(
    controller,
    middleware.authenticate,
    middleware.optionalAuthenticate,
    middleware.requireVerified,
  );
  return {
    router: routers.comments,
    postCommentsRouter: routers.postComments,
    service,
  };
}
