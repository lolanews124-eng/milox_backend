import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import { AdminService } from "./application/services/admin-service.js";
import { PrismaAdminRepository } from "./infrastructure/prisma-admin-repository.js";
import { AdminController } from "./presentation/admin-controller.js";
import { createAdminRouter } from "./presentation/admin-router.js";

export interface AdminModule {
  router: Router;
  service: AdminService;
}

export function createAdminModule(
  database: PrismaClient,
  authenticate: RequestHandler,
): AdminModule {
  const repository = new PrismaAdminRepository(database);
  const service = new AdminService(repository);
  const controller = new AdminController(service);
  return {
    router: createAdminRouter(controller, database, authenticate),
    service,
  };
}
