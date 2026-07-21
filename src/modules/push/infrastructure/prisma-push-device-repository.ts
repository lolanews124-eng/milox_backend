import type { PrismaClient, PushPlatform } from "@prisma/client";

import type {
  PushDeviceRecord,
  PushDeviceRepository,
} from "../application/ports/push-device-repository.js";

export class PrismaPushDeviceRepository implements PushDeviceRepository {
  constructor(private readonly database: PrismaClient) {}

  async upsertToken(input: {
    userId: string;
    token: string;
    platform: PushPlatform;
  }): Promise<PushDeviceRecord> {
    return this.database.$transaction(async (transaction) => {
      // Drop stale tokens for this user so reinstall/login does not fan out
      // multiple pushes to the same person.
      await transaction.pushDevice.deleteMany({
        where: {
          userId: input.userId,
          NOT: { token: input.token },
        },
      });

      return transaction.pushDevice.upsert({
        where: { token: input.token },
        create: {
          userId: input.userId,
          token: input.token,
          platform: input.platform,
        },
        update: {
          userId: input.userId,
          platform: input.platform,
        },
        select: {
          id: true,
          userId: true,
          token: true,
          platform: true,
        },
      });
    });
  }

  async removeToken(input: {
    userId: string;
    token: string;
  }): Promise<boolean> {
    const result = await this.database.pushDevice.deleteMany({
      where: {
        userId: input.userId,
        token: input.token,
      },
    });
    return result.count > 0;
  }

  listTokensForUser(userId: string): Promise<string[]> {
    return this.database.pushDevice
      .findMany({
        where: { userId },
        select: { token: true },
      })
      .then((rows) => rows.map((row) => row.token));
  }

  removeTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return Promise.resolve();
    return this.database.pushDevice
      .deleteMany({
        where: { token: { in: tokens } },
      })
      .then(() => undefined);
  }
}
