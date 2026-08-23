import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { CallService } from "./application/call-service.js";
import { createCallsRouter } from "./presentation/calls-router.js";

export interface CallsModule {
  router: Router;
  service: CallService;
}

export function createCallsModule(
  config: AppConfig,
  database: PrismaClient,
  middleware: {
    authenticate: RequestHandler;
    requireVerified: RequestHandler;
  },
  existingService?: CallService,
): CallsModule {
  const service = existingService ?? new CallService(database, config);
  return {
    service,
    router: createCallsRouter(
      service,
      middleware.authenticate,
      middleware.requireVerified,
    ),
  };
}

export { CallService } from "./application/call-service.js";
