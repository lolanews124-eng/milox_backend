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
import type { PaypalClient } from "../payments/infrastructure/paypal-client.js";
import type { CashfreeClient } from "../payments/infrastructure/cashfree-client.js";

import type { OfficialChatService } from "../official-chat/application/official-chat-service.js";
import type { CallService } from "../calls/application/call-service.js";

export interface AdminModule {
  router: Router;
  service: AdminService;
}

export function createAdminModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
  officialChat?: OfficialChatService,
  paypalClient?: PaypalClient,
  calls?: CallService,
  cashfreeClient?: CashfreeClient,
): AdminModule {
  const repository = new PrismaAdminRepository(database);
  const service = new AdminService(
    repository,
    config.UPLOAD_ROOT,
    paypalClient ? { config, client: paypalClient } : undefined,
    database,
    calls,
    cashfreeClient ? { config, client: cashfreeClient } : undefined,
  );
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
