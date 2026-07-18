import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { CommentController } from "./comment-controller.js";

export interface CommentRouters {
  postComments: Router;
  comments: Router;
}

export function createCommentRouters(
  controller: CommentController,
  authenticate: RequestHandler,
  optionalAuthenticate: RequestHandler,
  requireVerified: RequestHandler,
): CommentRouters {
  const postComments = Router();
  const comments = Router();
  const createLimit = createRateLimit(60, 10 * 60 * 1000);
  const actionLimit = createRateLimit(120, 10 * 60 * 1000);

  postComments.get(
    "/:postId/comments",
    optionalAuthenticate,
    asyncHandler(controller.listTopLevel),
  );
  postComments.post(
    "/:postId/comments",
    authenticate,
    requireVerified,
    createLimit,
    asyncHandler(controller.create),
  );

  comments.get(
    "/:commentId/replies",
    optionalAuthenticate,
    asyncHandler(controller.listReplies),
  );
  comments.delete(
    "/:commentId",
    authenticate,
    requireVerified,
    actionLimit,
    asyncHandler(controller.delete),
  );
  comments.put(
    "/:commentId/like",
    authenticate,
    requireVerified,
    actionLimit,
    asyncHandler(controller.like),
  );
  comments.delete(
    "/:commentId/like",
    authenticate,
    requireVerified,
    actionLimit,
    asyncHandler(controller.unlike),
  );

  return { postComments, comments };
}
