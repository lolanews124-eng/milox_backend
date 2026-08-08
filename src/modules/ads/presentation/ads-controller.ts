import type { Request, Response } from "express";

import type { AdsService } from "../application/ads-service.js";
import {
  presentPlacementConfig,
  presentServedAd,
} from "../application/ads-service.js";
import {
  adIdParamSchema,
  adPlacementQuerySchema,
  adSlotQuerySchema,
} from "./ads-schemas.js";

export class AdsController {
  constructor(private readonly ads: AdsService) {}

  listPlacements = async (request: Request, response: Response): Promise<void> => {
    const configs = await this.ads.listPlacements();
    response.status(200).json({
      success: true,
      data: { items: configs.map(presentPlacementConfig) },
      meta: { requestId: request.requestId },
    });
  };

  listAds = async (request: Request, response: Response): Promise<void> => {
    const query = adPlacementQuerySchema.parse(request.query);
    const items = await this.ads.listAds(query.placement, query.limit);
    response.status(200).json({
      success: true,
      data: { items: items.map(presentServedAd) },
      meta: { requestId: request.requestId },
    });
  };

  pickAd = async (request: Request, response: Response): Promise<void> => {
    const query = adSlotQuerySchema.parse(request.query);
    const ad = await this.ads.pickAd(query.placement, query.slot);
    response.status(200).json({
      success: true,
      data: { ad: ad ? presentServedAd(ad) : null },
      meta: { requestId: request.requestId },
    });
  };

  recordImpression = async (request: Request, response: Response): Promise<void> => {
    const { adId } = adIdParamSchema.parse(request.params);
    await this.ads.recordImpression(adId);
    response.status(204).send();
  };

  recordClick = async (request: Request, response: Response): Promise<void> => {
    const { adId } = adIdParamSchema.parse(request.params);
    await this.ads.recordClick(adId);
    response.status(204).send();
  };
}
