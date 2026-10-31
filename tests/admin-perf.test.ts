import { describe, expect, it, vi } from "vitest";

import {
  adminPerfEnabled,
  adminPerfMiddleware,
  getAdminPerfStore,
  recordAdminQuery,
} from "../src/infrastructure/observability/admin-perf.js";

describe("admin perf instrumentation", () => {
  it("is disabled unless ADMIN_PERF_LOG=true", () => {
    const previous = process.env.ADMIN_PERF_LOG;
    delete process.env.ADMIN_PERF_LOG;
    expect(adminPerfEnabled()).toBe(false);
    process.env.ADMIN_PERF_LOG = "true";
    expect(adminPerfEnabled()).toBe(true);
    if (previous === undefined) delete process.env.ADMIN_PERF_LOG;
    else process.env.ADMIN_PERF_LOG = previous;
  });

  it("records query counts inside middleware ALS without logging PII fields", async () => {
    const previous = process.env.ADMIN_PERF_LOG;
    process.env.ADMIN_PERF_LOG = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const middleware = adminPerfMiddleware();
    const request = {
      method: "GET",
      path: "/users/stats",
      requestId: "req-1",
    } as never;
    const listeners: Record<string, () => void> = {};
    const response = {
      statusCode: 200,
      on: (event: string, handler: () => void) => {
        listeners[event] = handler;
      },
    } as never;

    await new Promise<void>((resolve) => {
      middleware(request, response, () => {
        expect(getAdminPerfStore()?.queryCount).toBe(0);
        recordAdminQuery({ model: "sql", action: "query", durationMs: 5 });
        recordAdminQuery({ model: "sql", action: "query", durationMs: 250 });
        expect(getAdminPerfStore()?.queryCount).toBe(2);
        resolve();
      });
    });

    listeners.finish?.();
    expect(info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload.type).toBe("admin_perf");
    expect(payload.path).toBe("/users/stats");
    expect(payload.queryCount).toBe(2);
    expect(payload.slowQueries).toContain("sql.query:250ms");
    expect(JSON.stringify(payload)).not.toMatch(/password|token|email|Bearer/i);

    info.mockRestore();
    if (previous === undefined) delete process.env.ADMIN_PERF_LOG;
    else process.env.ADMIN_PERF_LOG = previous;
  });
});
