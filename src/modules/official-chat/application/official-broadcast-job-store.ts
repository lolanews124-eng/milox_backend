import { randomUUID } from "node:crypto";

export type OfficialBroadcastJobStatus = "running" | "completed" | "failed";

export interface OfficialBroadcastJob {
  id: string;
  status: OfficialBroadcastJobStatus;
  sent: number;
  failed: number;
  total: number;
  message: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

const MAX_JOBS = 50;

export class OfficialBroadcastJobStore {
  private readonly jobs = new Map<string, OfficialBroadcastJob>();

  create(total: number): OfficialBroadcastJob {
    const job: OfficialBroadcastJob = {
      id: randomUUID(),
      status: "running",
      sent: 0,
      failed: 0,
      total,
      message: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    this.jobs.set(job.id, job);
    this.prune();
    return job;
  }

  get(jobId: string): OfficialBroadcastJob | undefined {
    return this.jobs.get(jobId);
  }

  complete(
    jobId: string,
    result: { sent: number; failed: number; total: number },
    message: string,
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = "completed";
    job.sent = result.sent;
    job.failed = result.failed;
    job.total = result.total;
    job.message = message;
    job.completedAt = new Date().toISOString();
  }

  fail(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = "failed";
    job.error = error;
    job.completedAt = new Date().toISOString();
  }

  private prune(): void {
    if (this.jobs.size <= MAX_JOBS) return;
    const oldest = [...this.jobs.values()].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
    while (this.jobs.size > MAX_JOBS && oldest.length > 0) {
      const job = oldest.shift();
      if (job) this.jobs.delete(job.id);
    }
  }
}

export const officialBroadcastJobStore = new OfficialBroadcastJobStore();
