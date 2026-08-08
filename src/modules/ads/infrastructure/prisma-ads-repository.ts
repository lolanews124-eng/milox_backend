import { AdPlacement, Prisma, type PrismaClient } from "@prisma/client";

import type {
  AdPlacementConfigRecord,
  AdsRepository,
  ServedAdRecord,
} from "../application/ports/ads-repository.js";

const servedAdSelect = {
  id: true,
  title: true,
  body: true,
  imageUrl: true,
  targetUrl: true,
  ctaLabel: true,
  placement: true,
  priority: true,
} satisfies Prisma.AdvertisementSelect;

function activeAdWhere(placement: AdPlacement, now: Date): Prisma.AdvertisementWhereInput {
  return {
    placement,
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
}

export class PrismaAdsRepository implements AdsRepository {
  constructor(private readonly database: PrismaClient) {}

  async listActiveAds(
    placement: AdPlacement,
    limit: number,
    now: Date,
  ): Promise<ServedAdRecord[]> {
    const config = await this.getPlacementConfig(placement);
    if (config && !config.isEnabled) return [];

    return this.database.advertisement.findMany({
      where: activeAdWhere(placement, now),
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: Math.max(1, Math.min(limit, 20)),
      select: servedAdSelect,
    });
  }

  async pickAdForSlot(
    placement: AdPlacement,
    slot: number,
    now: Date,
  ): Promise<ServedAdRecord | null> {
    const ads = await this.listActiveAds(placement, 20, now);
    if (ads.length === 0) return null;
    const index = Math.abs(slot) % ads.length;
    return ads[index] ?? null;
  }

  recordImpression(adId: string): Promise<void> {
    return this.database.advertisement
      .updateMany({
        where: { id: adId },
        data: { impressionCount: { increment: 1 } },
      })
      .then(() => undefined);
  }

  recordClick(adId: string): Promise<void> {
    return this.database.advertisement
      .updateMany({
        where: { id: adId },
        data: { clickCount: { increment: 1 } },
      })
      .then(() => undefined);
  }

  async listPlacementConfigs(): Promise<AdPlacementConfigRecord[]> {
    const rows = await this.database.adPlacementConfig.findMany({
      orderBy: { placement: "asc" },
    });
    return rows.map(mapPlacementConfig);
  }

  async getPlacementConfig(
    placement: AdPlacement,
  ): Promise<AdPlacementConfigRecord | null> {
    const row = await this.database.adPlacementConfig.findUnique({
      where: { placement },
    });
    return row ? mapPlacementConfig(row) : null;
  }
}

function mapPlacementConfig(row: {
  placement: AdPlacement;
  label: string;
  description: string | null;
  isEnabled: boolean;
  insertEvery: number;
  updatedAt: Date;
}): AdPlacementConfigRecord {
  return {
    placement: row.placement,
    label: row.label,
    description: row.description,
    isEnabled: row.isEnabled,
    insertEvery: row.insertEvery,
    updatedAt: row.updatedAt,
  };
}
