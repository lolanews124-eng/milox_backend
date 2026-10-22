import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { CryptoService } from "../auth/application/services/crypto-service.js";
import { BotsService } from "./application/services/bots-service.js";
import { PrismaBotsRepository } from "./infrastructure/prisma-bots-repository.js";
import { BotsController } from "./presentation/bots-controller.js";
import { createBotsRouter } from "./presentation/bots-router.js";

export interface BotsModule {
  router: Router;
  service: BotsService;
}

export function createBotsModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
): BotsModule {
  const repository = new PrismaBotsRepository(database);
  const crypto = new CryptoService(config);
  const service = new BotsService(repository, config, crypto, database);
  const controller = new BotsController(service);
  return {
    router: createBotsRouter(controller, database, authenticate),
    service,
  };
}

export {
  BOT_CANDIDATE_CRITERIA_VERSION,
  computeInactiveAt,
  inactivitySignalSource,
  rankCandidatesByInactivity,
} from "./application/inactivity.js";
export {
  buildBotUsernameCandidate,
  isValidBotUsername,
} from "./application/bot-username.js";
export { eligibleCandidateWhere } from "./infrastructure/prisma-bots-repository.js";
