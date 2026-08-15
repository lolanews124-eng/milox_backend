import type { PrismaClient } from "@prisma/client";
import { SubscriptionStatus } from "@prisma/client";

import type { AppConfig } from "../../config/env.js";
import {
  expireStandaloneVerifiedBadges,
  syncUserPremiumState,
} from "../../modules/premium/application/entitlements.js";

export class SubscriptionExpiryWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, this.config.SUBSCRIPTION_EXPIRY_POLL_MS);
    this.timer.unref();
    void this.tick().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const expired = await this.database.userSubscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          endsAt: { lte: now },
        },
        select: { id: true, userId: true },
        take: 200,
      });
      if (expired.length > 0) {
        await this.database.userSubscription.updateMany({
          where: { id: { in: expired.map((row) => row.id) } },
          data: { status: SubscriptionStatus.EXPIRED },
        });

        const userIds = [...new Set(expired.map((row) => row.userId))];
        for (const userId of userIds) {
          await syncUserPremiumState(this.database, userId);
        }
      }

      await expireStandaloneVerifiedBadges(this.database);
    } finally {
      this.running = false;
    }
  }
}
