import { UserStatus, type PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { INACTIVE_SUSPENSION_REASON } from "../src/modules/users/application/inactive-account-policy.js";
import {
  describeDatabaseTarget,
  INACTIVE_RESTORED_AUDIT_ACTION,
  INACTIVE_SUSPENDED_AUDIT_ACTION,
  runInactiveAccountRestore,
} from "../src/modules/users/application/inactive-account-restore.js";

const now = new Date("2026-04-15T00:00:00.000Z");
const suspendedAt = new Date("2026-04-01T00:00:00.000Z");
const USER_ID = "11111111-1111-1111-1111-111111111111";
const AUDIT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function inactiveAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AUDIT_ID,
    resourceId: USER_ID,
    createdAt: suspendedAt,
    metadata: {
      username: "idleuser",
      reason: INACTIVE_SUSPENSION_REASON,
      policyVersion: "inactivity_v1",
      previousStatus: "ACTIVE",
      newStatus: "SUSPENDED",
    },
    ...overrides,
  };
}

function suspendedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    username: "idleuser",
    status: UserStatus.SUSPENDED,
    banReason: INACTIVE_SUSPENSION_REASON,
    bannedAt: suspendedAt,
    deletedAt: null,
    role: "USER",
    isSystemAccount: false,
    isAutomatedAccount: false,
    ...overrides,
  };
}

describe("runInactiveAccountRestore", () => {
  let database: {
    $queryRaw: ReturnType<typeof vi.fn>;
    user: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    auditLog: {
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    moderationAction: { findMany: ReturnType<typeof vi.fn> };
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
        updateMany: vi.fn(),
      },
      auditLog: {
        findMany: vi.fn(),
        create: vi.fn().mockResolvedValue({}),
      },
      moderationAction: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn(),
    };
    database.$transaction.mockImplementation(
      async (fn: (tx: typeof database) => Promise<unknown>) => fn(database),
    );
  });

  function mockEligibleLookups(options?: {
    restoreAudit?: { createdAt: Date } | null;
    adminChange?: { resourceId: string; createdAt: Date } | null;
  }) {
    database.user.findMany
      .mockResolvedValueOnce([suspendedUser()])
      .mockResolvedValueOnce([]);
    database.auditLog.findMany.mockImplementation(
      async (args: { where?: { action?: string } }) => {
        const action = args.where?.action;
        if (action === INACTIVE_SUSPENDED_AUDIT_ACTION) {
          return [inactiveAuditRow()];
        }
        if (action === INACTIVE_RESTORED_AUDIT_ACTION) {
          return options?.restoreAudit
            ? [
                {
                  id: "restore-audit",
                  resourceId: USER_ID,
                  createdAt: options.restoreAudit.createdAt,
                  metadata: {},
                },
              ]
            : [];
        }
        if (action === "admin.user.status_changed") {
          return options?.adminChange ? [options.adminChange] : [];
        }
        return [];
      },
    );
  }

  it("dry-run reports eligible inactivity suspensions without writes", async () => {
    mockEligibleLookups();

    const result = await runInactiveAccountRestore(
      database as unknown as PrismaClient,
      { apply: false, now },
    );

    expect(result.mode).toBe("dry-run");
    expect(result.eligible).toBe(1);
    expect(result.restored).toBe(0);
    expect(result.sampleEligible[0]?.username).toBe("idleuser");
    expect(database.user.updateMany).not.toHaveBeenCalled();
    expect(database.auditLog.create).not.toHaveBeenCalled();
  });

  it("apply restores inactivity-suspended users and writes audit", async () => {
    mockEligibleLookups();
    database.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await runInactiveAccountRestore(
      database as unknown as PrismaClient,
      { apply: true, now },
    );

    expect(result.restored).toBe(1);
    expect(database.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: USER_ID,
          status: UserStatus.SUSPENDED,
          banReason: INACTIVE_SUSPENSION_REASON,
        }),
        data: {
          status: UserStatus.ACTIVE,
          banReason: null,
          bannedAt: null,
        },
      }),
    );
    expect(database.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: INACTIVE_RESTORED_AUDIT_ACTION,
          metadata: expect.objectContaining({
            previousBanReason: INACTIVE_SUSPENSION_REASON,
            previousBannedAt: suspendedAt.toISOString(),
            sourceInactiveAuditId: AUDIT_ID,
          }),
        }),
      }),
    );
  });

  it("skips users without an inactivity audit (never status-only)", async () => {
    database.user.findMany
      .mockResolvedValueOnce([suspendedUser()])
      .mockResolvedValueOnce([]);
    database.auditLog.findMany.mockResolvedValue([]);

    const result = await runInactiveAccountRestore(
      database as unknown as PrismaClient,
      { apply: true, now },
    );

    expect(result.eligible).toBe(0);
    expect(result.skipped.no_inactive_audit).toBe(1);
    expect(database.user.updateMany).not.toHaveBeenCalled();
  });

  it("skips manually suspended users (reason mismatch vs audit)", async () => {
    database.user.findMany
      .mockResolvedValueOnce([
        suspendedUser({ banReason: "Repeated harassment" }),
      ])
      .mockResolvedValueOnce([]);
    // Prefilter would normally exclude them; if they appear, mismatch still skips.
    database.auditLog.findMany.mockImplementation(
      async (args: { where?: { action?: string } }) => {
        if (args.where?.action === INACTIVE_SUSPENDED_AUDIT_ACTION) {
          return [inactiveAuditRow()];
        }
        return [];
      },
    );

    const result = await runInactiveAccountRestore(
      database as unknown as PrismaClient,
      { apply: true, now },
    );

    expect(result.skipped.reason_mismatch).toBe(1);
    expect(database.user.updateMany).not.toHaveBeenCalled();
  });

  it("skips when a later admin status change superseded the suspension", async () => {
    mockEligibleLookups({
      adminChange: {
        resourceId: USER_ID,
        createdAt: new Date("2026-04-10T00:00:00.000Z"),
      },
    });

    const result = await runInactiveAccountRestore(
      database as unknown as PrismaClient,
      { apply: true, now },
    );

    expect(result.skipped.superseded_by_admin).toBe(1);
    expect(database.user.updateMany).not.toHaveBeenCalled();
  });

  it("skips already-restored users (idempotent)", async () => {
    mockEligibleLookups({
      restoreAudit: { createdAt: new Date("2026-04-05T00:00:00.000Z") },
    });

    const result = await runInactiveAccountRestore(
      database as unknown as PrismaClient,
      { apply: true, now },
    );

    expect(result.skipped.already_restored).toBe(1);
    expect(database.user.updateMany).not.toHaveBeenCalled();
  });

  it("repeat apply after successful restore is a no-op", async () => {
    // Second run: prefilter finds nobody (already ACTIVE).
    database.user.findMany.mockResolvedValueOnce([]);

    const result = await runInactiveAccountRestore(
      database as unknown as PrismaClient,
      { apply: true, now },
    );

    expect(result.eligible).toBe(0);
    expect(result.restored).toBe(0);
    expect(database.user.updateMany).not.toHaveBeenCalled();
  });

  it("returns early when advisory lock is held", async () => {
    database.$queryRaw = vi.fn().mockResolvedValue([{ locked: false }]);

    const result = await runInactiveAccountRestore(
      database as unknown as PrismaClient,
      { apply: true, now },
    );

    expect(result.lockAcquired).toBe(false);
    expect(database.user.findMany).not.toHaveBeenCalled();
  });

  it("describeDatabaseTarget redacts credentials", () => {
    expect(
      describeDatabaseTarget(
        "postgresql://user:secret@db.example.com:5432/milox_prod",
      ),
    ).toBe("db.example.com:5432/milox_prod");
    expect(describeDatabaseTarget(undefined)).toContain("not set");
  });

  it("prefilters suspended users by inactivity banReason prefix", async () => {
    database.user.findMany.mockResolvedValueOnce([]);
    await runInactiveAccountRestore(database as unknown as PrismaClient, {
      apply: false,
      now,
    });
    expect(database.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: UserStatus.SUSPENDED,
          banReason: {
            startsWith: "Automatic suspension: no qualifying activity for",
          },
        }),
      }),
    );
  });
});
