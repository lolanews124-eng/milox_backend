import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import type { UserController } from "./user-controller.js";

export interface UserRouterSecurity {
  authenticate: RequestHandler;
  optionalAuthenticate: RequestHandler;
  requireVerified: RequestHandler;
}

export function createUserRouter(
  controller: UserController,
  security: UserRouterSecurity,
): Router {
  const router = Router();

  router.get("/me", security.authenticate, asyncHandler(controller.getMe));
  router.patch(
    "/me",
    security.authenticate,
    security.requireVerified,
    asyncHandler(controller.updateProfile),
  );
  router.delete(
    "/me",
    security.authenticate,
    asyncHandler(controller.deleteAccount),
  );
  router.patch(
    "/me/settings/privacy",
    security.authenticate,
    asyncHandler(controller.updatePrivacy),
  );
  router.put(
    "/me/password",
    security.authenticate,
    asyncHandler(controller.changePassword),
  );

  // Static search must stay above /:username.
  router.get(
    "/search",
    security.optionalAuthenticate,
    asyncHandler(controller.search),
  );

  // Keep dynamic username route last so it never captures /me or /search.
  router.get(
    "/:username",
    security.optionalAuthenticate,
    asyncHandler(controller.getPublicProfile),
  );

  return router;
}
