import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../config/env.js";
import { asyncHandler } from "../../shared/http/async-handler.js";
import { EmailCampaignService } from "./email-campaign-service.js";

const unsubscribeSchema = z.object({
  u: z.string().uuid(),
  t: z.string().min(16).max(64),
});

export function createEmailMarketingPublicRouter(
  config: AppConfig,
  database: PrismaClient,
): Router {
  const router = Router();
  const service = new EmailCampaignService(
    database,
    config.JWT_ACCESS_SECRET,
    config.PUBLIC_WEB_ORIGIN,
  );

  const handleUnsubscribe = asyncHandler(async (request, response) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const query = unsubscribeSchema.parse({
      u: request.query.u ?? body.u,
      t: request.query.t ?? body.t,
    });
    await service.optOutFromMarketing(query.u, query.t);
    response.status(200).json({
      success: true,
      data: { optedOut: true },
      meta: { requestId: request.requestId },
    });
  });

  router.get("/unsubscribe", handleUnsubscribe);
  router.post("/unsubscribe", handleUnsubscribe);

  return router;
}
