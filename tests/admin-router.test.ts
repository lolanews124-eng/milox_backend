import type { PrismaClient } from "@prisma/client";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AdminService } from "../src/modules/admin/application/services/admin-service.js";
import { AdminController } from "../src/modules/admin/presentation/admin-controller.js";
import { createAdminRouter } from "../src/modules/admin/presentation/admin-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const actorId = "fca0622f-cba7-4398-bfe7-11842c026990";
const targetId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";

describe("admin HTTP contract", () => {
  it("returns dashboard KPIs to a current database-backed admin", async () => {
    const harness = createHarness(true);
    vi.mocked(harness.service.dashboard).mockResolvedValue({
      totalUsers: 10,
      dailyActiveUsers: 4,
      newUsersToday: 2,
      totalPosts: 20,
      totalComments: 30,
      totalMessages: 40,
      openReports: 3,
      premiumUsers: 1,
      revenueCents: 999,
    });

    const response = await request(harness.app).get(
      "/api/v1/admin/dashboard",
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalUsers: 10,
      openReports: 3,
    });
  });

  it("rejects stale staff claims when the database role is not allowed", async () => {
    const harness = createHarness(false);
    const response = await request(harness.app).get(
      "/api/v1/admin/dashboard",
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(harness.service.dashboard).not.toHaveBeenCalled();
  });

  it("passes the authenticated actor into status moderation", async () => {
    const harness = createHarness(true);
    vi.mocked(harness.service.changeUserStatus).mockResolvedValue({
      id: targetId,
      status: "SUSPENDED",
    });
    const response = await request(harness.app)
      .patch(`/api/v1/admin/users/${targetId}/status`)
      .send({ status: "SUSPENDED", reason: "Safety review" });

    expect(response.status).toBe(200);
    expect(harness.service.changeUserStatus).toHaveBeenCalledWith(
      actorId,
      targetId,
      { status: "SUSPENDED", reason: "Safety review" },
    );
  });

  it("rejects destructive statuses outside the admin contract", async () => {
    const harness = createHarness(true);
    const response = await request(harness.app)
      .patch(`/api/v1/admin/users/${targetId}/status`)
      .send({ status: "DELETED", reason: "No" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(harness.service.changeUserStatus).not.toHaveBeenCalled();
  });
});

function createHarness(currentRoleAllowed: boolean) {
  const serviceObject = {
    dashboard: vi.fn(),
    listUsers: vi.fn(),
    changeUserStatus: vi.fn(),
    listReports: vi.fn(),
    resolveReport: vi.fn(),
  };
  const database = {
    user: {
      findFirst: vi
        .fn()
        .mockResolvedValue(currentRoleAllowed ? { id: actorId } : null),
    },
  } as unknown as PrismaClient;
  const controller = new AdminController(
    serviceObject as unknown as AdminService,
  );
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = {
      userId: actorId,
      role: "ADMIN",
      emailVerified: true,
    };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use(
    "/api/v1/admin",
    createAdminRouter(controller, database, authenticate),
  );
  app.use(errorHandler);
  return { app, service: serviceObject };
}
