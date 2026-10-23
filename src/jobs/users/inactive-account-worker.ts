import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../config/env.js";
import { runInactiveAccountSuspension } from "../../modules/users/application/inactive-account-suspension.js";

/**
 * Periodically applies inactive-account suspensions when enabled.
 * Overlap guarded by in-process `running` + DB advisory lock in the service.
 */
export class InactiveAccountWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    if (!this.config.INACTIVE_ACCOUNT_WORKER_ENABLED) return;
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, this.config.INACTIVE_ACCOUNT_POLL_MS);
    this.timer.unref();
    void this.tick().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (!this.config.INACTIVE_ACCOUNT_WORKER_ENABLED) return;
    if (this.running) return;
    this.running = true;
    try {
      const result = await runInactiveAccountSuspension(this.database, {
        apply: true,
        inactiveDays: this.config.INACTIVE_ACCOUNT_DAYS,
        batchSize: 100,
        maxAccounts: 2_000,
      });
      if (result.lockAcquired && result.suspended > 0) {
        console.info(
          `[inactive-account] suspended=${result.suspended} eligible=${result.eligible} scanned=${result.scanned}`,
        );
      }
    } finally {
      this.running = false;
    }
  }
}
