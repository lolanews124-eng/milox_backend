import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { z } from "zod";

import { AppError } from "../../../shared/errors/app-error.js";
import { asyncHandler } from "../../../shared/http/async-handler.js";
import {
  authenticatedRateLimitKey,
  createRateLimit,
} from "../../../shared/http/rate-limit.js";
import type { CallService } from "../application/call-service.js";

const createCallSchema = z
  .object({
    conversationId: z.uuid(),
  })
  .strict();

const callIdParamSchema = z.object({
  callId: z.uuid(),
});

export function createCallsRouter(
  calls: CallService,
  authenticate: RequestHandler,
  requireVerified: RequestHandler,
): Router {
  const router = Router();
  const createLimit = createRateLimit(5, 10 * 60 * 1000, {
    keyGenerator: authenticatedRateLimitKey,
  });
  const actionLimit = createRateLimit(60, 10 * 60 * 1000, {
    keyGenerator: authenticatedRateLimitKey,
  });

  router.use(authenticate);

  router.get(
    "/ice-servers",
    asyncHandler(async (request, response) => {
      const data = await calls.getIceServers(requireUser(request));
      response.status(200).json(ok(request, data));
    }),
  );

  router.get(
    "/history",
    asyncHandler(async (request, response) => {
      const data = await calls.listCallHistory(requireUser(request));
      response.status(200).json(ok(request, data));
    }),
  );

  router.get(
    "/:callId",
    asyncHandler(async (request, response) => {
      const { callId } = callIdParamSchema.parse(request.params);
      const data = await calls.getCallForUser(callId, requireUser(request));
      response.status(200).json(ok(request, data));
    }),
  );

  router.post(
    "/",
    requireVerified,
    createLimit,
    asyncHandler(async (request, response) => {
      const body = createCallSchema.parse(request.body);
      const data = await calls.createCall(
        requireUser(request),
        body.conversationId,
      );
      response.status(201).json(ok(request, data));
    }),
  );

  router.post(
    "/:callId/accept",
    requireVerified,
    actionLimit,
    asyncHandler(async (request, response) => {
      const { callId } = callIdParamSchema.parse(request.params);
      const data = await calls.acceptCall(callId, requireUser(request));
      response.status(200).json(ok(request, data));
    }),
  );

  router.post(
    "/:callId/reject",
    requireVerified,
    actionLimit,
    asyncHandler(async (request, response) => {
      const { callId } = callIdParamSchema.parse(request.params);
      await calls.rejectCall(callId, requireUser(request));
      response.status(204).send();
    }),
  );

  router.post(
    "/:callId/end",
    requireVerified,
    actionLimit,
    asyncHandler(async (request, response) => {
      const { callId } = callIdParamSchema.parse(request.params);
      const data = await calls.endCall(callId, requireUser(request));
      response.status(200).json(ok(request, data));
    }),
  );

  router.post(
    "/:callId/quality",
    requireVerified,
    actionLimit,
    asyncHandler(async (request, response) => {
      const { callId } = callIdParamSchema.parse(request.params);
      const body = z
        .object({
          iceRestartCount: z.number().int().min(0).max(100).optional(),
          poorNetworkEvents: z.number().int().min(0).max(100).optional(),
          connectedSeconds: z.number().int().min(0).max(86_400).optional(),
        })
        .strict()
        .parse(request.body);
      await calls.reportQuality(callId, requireUser(request), {
        ...(body.iceRestartCount !== undefined
          ? { iceRestartCount: body.iceRestartCount }
          : {}),
        ...(body.poorNetworkEvents !== undefined
          ? { poorNetworkEvents: body.poorNetworkEvents }
          : {}),
        ...(body.connectedSeconds !== undefined
          ? { connectedSeconds: body.connectedSeconds }
          : {}),
      });
      response.status(204).send();
    }),
  );

  return router;
}

function requireUser(request: Request): string {
  if (!request.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }
  return request.auth.userId;
}

function ok(request: Request, data: object) {
  return {
    success: true,
    data,
    meta: { requestId: request.requestId },
  };
}
