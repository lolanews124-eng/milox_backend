import { UserRole, UserStatus, type PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { INACTIVE_SUSPENSION_REASON } from "../src/modules/users/application/inactive-account-policy.js";
import { runInactiveAccountSuspension } from "../src/modules/users/application/inactive-account-suspension.js";

const now = new Date("2026-04-01T00:00:00.000Z");
const oldActivity = new Date("2026-01-01T00:00:00.000Z");

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    username: "idleuser",
    lastSeenAt: oldActivity,
    lastLoginAt: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    status: UserStatus.ACTIVE,
    role: UserRole.USER,
    isSystemAccount: false,
    isAutomatedAccount: false,
    deletedAt: null,
    ...overrides,
  };
}

describe("runInactiveAccountSuspension", () => {
  let database: {
    $queryRaw: ReturnType<typeof vi.fn>;
    user: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    refreshSession: { updateMany: ReturnType<typeof vi.fn> };
    auditLog: { create: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    database = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValue([{ locked: true }]),
      user: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      refreshSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(),
    };
    database.$transaction.mockImplementation(
      async (fn: (tx: typeof database) => Promise<unknown>) => fn(database),
    );
  });

  it("dry-run reports eligible accounts without writes", async () => {
    database.user.findMany
      .mockResolvedValueOnce([baseUser()])
      .mockResolvedValueOnce([]);

    const result = await runInactiveAccountSuspension(
      database as unknown as PrismaClient,
      { apply: false, now, skipIndexNow: true },
    );

    expect(result.mode).toBe("dry-run");
    expect(result.eligible).toBe(1);
    expect(result.suspended).toBe(0);
    expect(result.sample[0]?.username).toBe("idleuser");
    expect(database.user.updateMany).not.toHaveBeenCalled();
    expect(database.auditLog.create).not.toHaveBeenCalled();
  });

  it("apply suspends eligible users and revokes sessions", async () => {
    database.user.findMany
      .mockResolvedValueOnce([baseUser()])
      .mockResolvedValueOnce([]);
    database.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await runInactiveAccountSuspension(
      database as unknown as PrismaClient,
      { apply: true, now, skipIndexNow: true },
    );

    expect(result.suspended).toBe(1);
    expect(database.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: UserStatus.SUSPENDED,
          banReason: INACTIVE_SUSPENSION_REASON,
        }),
      }),
    );
    expect(database.refreshSession.updateMany).toHaveBeenCalled();
    expect(database.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "system.user.inactive_suspended",
        }),
      }),
    );
  });

  it("skips staff, system, and bot accounts even if prefilter returned them", async () => {
    database.user.findMany
      .mockResolvedValueOnce([
        baseUser({
          id: "22222222-2222-2222-2222-222222222222",
          username: "adminish",
          role: UserRole.ADMIN,
        }),
        baseUser({
          id: "33333333-3333-3333-3333-333333333333",
          username: "official",
          isSystemAccount: true,
        }),
        baseUser({
          id: "44444444-4444-4444-4444-444444444444",
          username: "botty",
          isAutomatedAccount: true,
        }),
      ])
      .mockResolvedValueOnce([]);

    const result = await runInactiveAccountSuspension(
      database as unknown as PrismaClient,
      { apply: true, now, skipIndexNow: true },
    );

    expect(result.eligible).toBe(0);
    expect(result.skippedNotEligible).toBe(3);
    expect(database.user.updateMany).not.toHaveBeenCalled();
  });

  it("is idempotent when updateMany matches zero rows", async () => {
    database.user.findMany
      .mockResolvedValueOnce([baseUser()])
      .mockResolvedValueOnce([]);
    database.user.updateMany.mockResolvedValue({ count: 0 });
    database.user.findUnique.mockResolvedValue({
      status: UserStatus.SUSPENDED,
    });

    const result = await runInactiveAccountSuspension(
      database as unknown as PrismaClient,
      { apply: true, now, skipIndexNow: true },
    );

    expect(result.suspended).toBe(0);
    expect(result.skippedAlreadyInactive).toBe(1);
  });

  it("returns early when advisory lock is held", async () => {
    database.$queryRaw = vi.fn().mockResolvedValue([{ locked: false }]);

    const result = await runInactiveAccountSuspension(
      database as unknown as PrismaClient,
      { apply: true, now, skipIndexNow: true },
    );

    expect(result.lockAcquired).toBe(false);
    expect(database.user.findMany).not.toHaveBeenCalled();
  });

  it("does not suspend users active within the window", async () => {
    database.user.findMany
      .mockResolvedValueOnce([
        baseUser({
          lastSeenAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          lastLoginAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
        }),
      ])
      .mockResolvedValueOnce([]);

    const result = await runInactiveAccountSuspension(
      database as unknown as PrismaClient,
      { apply: true, now, skipIndexNow: true },
    );

    expect(result.eligible).toBe(0);
    expect(database.user.updateMany).not.toHaveBeenCalled();
  });
});
