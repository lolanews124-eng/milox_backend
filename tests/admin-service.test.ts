import { UserStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AdminUserRecord } from "../src/modules/admin/application/admin-view.js";
import {
  AdminHierarchyError,
  type AdminRepository,
} from "../src/modules/admin/application/ports/admin-repository.js";
import { AdminService } from "../src/modules/admin/application/services/admin-service.js";

const actorId = "fca0622f-cba7-4398-bfe7-11842c026990";
const targetId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";

describe("AdminService", () => {
  it("normalizes user search and returns offset metadata", async () => {
    const repository = createRepository();
    vi.mocked(repository.listUsers).mockResolvedValue({
      items: [userFixture()],
      total: 26,
    });

    const result = (await new AdminService(repository).listUsers({
      q: "  Person@Example.COM ",
      status: UserStatus.ACTIVE,
      page: 2,
      pageSize: 25,
    })) as { totalPages: number };

    expect(repository.listUsers).toHaveBeenCalledWith({
      q: "person@example.com",
      status: UserStatus.ACTIVE,
      page: 2,
      pageSize: 25,
    });
    expect(result.totalPages).toBe(2);
  });

  it("requires a reason for suspension and ban", async () => {
    const repository = createRepository();
    await expect(
      new AdminService(repository).changeUserStatus(actorId, targetId, {
        status: UserStatus.BANNED,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    expect(repository.changeUserStatus).not.toHaveBeenCalled();
  });

  it("maps hierarchy failures without exposing target details", async () => {
    const repository = createRepository();
    vi.mocked(repository.changeUserStatus).mockRejectedValue(
      new AdminHierarchyError(),
    );

    await expect(
      new AdminService(repository).changeUserStatus(actorId, targetId, {
        status: UserStatus.SUSPENDED,
        reason: "Safety review",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("normalizes report action codes and notes", async () => {
    const repository = createRepository();
    vi.mocked(repository.resolveReport).mockResolvedValue({
      id: "98ea1ca9-5f22-4207-8659-3db6e5d54861",
      reporterId: targetId,
      targetType: "USER",
      reportedUserId: targetId,
      postId: null,
      commentId: null,
      messageId: null,
      reasonCode: "HARASSMENT",
      details: null,
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolverNote: "Reviewed",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await new AdminService(repository).resolveReport(
      actorId,
      "98ea1ca9-5f22-4207-8659-3db6e5d54861",
      {
        resolution: "resolved",
        actionCode: " user_warned ",
        note: " Reviewed ",
      },
    );

    expect(repository.resolveReport).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        actionCode: "USER_WARNED",
        note: "Reviewed",
      }),
    );
  });
});

function createRepository(): AdminRepository {
  return {
    dashboard: vi.fn(),
    listUsers: vi.fn(),
    getUserById: vi.fn(),
    listUserModerationHistory: vi.fn(),
    changeUserStatus: vi.fn(),
    listReports: vi.fn(),
    resolveReport: vi.fn(),
    listPosts: vi.fn(),
    updatePostVisibility: vi.fn(),
    deletePost: vi.fn(),
    listComments: vi.fn(),
    updateCommentVisibility: vi.fn(),
    deleteComment: vi.fn(),
    listAuditLogs: vi.fn(),
    listStaff: vi.fn(),
    changeStaffRole: vi.fn(),
    setVerifiedBadge: vi.fn(),
    listInterestTags: vi.fn(),
    createInterestTag: vi.fn(),
    updateInterestTag: vi.fn(),
    listPremiumPlans: vi.fn(),
    createPremiumPlan: vi.fn(),
    updatePremiumPlan: vi.fn(),
    listSubscriptions: vi.fn(),
    grantSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    listAds: vi.fn(),
    createAd: vi.fn(),
    updateAd: vi.fn(),
    deleteAd: vi.fn(),
    listCmsPages: vi.fn(),
    createCmsPage: vi.fn(),
    updateCmsPage: vi.fn(),
    analytics: vi.fn(),
    listMatches: vi.fn(),
    listMedia: vi.fn(),
    getMediaContent: vi.fn(),
    updateMedia: vi.fn(),
    listOutboxEvents: vi.fn(),
    retryOutboxEvent: vi.fn(),
    listEmailJobs: vi.fn(),
    retryEmailJob: vi.fn(),
    listHashtags: vi.fn(),
    deleteHashtag: vi.fn(),
  };
}

function userFixture(): AdminUserRecord {
  return {
    id: targetId,
    username: "person",
    email: "person@example.com",
    emailVerifiedAt: new Date(),
    displayName: null,
    role: "USER",
    status: "ACTIVE",
    isVerifiedBadge: false,
    country: null,
    followerCount: 1,
    followingCount: 2,
    postCount: 3,
    lastLoginAt: null,
    bannedAt: null,
    banReason: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}
