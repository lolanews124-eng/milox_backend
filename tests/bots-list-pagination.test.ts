import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { CryptoService } from "../src/modules/auth/application/services/crypto-service.js";
import { BotsService } from "../src/modules/bots/application/services/bots-service.js";

function makeConfig(): AppConfig {
  return {
    MILOX_ENV: "local",
    BOTS_WORKER_ENABLED: false,
    BOTS_ALLOW_MUTATIONS: false,
    DATABASE_URL: "postgresql://milox:x@localhost:5432/milox_live_copy",
    API_PUBLIC_URL: "http://localhost:3001",
    JWT_ACCESS_SECRET: "x".repeat(32),
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_ISSUER: "milox-api",
    JWT_AUDIENCE: "milox-clients",
  } as AppConfig;
}

function makeListItem(
  index: number,
  createdAt: Date,
  status: "ACTIVE" | "PAUSED" | "DISABLED" = "PAUSED",
) {
  return {
    id: `bot-${String(index).padStart(3, "0")}`,
    userId: `user-${String(index).padStart(3, "0")}`,
    username: `botuser${index}`,
    displayName: `Bot ${index}`,
    status,
    sourceCandidateUserId: `source-${index}`,
    candidateBatchId: "batch-1",
    createdAt,
    profilePhotoMediaId: null as string | null,
  };
}

describe("bots list pagination + provision visibility", () => {
  it("returns total/limit/offset and pages more than 12 bots", async () => {
    const now = Date.now();
    const all = Array.from({ length: 25 }, (_, i) =>
      makeListItem(25 - i, new Date(now - i * 1000)),
    );

    const repository = {
      listBotAccounts: vi.fn().mockImplementation(async (input: {
        limit: number;
        offset: number;
        query?: string;
        status?: string;
      }) => {
        let rows = all;
        if (input.status) {
          rows = rows.filter((row) => row.status === input.status);
        }
        if (input.query) {
          const q = input.query.trim().toLowerCase();
          rows = rows.filter((row) => row.username.includes(q));
        }
        return {
          total: rows.length,
          items: rows.slice(input.offset, input.offset + input.limit),
        };
      }),
    };

    const service = new BotsService(
      repository as never,
      makeConfig(),
      new CryptoService(makeConfig()),
    );

    const page1 = await service.listBots({ limit: 10, offset: 0 });
    expect(page1.total).toBe(25);
    expect(page1.limit).toBe(10);
    expect(page1.offset).toBe(0);
    expect(page1.items).toHaveLength(10);
    expect(page1.items[0]?.username).toBe("botuser25");

    const page2 = await service.listBots({ limit: 10, offset: 10 });
    expect(page2.total).toBe(25);
    expect(page2.limit).toBe(10);
    expect(page2.offset).toBe(10);
    expect(page2.items).toHaveLength(10);
    expect(page2.items[0]?.username).toBe("botuser15");

    const page3 = await service.listBots({ limit: 10, offset: 20 });
    expect(page3.total).toBe(25);
    expect(page3.items).toHaveLength(5);
    expect(page3.items[0]?.username).toBe("botuser5");

    // Out-of-range offset: empty items, total still correct (FE clamps separately).
    const empty = await service.listBots({ limit: 10, offset: 100 });
    expect(empty.total).toBe(25);
    expect(empty.offset).toBe(100);
    expect(empty.items).toHaveLength(0);
  });

  it("filters by status and search with pagination metadata", async () => {
    const rows = [
      { ...makeListItem(1, new Date("2026-01-03T00:00:00Z")), status: "ACTIVE" as const, username: "alpha_bot" },
      { ...makeListItem(2, new Date("2026-01-02T00:00:00Z")), status: "PAUSED" as const, username: "beta_bot" },
      { ...makeListItem(3, new Date("2026-01-01T00:00:00Z")), status: "PAUSED" as const, username: "gamma_bot" },
    ];

    const repository = {
      listBotAccounts: vi.fn().mockImplementation(async (input: {
        limit: number;
        offset: number;
        query?: string;
        status?: string;
      }) => {
        let filtered = rows;
        if (input.status) {
          filtered = filtered.filter((row) => row.status === input.status);
        }
        if (input.query) {
          const q = input.query.trim().toLowerCase();
          filtered = filtered.filter((row) => row.username.includes(q));
        }
        return {
          total: filtered.length,
          items: filtered.slice(input.offset, input.offset + input.limit),
        };
      }),
    };

    const service = new BotsService(
      repository as never,
      makeConfig(),
      new CryptoService(makeConfig()),
    );

    const paused = await service.listBots({
      status: "PAUSED",
      limit: 50,
      offset: 0,
    });
    expect(paused.total).toBe(2);
    expect(paused.limit).toBe(50);
    expect(paused.items.map((i) => i.username)).toEqual([
      "beta_bot",
      "gamma_bot",
    ]);

    const search = await service.listBots({
      query: "gamma",
      limit: 50,
      offset: 0,
    });
    expect(search.total).toBe(1);
    expect(search.items[0]?.username).toBe("gamma_bot");
  });

  it("places a newly provisioned bot first under createdAt+id desc ordering", async () => {
    const existing = [
      makeListItem(1, new Date("2026-01-01T00:00:00Z")),
      makeListItem(2, new Date("2026-01-02T00:00:00Z")),
    ];
    const createdAt = new Date("2026-01-03T12:00:00Z");
    const newest = {
      id: "bot-new",
      userId: "user-new",
      username: "fresh_bot",
      displayName: "Fresh",
      status: "ACTIVE" as "ACTIVE" | "PAUSED" | "DISABLED",
      sourceCandidateUserId: "source-new",
      candidateBatchId: "batch-new",
      createdAt,
      profilePhotoMediaId: "55555555-5555-5555-5555-555555555555",
    };

    let store = [...existing];

    const repository = {
      listBotAccounts: vi.fn().mockImplementation(async (input: {
        limit: number;
        offset: number;
      }) => {
        const sorted = [...store].sort((a, b) => {
          const byDate = b.createdAt.getTime() - a.createdAt.getTime();
          if (byDate !== 0) return byDate;
          return b.id.localeCompare(a.id);
        });
        return {
          total: sorted.length,
          items: sorted.slice(input.offset, input.offset + input.limit),
        };
      }),
    };

    const service = new BotsService(
      repository as never,
      makeConfig(),
      new CryptoService(makeConfig()),
    );

    const before = await service.listBots({ limit: 50, offset: 0 });
    expect(before.total).toBe(2);

    store = [newest, ...existing];
    const after = await service.listBots({ limit: 50, offset: 0 });
    expect(after.total).toBe(3);
    expect(after.items[0]?.username).toBe("fresh_bot");
    expect(after.items[0]?.status).toBe("ACTIVE");
    expect(after.items[0]?.profilePhotoUrl).toContain(
      "/api/v1/media/55555555-5555-5555-5555-555555555555",
    );
    // Existing paused bots remain paused in the list.
    expect(after.items.some((item) => item.status === "PAUSED")).toBe(true);
  });

  it("dashboard FE talks only to API; bots_manage has no DATABASE_URL", () => {
    const botsManageEnvExample = readFileSync(
      resolve("../milox_bots_manage/.env.example"),
      "utf8",
    );
    expect(botsManageEnvExample).toContain("NEXT_PUBLIC_API_URL");
    expect(botsManageEnvExample).toMatch(/Never put production DATABASE_URL/i);
    expect(botsManageEnvExample).not.toMatch(/^DATABASE_URL=/m);

    const botsPage = readFileSync(
      resolve("../milox_bots_manage/src/app/(console)/bots/page.tsx"),
      "utf8",
    );
    expect(botsPage).toContain("Refresh");
    expect(botsPage).toContain("consumeBotsListStale");
    expect(botsPage).toContain("PAGE_SIZE = 50");
    expect(botsPage).toContain("clampOffsetToTotal");

    const candidatesPage = readFileSync(
      resolve("../milox_bots_manage/src/app/(console)/candidates/page.tsx"),
      "utf8",
    );
    expect(candidatesPage).toContain("markBotsListStale");
    expect(candidatesPage).toContain("/bots?refresh=1");
  });
});
