import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { RequestHandler } from "express";

import { AdsService } from "./application/ads-service.js";
import { PrismaAdsRepository } from "./infrastructure/prisma-ads-repository.js";
import { AdsController } from "./presentation/ads-controller.js";
import { createAdsRouter } from "./presentation/ads-router.js";

export interface AdsModule {
  router: Router;
  service: AdsService;
  repository: PrismaAdsRepository;
}

export function createAdsModule(
  database: PrismaClient,
  optionalAuthenticate?: RequestHandler,
): AdsModule {
  const repository = new PrismaAdsRepository(database);
  const service = new AdsService(repository);
  const controller = new AdsController(service);
  return {
    router: createAdsRouter(controller, optionalAuthenticate),
    service,
    repository,
  };
}
