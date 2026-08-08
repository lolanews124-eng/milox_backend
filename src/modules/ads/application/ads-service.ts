import type { AdPlacement } from "@prisma/client";

import type {
  AdPlacementConfigRecord,
  AdsRepository,
  ServedAdRecord,
} from "./ports/ads-repository.js";

export class AdsService {
  constructor(private readonly repository: AdsRepository) {}

  listPlacements(): Promise<AdPlacementConfigRecord[]> {
    return this.repository.listPlacementConfigs();
  }

  listAds(placement: AdPlacement, limit: number): Promise<ServedAdRecord[]> {
    return this.repository.listActiveAds(placement, limit, new Date());
  }

  pickAd(placement: AdPlacement, slot: number): Promise<ServedAdRecord | null> {
    return this.repository.pickAdForSlot(placement, slot, new Date());
  }

  recordImpression(adId: string): Promise<void> {
    return this.repository.recordImpression(adId);
  }

  recordClick(adId: string): Promise<void> {
    return this.repository.recordClick(adId);
  }
}

export function presentServedAd(ad: ServedAdRecord): object {
  return {
    id: ad.id,
    title: ad.title,
    body: ad.body,
    imageUrl: ad.imageUrl,
    targetUrl: ad.targetUrl,
    ctaLabel: ad.ctaLabel ?? "Learn more",
    placement: ad.placement,
    priority: ad.priority,
    sponsoredLabel: "Sponsored",
  };
}

export function presentPlacementConfig(config: AdPlacementConfigRecord): object {
  return {
    placement: config.placement,
    label: config.label,
    description: config.description,
    isEnabled: config.isEnabled,
    insertEvery: config.insertEvery,
    updatedAt: config.updatedAt.toISOString(),
  };
}
