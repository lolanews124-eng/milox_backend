import type { PushPlatform } from "@prisma/client";

export interface PushDeviceRecord {
  id: string;
  userId: string;
  token: string;
  platform: PushPlatform;
}

export interface PushDeviceRepository {
  upsertToken(input: {
    userId: string;
    token: string;
    platform: PushPlatform;
  }): Promise<PushDeviceRecord>;
  removeToken(input: { userId: string; token: string }): Promise<boolean>;
  listTokensForUser(userId: string): Promise<string[]>;
  removeTokens(tokens: string[]): Promise<void>;
}
