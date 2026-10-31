import { AsyncLocalStorage } from "node:async_hooks";

import type { NextFunction, Request, RequestHandler, Response } from "express";

type AdminPerfStore = {
  queryCount: number;
  slowQueries: Array<{ model: string; action: string; durationMs: number }>;
};

const store = new AsyncLocalStorage<AdminPerfStore>();

const SLOW_QUERY_MS = Number(process.env.ADMIN_PERF_SLOW_MS ?? "100") || 100;

export function adminPerfEnabled(): boolean {
  return process.env.ADMIN_PERF_LOG === "true";
}

export function getAdminPerfStore(): AdminPerfStore | undefined {
  return store.getStore();
}

export function recordAdminQuery(input: {
  model?: string;
  action?: string;
  durationMs: number;
}): void {
  const current = store.getStore();
  if (!current) return;
  current.queryCount += 1;
  if (input.durationMs >= SLOW_QUERY_MS) {
    current.slowQueries.push({
      model: input.model ?? "raw",
      action: input.action ?? "query",
      durationMs: Math.round(input.durationMs),
    });
  }
}

/**
 * Optional admin request timing. Enable with ADMIN_PERF_LOG=true.
 * Logs path, status, duration, query count, and slow query summaries only —
 * never tokens, credentials, or personal data.
 */
export function adminPerfMiddleware(): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!adminPerfEnabled()) {
      next();
      return;
    }

    const started = performance.now();
    const perf: AdminPerfStore = { queryCount: 0, slowQueries: [] };

    store.run(perf, () => {
      response.on("finish", () => {
        const durationMs = Math.round(performance.now() - started);
        const slow = perf.slowQueries
          .slice(0, 8)
          .map((row) => `${row.model}.${row.action}:${row.durationMs}ms`)
          .join(",");
        // eslint-disable-next-line no-console -- opt-in ops telemetry
        console.info(
          JSON.stringify({
            type: "admin_perf",
            method: request.method,
            path: request.path,
            status: response.statusCode,
            durationMs,
            queryCount: perf.queryCount,
            slowQueries: slow || undefined,
            requestId: request.requestId,
          }),
        );
      });
      next();
    });
  };
}
