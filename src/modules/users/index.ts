import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import type { AuthService } from "../auth/application/services/auth-service.js";
import type { ProfileUpdatePostWriter } from "../posts/application/profile-update-post-writer.js";
import { UserService } from "./application/services/user-service.js";
import { PrismaUserRepository } from "./infrastructure/prisma-user-repository.js";
import { UserController } from "./presentation/user-controller.js";
import { createUserRouter } from "./presentation/user-router.js";

export interface UserModuleSecurity {
  authenticate: RequestHandler;
  optionalAuthenticate: RequestHandler;
  requireVerified: RequestHandler;
}

export interface UserModule {
  router: Router;
  service: UserService;
}

export function createUserModule(
  config: AppConfig,
  database: PrismaClient,
  authService: AuthService,
  security: UserModuleSecurity,
  profileUpdatePosts?: ProfileUpdatePostWriter,
): UserModule {
  const repository = new PrismaUserRepository(database);
  const service = new UserService(
    repository,
    authService,
    config,
    profileUpdatePosts,
  );
  const controller = new UserController(service);

  return {
    router: createUserRouter(controller, security),
    service,
  };
}
