import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import type { AuthController } from "./auth-controller.js";
import { authenticate } from "./auth-middleware.js";
import type { CryptoService } from "../application/services/crypto-service.js";

export function createAuthRouter(
  controller: AuthController,
  crypto: CryptoService,
): Router {
  const router = Router();
  // Local/dev smoke tests burn through a tight login cap quickly.
  const isProd = process.env.NODE_ENV === "production";
  const strictAuthLimit = createLimit(
    isProd ? 10 : 200,
    10 * 60 * 1000,
  );
  const refreshLimit = createLimit(isProd ? 30 : 300, 10 * 60 * 1000);

  router.post("/signup", strictAuthLimit, asyncHandler(controller.signup));
  router.post("/login", strictAuthLimit, asyncHandler(controller.login));
  router.post("/refresh", refreshLimit, asyncHandler(controller.refresh));
  router.post(
    "/logout",
    authenticate(crypto),
    asyncHandler(controller.logout),
  );
  router.post(
    "/verify-email",
    strictAuthLimit,
    asyncHandler(controller.verifyEmail),
  );
  router.post(
    "/verify-email/resend",
    strictAuthLimit,
    authenticate(crypto),
    asyncHandler(controller.resendVerification),
  );
  router.post(
    "/forgot-password",
    strictAuthLimit,
    asyncHandler(controller.forgotPassword),
  );
  router.post(
    "/reset-password",
    strictAuthLimit,
    asyncHandler(controller.resetPassword),
  );

  return router;
}

function createLimit(limit: number, windowMs: number) {
  return rateLimit({
    limit,
    windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (request: Request, response: Response) => {
      response.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests; please try again later",
          details: [],
        },
        meta: { requestId: request.requestId },
      });
    },
  });
}
