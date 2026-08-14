import type { PrismaClient } from "@prisma/client";
import { Router } from "express";

import { asyncHandler } from "../../shared/http/async-handler.js";
import {
  ensureMobileAppConfig,
  presentMobileAppConfig,
} from "./mobile-app-config.js";

export function createAppReleaseRouter(database: PrismaClient): Router {
  const router = Router();
  router.get(
    "/mobile",
    asyncHandler(async (request, response) => {
      const config = await ensureMobileAppConfig(database);
      response.status(200).json({
        success: true,
        data: presentMobileAppConfig(config),
        meta: { requestId: request.requestId },
      });
    }),
  );
  return router;
}