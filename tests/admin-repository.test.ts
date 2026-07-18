import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AdminHierarchyError } from "../src/modules/admin/application/ports/admin-repository.js";
import { PrismaAdminRepository } from "../src/modules/admin/infrastructure/prisma-admin-repository.js";

const actorId = "fca0622f-cba7-4398-bfe7-11842c026990";
const targetId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";

describe("PrismaAdminRepository", () => {
  it("atomically changes status, revokes sessions, and writes audit rows", async () => {
    const transaction = createTransaction({
      actor: { id: actorId, role: "ADMIN" },
      target: { id: targetId, role: "USER", status: "ACTIVE" },
    });
    const database = callbackDatabase(transaction);

    const result = await new PrismaAdminRepository(database).changeUserStatus({
      actorId,
      targetUserId: targetId,
      status: "BANNED",
      reason: "Repeated harassment",
    });

    expect(result?.status).toBe("BANNED");
    expect(transaction.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(transaction.moderationAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId,
        targetUserId: targetId,
        actionCode: "USER_BANNED",
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "admin.user.status_changed",
        resourceId: targetId,
      }),
    });
  });

  it("prevents staff from moderating an equal role", async () => {
    const transaction = createTransaction({
      actor: { id: actorId, role: "ADMIN" },
      target: { id: targetId, role: "ADMIN", status: "ACTIVE" },
    });
    const database = callbackDatabase(transaction);

    await expect(
      new PrismaAdminRepository(database).changeUserStatus({
        actorId,
        targetUserId: targetId,
        status: "SUSPENDED",
        reason: "Review",
      }),
    ).rejects.toBeInstanceOf(AdminHierarchyError);
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });
});

function createTransaction(input: {
  actor: { id: string; role: "ADMIN" };
  target: {
    id: string;
    role: "USER" | "ADMIN";
    status: "ACTIVE";
  };
}) {
  return {
    user: {
      findFirst: vi.fn().mockResolvedValue(input.actor),
      findUnique: vi.fn().mockResolvedValue(input.target),
      update: vi.fn().mockResolvedValue({
        id: targetId,
        username: "person",
        email: "person@example.com",
        emailVerifiedAt: new Date(),
        displayName: null,
        role: input.target.role,
        status: "BANNED",
        isVerifiedBadge: false,
        followerCount: 0,
        followingCount: 0,
        postCount: 0,
        lastLoginAt: null,
        bannedAt: new Date(),
        banReason: "Repeated harassment",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    refreshSession: {
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    moderationAction: {
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function callbackDatabase(transaction: ReturnType<typeof createTransaction>) {
  return {
    $transaction: vi.fn(
      (callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
    ),
  } as unknown as PrismaClient;
}
