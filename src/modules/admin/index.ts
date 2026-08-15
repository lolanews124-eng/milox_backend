import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { MediaService } from "../media/application/services/media-service.js";
import { PrismaMediaRepository } from "../media/infrastructure/prisma-media-repository.js";
import { AdminService } from "./application/services/admin-service.js";
import { PrismaAdminRepository } from "./infrastructure/prisma-admin-repository.js";
import { VerifiedBadgeService } from "../premium/application/verified-badge-service.js";
import { AdminController } from "./presentation/admin-controller.js";
import { createAdminRouter } from "./presentation/admin-router.js";

import type { OfficialChatService } from "../official-chat/application/official-chat-service.js";

export interface AdminModule {
  router: Router;
  service: AdminService;
}

export function createAdminModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
  officialChat?: OfficialChatService,
): AdminModule {
  const repository = new PrismaAdminRepository(database);
  const service = new AdminService(repository, config.UPLOAD_ROOT);
  const mediaService = new MediaService(
    new PrismaMediaRepository(database),
    config,
  );
  const controller = new AdminController(
    service,
    config.UPLOAD_ROOT,
    mediaService,
    officialChat,
    new VerifiedBadgeService(database),
  );
  return {
    router: createAdminRouter(controller, database, authenticate),
    service,
  };
}
