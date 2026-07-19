import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { AdminService } from "./application/services/admin-service.js";
import { PrismaAdminRepository } from "./infrastructure/prisma-admin-repository.js";
import { AdminController } from "./presentation/admin-controller.js";
import { createAdminRouter } from "./presentation/admin-router.js";

export interface AdminModule {
  router: Router;
  service: AdminService;
}

export function createAdminModule(
  config: Pick<AppConfig, "UPLOAD_ROOT">,
  database: PrismaClient,
  authenticate: RequestHandler,
): AdminModule {
  const repository = new PrismaAdminRepository(database);
  const service = new AdminService(repository);
  const controller = new AdminController(service, config.UPLOAD_ROOT);
  return {
    router: createAdminRouter(controller, database, authenticate),
    service,
  };
}
