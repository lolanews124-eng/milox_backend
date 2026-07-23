import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";

import { BlogService } from "./application/blog-service.js";
import { PrismaBlogRepository } from "./infrastructure/prisma-blog-repository.js";
import { BlogController } from "./presentation/blog-controller.js";
import { createBlogRouter } from "./presentation/blog-router.js";

export interface BlogModule {
  router: Router;
  service: BlogService;
}

export function createBlogModule(database: PrismaClient): BlogModule {
  const repository = new PrismaBlogRepository(database);
  const service = new BlogService(repository);
  const controller = new BlogController(service);
  return { router: createBlogRouter(controller), service };
}
