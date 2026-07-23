import { Router } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import type { BlogController } from "./blog-controller.js";

export function createBlogRouter(controller: BlogController): Router {
  const router = Router();
  router.get("/posts", asyncHandler(controller.listPosts));
  router.get("/posts/:slug", asyncHandler(controller.getPost));
  return router;
}
