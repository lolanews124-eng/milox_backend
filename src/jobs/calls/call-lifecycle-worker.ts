import type { CallService } from "../../modules/calls/application/call-service.js";

const POLL_MS = 5_000;

export class CallLifecycleWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly calls: CallService) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, POLL_MS);
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
      await this.calls.processDueCallTimers();
    } finally {
      this.running = false;
    }
  }
}
