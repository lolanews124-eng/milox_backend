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

describe("admin UGC review HTTP contract", () => {
  it("lists pending UGC for moderation staff", async () => {
    const harness = createHarness(true);
    vi.mocked(harness.service.listPendingUgc).mockResolvedValue({
      totals: { posts: 1, comments: 0, bios: 0 },
      posts: [],
      comments: [],
      bios: [],
      limit: 50,
      offset: 0,
    });

    const response = await request(harness.app).get(
      "/api/v1/admin/ugc-reviews",
    );

    expect(response.status).toBe(200);
    expect(response.body.data.totals.posts).toBe(1);
    expect(harness.service.listPendingUgc).toHaveBeenCalled();
  });

  it("rejects unauthorized staff for UGC list", async () => {
    const harness = createHarness(false);
    const response = await request(harness.app).get(
      "/api/v1/admin/ugc-reviews",
    );
    expect(response.status).toBe(403);
    expect(harness.service.listPendingUgc).not.toHaveBeenCalled();
  });

  it("resolves UGC with actor id and refuses invalid action", async () => {
    const harness = createHarness(true);
    vi.mocked(harness.service.resolveUgcReview).mockResolvedValue({
      ok: true,
      state: "APPROVED",
    });

    const ok = await request(harness.app)
      .post("/api/v1/admin/ugc-reviews/resolve")
      .send({
        resourceType: "post",
        resourceId: "11111111-1111-1111-1111-111111111111",
        action: "approve",
      });
    expect(ok.status).toBe(200);
    expect(harness.service.resolveUgcReview).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({ action: "approve", resourceType: "post" }),
    );

    const bad = await request(harness.app)
      .post("/api/v1/admin/ugc-reviews/resolve")
      .send({
        resourceType: "post",
        resourceId: "11111111-1111-1111-1111-111111111111",
        action: "self_approve",
      });
    expect(bad.status).toBe(400);
  });
});

function createHarness(currentRoleAllowed: boolean) {
  const serviceObject = {
    dashboard: vi.fn(),
    listUsers: vi.fn(),
    changeUserStatus: vi.fn(),
    listReports: vi.fn(),
    resolveReport: vi.fn(),
    listPendingUgc: vi.fn(),
    resolveUgcReview: vi.fn(),
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
    "../../uploads",
    {} as never,
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
