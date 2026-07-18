import {
  Router,
  type RequestHandler,
} from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { PostController } from "./post-controller.js";

export interface PostRouters {
  posts: Router;
  userPosts: Router;
  hashtags: Router;
}

export function createPostRouters(
  controller: PostController,
  authenticate: RequestHandler,
  optionalAuthenticate: RequestHandler,
  requireVerified: RequestHandler,
): PostRouters {
  const posts = Router();
  const userPosts = Router();
  const hashtags = Router();
  const writeLimit = createRateLimit(120, 10 * 60 * 1000);
  const createPostLimit = createRateLimit(30, 60 * 60 * 1000);
  const reportLimit = createRateLimit(10, 60 * 60 * 1000);
  const verifiedWrite = [authenticate, requireVerified, writeLimit];

  posts.post(
    "/",
    authenticate,
    requireVerified,
    createPostLimit,
    asyncHandler(controller.create),
  );
  // Static route stays above /:postId so "saved" is never read as an id.
  posts.get("/saved", authenticate, asyncHandler(controller.listSaved));
  posts.get("/:postId", optionalAuthenticate, asyncHandler(controller.get));
  posts.patch(
    "/:postId",
    ...verifiedWrite,
    asyncHandler(controller.update),
  );
  posts.delete(
    "/:postId",
    ...verifiedWrite,
    asyncHandler(controller.delete),
  );
  posts.put(
    "/:postId/like",
    ...verifiedWrite,
    asyncHandler(controller.like),
  );
  posts.delete(
    "/:postId/like",
    ...verifiedWrite,
    asyncHandler(controller.unlike),
  );
  posts.put(
    "/:postId/save",
    ...verifiedWrite,
    asyncHandler(controller.save),
  );
  posts.delete(
    "/:postId/save",
    ...verifiedWrite,
    asyncHandler(controller.unsave),
  );
  posts.post(
    "/:postId/share",
    ...verifiedWrite,
    asyncHandler(controller.share),
  );
  posts.post(
    "/:postId/report",
    authenticate,
    requireVerified,
    reportLimit,
    asyncHandler(controller.report),
  );

  userPosts.get(
    "/:username/posts",
    optionalAuthenticate,
    asyncHandler(controller.listByUsername),
  );

  hashtags.get(
    "/trending",
    optionalAuthenticate,
    asyncHandler(controller.listTrendingHashtags),
  );
  hashtags.get(
    "/search",
    optionalAuthenticate,
    asyncHandler(controller.searchHashtags),
  );
  hashtags.get(
    "/:tag/posts",
    optionalAuthenticate,
    asyncHandler(controller.listByHashtag),
  );

  return { posts, userPosts, hashtags };
}
