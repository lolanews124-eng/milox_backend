import type { AdPlacement } from "@prisma/client";

export interface ServedAdMedia {
  kind: "IMAGE" | "VIDEO";
  url: string;
  posterUrl: string | null;
  targetUrl: string | null;
}

export interface ServedAdRecord {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  targetUrl: string | null;
  ctaLabel: string | null;
  format: "IMAGE" | "CAROUSEL" | "VIDEO";
  placement: AdPlacement;
  placements: AdPlacement[];
  media: ServedAdMedia[];
  priority: number;
}

export interface AdPlacementConfigRecord {
  placement: AdPlacement;
  label: string;
  description: string | null;
  isEnabled: boolean;
  insertEvery: number;
  updatedAt: Date;
}

export interface AdsRepository {
  listActiveAds(placement: AdPlacement, limit: number, now: Date): Promise<ServedAdRecord[]>;
  pickAdForSlot(placement: AdPlacement, slot: number, now: Date): Promise<ServedAdRecord | null>;
  recordImpression(adId: string): Promise<void>;
  recordClick(adId: string): Promise<void>;
  listPlacementConfigs(): Promise<AdPlacementConfigRecord[]>;
  getPlacementConfig(placement: AdPlacement): Promise<AdPlacementConfigRecord | null>;
}
