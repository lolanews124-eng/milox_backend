import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { AuthService } from "./application/services/auth-service.js";
import { CryptoService } from "./application/services/crypto-service.js";
import { PrismaAuthRepository } from "./infrastructure/prisma-auth-repository.js";
import { AuthController } from "./presentation/auth-controller.js";
import {
  authenticate,
  optionalAuthenticate,
  requireVerified,
} from "./presentation/auth-middleware.js";
import { createAuthRouter } from "./presentation/auth-router.js";

export interface AuthModule {
  router: Router;
  authenticate: RequestHandler;
  optionalAuthenticate: RequestHandler;
  requireVerified: RequestHandler;
  service: AuthService;
}

export function createAuthModule(
  config: AppConfig,
  database: PrismaClient,
): AuthModule {
  const crypto = new CryptoService(config);
  const repository = new PrismaAuthRepository(database);
  const service = new AuthService(repository, crypto, config);
  const controller = new AuthController(service, config);

  return {
    router: createAuthRouter(controller, crypto),
    authenticate: authenticate(crypto, database),
    optionalAuthenticate: optionalAuthenticate(crypto),
    requireVerified,
    service,
  };
}
