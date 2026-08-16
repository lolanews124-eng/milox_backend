import type { ReportStatus, UserRole, UserStatus } from "@prisma/client";
import { unlink } from "node:fs/promises";
import path from "node:path";

import { AppError } from "../../../../shared/errors/app-error.js";
import {
  AdminHierarchyError,
  AdminSelfActionError,
  AdminStateConflictError,
  type AdminRepository,
  type CreatePremiumPlanData,
  type UpdatePremiumPlanData,
} from "../ports/admin-repository.js";
import {
  presentAdminAuditLog,
  presentAdminComment,
  presentAdminCommentsStats,
  presentAdminInterestTag,
  presentAdminModerationAction,
  presentAdminPost,
  presentAdminPostsStats,
  presentAdminStory,
  presentAdminStoriesStats,
  presentAdminPremiumPlan,
  presentAdminAd,
  presentAdminAdPlacementConfig,
  presentAdminAnalytics,
  presentAdminCmsPage,
  presentAdminBlogPost,
  presentAdminEmailJob,
  presentAdminHashtag,
  presentAdminMatch,
  presentAdminMatchesStats,
  presentAdminReferral,
  presentAdminReferralCodeLookup,
  presentAdminReferralLeaderboard,
  presentAdminReferralsStats,
  presentAdminConversation,
  presentAdminConversationsStats,
  presentAdminConversationMessage,
  presentAdminMedia,
  presentAdminOutboxEvent,
  presentAdminSubscription,
  presentAdminReport,
  presentAdminUser,
  presentAdminUserDetail,
  presentAdminUsersStats,
  presentAdminVerificationStats,
  presentAdminWalletAdjustResult,
  presentAdminWalletStats,
  presentAdminWalletTransaction,
  presentAdminWalletUser,
  presentAdminPointPurchaseRate,
} from "../admin-view.js";
import { presentMobileAppConfig } from "../../../app-release/mobile-app-config.js";
import { InsufficientWalletBalanceError } from "../../../rewards/application/ports/rewards-repository.js";
import { notifyIndexNow } from "../../../../infrastructure/indexnow.js";

export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly uploadRoot: string,
  ) {}

  dashboard(): ReturnType<AdminRepository["dashboard"]> {
    return this.repository.dashboard(new Date());
  }

  async usersStats(): Promise<object> {
    const stats = await this.repository.usersStats(new Date());
    return presentAdminUsersStats(stats);
  }

  async verificationStats(): Promise<object> {
    const stats = await this.repository.verificationStats();
    return presentAdminVerificationStats(stats);
  }

  async listUsers(options: {
    q?: string | undefined;
    status?: UserStatus | undefined;
    verified?: boolean | undefined;
    online?: boolean | undefined;
    reported?: boolean | undefined;
    emailVerified?: boolean | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listUsers({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.q ? { q: options.q.trim().toLowerCase() } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.verified !== undefined ? { verified: options.verified } : {}),
      ...(options.online ? { online: true } : {}),
      ...(options.reported ? { reported: true } : {}),
      ...(options.emailVerified !== undefined ? { emailVerified: options.emailVerified } : {}),
    });
    return {
      items: result.items.map(presentAdminUser),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async exportUserEmails(options: {
    actorId: string;
    audience: "active" | "inactive";
    inactiveDays: number;
    emailVerified?: boolean | undefined;
  }): Promise<{
    csv: string;
    count: number;
    truncated: boolean;
    filename: string;
  }> {
    const result = await this.repository.exportUserEmails({
      actorId: options.actorId,
      audience: options.audience,
      inactiveDays: options.inactiveDays,
      ...(options.emailVerified !== undefined
        ? { emailVerified: options.emailVerified }
        : {}),
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const audiencePart =
      options.audience === "inactive"
        ? `inactive-${options.inactiveDays}d`
        : "active";
    return {
      ...result,
      filename: `milox-emails-${audiencePart}-${stamp}.csv`,
    };
  }

  async getUser(userId: string): Promise<object> {
    const user = await this.repository.getUserById(userId);
    if (!user) {
      throw new AppError("ADMIN_USER_NOT_FOUND", "User not found", 404);
    }
    return presentAdminUserDetail(user);
  }

  async listUserModerationHistory(
    userId: string,
    options: { page: number; pageSize: number },
  ): Promise<object> {
    const user = await this.repository.getUserById(userId);
    if (!user) {
      throw new AppError("ADMIN_USER_NOT_FOUND", "User not found", 404);
    }
    const result = await this.repository.listUserModerationHistory(userId, {
      page: options.page,
      pageSize: options.pageSize,
    });
    return {
      items: result.items.map(presentAdminModerationAction),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async changeUserStatus(
    actorId: string,
    targetUserId: string,
    input: { status: UserStatus; reason?: string | undefined },
  ): Promise<object> {
    const reason = input.reason?.trim() || null;
    if (input.status !== "ACTIVE" && !reason) {
      throw new AppError(
        "VALIDATION_ERROR",
        "A reason is required when suspending or banning a user",
        400,
      );
    }
    try {
      const user = await this.repository.changeUserStatus({
        actorId,
        targetUserId,
        status: input.status,
        reason,
      });
      if (!user) {
        throw new AppError(
          "ADMIN_USER_NOT_FOUND",
          "User not found",
          404,
        );
      }
      return presentAdminUser(user);
    } catch (error) {
      if (error instanceof AdminSelfActionError) {
        throw new AppError(
          "CANNOT_MODERATE_SELF",
          "Staff cannot change their own status",
          422,
        );
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError(
          "FORBIDDEN",
          "Insufficient moderation authority",
          403,
        );
      }
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Resource is already in the requested or final state",
          409,
        );
      }
      throw error;
    }
  }

  async listReports(options: {
    status?: ReportStatus | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listReports({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.status ? { status: options.status } : {}),
    });
    return {
      items: result.items.map(presentAdminReport),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async resolveReport(
    actorId: string,
    reportId: string,
    input: {
      resolution: "resolved" | "dismissed";
      actionCode?: string | undefined;
      note?: string | undefined;
    },
  ): Promise<object> {
    try {
      const report = await this.repository.resolveReport({
        actorId,
        reportId,
        resolution: input.resolution,
        actionCode: input.actionCode?.trim().toUpperCase() || null,
        note: input.note?.trim() || null,
      });
      if (!report) {
        throw new AppError(
          "ADMIN_REPORT_NOT_FOUND",
          "Report not found",
          404,
        );
      }
      return presentAdminReport(report);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError(
          "FORBIDDEN",
          "Insufficient moderation authority",
          403,
        );
      }
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Report has already reached a final state",
          409,
        );
      }
      throw error;
    }
  }

  async listPosts(options: {
    q?: string | undefined;
    hidden?: boolean | undefined;
    includeDeleted?: boolean | undefined;
    bucket?: "all" | "reported" | "pending" | "hidden" | "removed" | undefined;
    mediaKind?: "image" | "video" | "text" | "audio" | undefined;
    createdFrom?: Date | undefined;
    createdTo?: Date | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listPosts({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.q ? { q: options.q.trim().toLowerCase() } : {}),
      ...(options.hidden !== undefined ? { hidden: options.hidden } : {}),
      ...(options.includeDeleted ? { includeDeleted: true } : {}),
      ...(options.bucket ? { bucket: options.bucket } : {}),
      ...(options.mediaKind ? { mediaKind: options.mediaKind } : {}),
      ...(options.createdFrom ? { createdFrom: options.createdFrom } : {}),
      ...(options.createdTo ? { createdTo: options.createdTo } : {}),
    });
    return {
      items: result.items.map(presentAdminPost),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async postsStats(): Promise<object> {
    const stats = await this.repository.postsStats();
    return presentAdminPostsStats(stats);
  }

  async updatePostVisibility(
    actorId: string,
    postId: string,
    input: { isHidden: boolean; note?: string | undefined },
  ): Promise<object> {
    try {
      const post = await this.repository.updatePostVisibility({
        actorId,
        postId,
        isHidden: input.isHidden,
        note: input.note?.trim() || null,
      });
      if (!post) {
        throw new AppError("ADMIN_POST_NOT_FOUND", "Post not found", 404);
      }
      return presentAdminPost(post);
    } catch (error) {
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Post is already in the requested state",
          409,
        );
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError(
          "FORBIDDEN",
          "Insufficient moderation authority",
          403,
        );
      }
      throw error;
    }
  }

  async deletePost(
    actorId: string,
    postId: string,
    input: { note?: string | undefined },
  ): Promise<object> {
    try {
      const post = await this.repository.deletePost({
        actorId,
        postId,
        note: input.note?.trim() || null,
      });
      if (!post) {
        throw new AppError("ADMIN_POST_NOT_FOUND", "Post not found", 404);
      }
      return presentAdminPost(post);
    } catch (error) {
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Post has already been deleted",
          409,
        );
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError(
          "FORBIDDEN",
          "Insufficient moderation authority",
          403,
        );
      }
      throw error;
    }
  }

  async listStories(options: {
    q?: string | undefined;
    bucket?: "all" | "active" | "expired" | "removed" | undefined;
    createdFrom?: Date | undefined;
    createdTo?: Date | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listStories({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.q ? { q: options.q.trim().toLowerCase() } : {}),
      ...(options.bucket ? { bucket: options.bucket } : {}),
      ...(options.createdFrom ? { createdFrom: options.createdFrom } : {}),
      ...(options.createdTo ? { createdTo: options.createdTo } : {}),
    });
    return {
      items: result.items.map(presentAdminStory),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async storiesStats(): Promise<object> {
    const stats = await this.repository.storiesStats(new Date());
    return presentAdminStoriesStats(stats);
  }

  async deleteStory(
    actorId: string,
    storyId: string,
    input: { note?: string | undefined },
  ): Promise<object> {
    try {
      const story = await this.repository.deleteStory({
        actorId,
        storyId,
        note: input.note?.trim() || null,
      });
      if (!story) {
        throw new AppError("ADMIN_STORY_NOT_FOUND", "Story not found", 404);
      }
      return presentAdminStory(story);
    } catch (error) {
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Story has already been removed",
          409,
        );
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError(
          "FORBIDDEN",
          "Insufficient moderation authority",
          403,
        );
      }
      throw error;
    }
  }

  async listComments(options: {
    q?: string | undefined;
    postId?: string | undefined;
    hidden?: boolean | undefined;
    includeDeleted?: boolean | undefined;
    bucket?: "all" | "reported" | "hidden" | "removed" | "replies" | undefined;
    createdFrom?: Date | undefined;
    createdTo?: Date | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listComments({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.q ? { q: options.q.trim().toLowerCase() } : {}),
      ...(options.postId ? { postId: options.postId } : {}),
      ...(options.hidden !== undefined ? { hidden: options.hidden } : {}),
      ...(options.includeDeleted ? { includeDeleted: true } : {}),
      ...(options.bucket ? { bucket: options.bucket } : {}),
      ...(options.createdFrom ? { createdFrom: options.createdFrom } : {}),
      ...(options.createdTo ? { createdTo: options.createdTo } : {}),
    });
    return {
      items: result.items.map(presentAdminComment),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async commentsStats(): Promise<object> {
    const stats = await this.repository.commentsStats();
    return presentAdminCommentsStats(stats);
  }

  async updateCommentVisibility(
    actorId: string,
    commentId: string,
    input: { isHidden: boolean; note?: string | undefined },
  ): Promise<object> {
    try {
      const comment = await this.repository.updateCommentVisibility({
        actorId,
        commentId,
        isHidden: input.isHidden,
        note: input.note?.trim() || null,
      });
      if (!comment) {
        throw new AppError("ADMIN_COMMENT_NOT_FOUND", "Comment not found", 404);
      }
      return presentAdminComment(comment);
    } catch (error) {
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Comment is already in the requested state",
          409,
        );
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient moderation authority", 403);
      }
      throw error;
    }
  }

  async deleteComment(
    actorId: string,
    commentId: string,
    input: { note?: string | undefined },
  ): Promise<object> {
    try {
      const comment = await this.repository.deleteComment({
        actorId,
        commentId,
        note: input.note?.trim() || null,
      });
      if (!comment) {
        throw new AppError("ADMIN_COMMENT_NOT_FOUND", "Comment not found", 404);
      }
      return presentAdminComment(comment);
    } catch (error) {
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Comment has already been deleted",
          409,
        );
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient moderation authority", 403);
      }
      throw error;
    }
  }

  async listAuditLogs(options: {
    action?: string | undefined;
    resourceType?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listAuditLogs({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.action ? { action: options.action.trim() } : {}),
      ...(options.resourceType ? { resourceType: options.resourceType.trim() } : {}),
    });
    return {
      items: result.items.map(presentAdminAuditLog),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async listStaff(options: { page: number; pageSize: number }): Promise<object> {
    const result = await this.repository.listStaff(options);
    return {
      items: result.items.map(presentAdminUser),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async changeStaffRole(
    actorId: string,
    targetUserId: string,
    input: { role: UserRole },
  ): Promise<object> {
    try {
      const user = await this.repository.changeStaffRole({
        actorId,
        targetUserId,
        role: input.role,
      });
      if (!user) {
        throw new AppError("ADMIN_USER_NOT_FOUND", "User not found", 404);
      }
      return presentAdminUser(user);
    } catch (error) {
      if (error instanceof AdminSelfActionError) {
        throw new AppError(
          "CANNOT_MODERATE_SELF",
          "Staff cannot change their own role",
          422,
        );
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient staff authority", 403);
      }
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "User already has the requested role",
          409,
        );
      }
      throw error;
    }
  }

  async setVerifiedBadge(
    actorId: string,
    targetUserId: string,
    input: { isVerifiedBadge: boolean },
  ): Promise<object> {
    try {
      const user = await this.repository.setVerifiedBadge({
        actorId,
        targetUserId,
        isVerifiedBadge: input.isVerifiedBadge,
      });
      if (!user) {
        throw new AppError("ADMIN_USER_NOT_FOUND", "User not found", 404);
      }
      return presentAdminUser(user);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient moderation authority", 403);
      }
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Verified badge is already in the requested state",
          409,
        );
      }
      throw error;
    }
  }

  async listInterestTags(options: {
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listInterestTags(options);
    return {
      items: result.items.map(presentAdminInterestTag),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async createInterestTag(
    actorId: string,
    input: { label: string; slug?: string | undefined },
  ): Promise<object> {
    const label = input.label.trim();
    const slug =
      input.slug?.trim().toLowerCase() ??
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    try {
      const tag = await this.repository.createInterestTag({
        actorId,
        label,
        slug,
      });
      return presentAdminInterestTag(tag);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient moderation authority", 403);
      }
      throw error;
    }
  }

  async updateInterestTag(
    actorId: string,
    tagId: string,
    input: { label?: string | undefined; isActive?: boolean | undefined },
  ): Promise<object> {
    try {
      const tag = await this.repository.updateInterestTag({
        actorId,
        tagId,
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      });
      if (!tag) {
        throw new AppError("ADMIN_TAG_NOT_FOUND", "Interest tag not found", 404);
      }
      return presentAdminInterestTag(tag);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient moderation authority", 403);
      }
      throw error;
    }
  }

  async getAnalytics(): Promise<object> {
    const data = await this.repository.analytics(new Date());
    return presentAdminAnalytics(data);
  }

  async listPremiumPlans(options: { page: number; pageSize: number }): Promise<object> {
    const result = await this.repository.listPremiumPlans(options);
    return paginate(result, options, presentAdminPremiumPlan);
  }

  async createPremiumPlan(actorId: string, input: Record<string, unknown>): Promise<object> {
    return this.createPremiumPlanFromInput(actorId, input as Omit<CreatePremiumPlanData, "actorId">);
  }

  private async createPremiumPlanFromInput(
    actorId: string,
    input: Omit<CreatePremiumPlanData, "actorId">,
  ): Promise<object> {
    try {
      const plan = await this.repository.createPremiumPlan({
        actorId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        description: input.description?.trim() ?? null,
        priceCents: input.priceCents,
        currency: input.currency.toUpperCase(),
        durationDays: input.durationDays,
        ...(input.tier !== undefined ? { tier: input.tier } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.badgeLabel !== undefined ? { badgeLabel: input.badgeLabel } : {}),
        ...(input.adsFree !== undefined ? { adsFree: input.adsFree } : {}),
        ...(input.houseAdsFree !== undefined ? { houseAdsFree: input.houseAdsFree } : {}),
        ...(input.profileViews !== undefined ? { profileViews: input.profileViews } : {}),
        ...(input.discoverBoost !== undefined ? { discoverBoost: input.discoverBoost } : {}),
        ...(input.grantVerifiedBadge !== undefined
          ? { grantVerifiedBadge: input.grantVerifiedBadge }
          : {}),
        ...(input.dailyInterestLimit !== undefined
          ? { dailyInterestLimit: input.dailyInterestLimit }
          : {}),
        ...(input.interstitialAdsFree !== undefined
          ? { interstitialAdsFree: input.interstitialAdsFree }
          : {}),
        ...(input.directMessageEnabled !== undefined
          ? { directMessageEnabled: input.directMessageEnabled }
          : {}),
        ...(input.prices !== undefined ? { prices: input.prices } : {}),
      });
      return presentAdminPremiumPlan(plan);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async updatePremiumPlan(
    actorId: string,
    planId: string,
    input: Record<string, unknown>,
  ): Promise<object> {
    return this.updatePremiumPlanFromInput(
      actorId,
      planId,
      input as Omit<UpdatePremiumPlanData, "actorId" | "planId">,
    );
  }

  private async updatePremiumPlanFromInput(
    actorId: string,
    planId: string,
    input: Omit<UpdatePremiumPlanData, "actorId" | "planId">,
  ): Promise<object> {
    try {
      const plan = await this.repository.updatePremiumPlan({
        actorId,
        planId,
        ...input,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      });
      if (!plan) throw new AppError("ADMIN_PLAN_NOT_FOUND", "Plan not found", 404);
      return presentAdminPremiumPlan(plan);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async listSubscriptions(options: {
    status?: string | undefined;
    userId?: string | undefined;
    q?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listSubscriptions({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.status ? { status: options.status } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.q ? { q: options.q } : {}),
    });
    return paginate(result, options, presentAdminSubscription);
  }

  async grantSubscription(
    actorId: string,
    input: { userId: string; planId: string; billingCycle?: string },
  ): Promise<object> {
    try {
      const sub = await this.repository.grantSubscription({
        actorId,
        userId: input.userId,
        planId: input.planId,
        ...(input.billingCycle
          ? {
              billingCycle: input.billingCycle as
                | "MONTHLY"
                | "YEARLY"
                | "ONE_TIME",
            }
          : {}),
      });
      return presentAdminSubscription(sub);
    } catch (error) {
      if (error instanceof AdminStateConflictError) {
        throw new AppError("ADMIN_STATE_CONFLICT", "User or plan not available", 409);
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async cancelSubscription(actorId: string, subscriptionId: string): Promise<object> {
    try {
      const sub = await this.repository.cancelSubscription({ actorId, subscriptionId });
      if (!sub) throw new AppError("ADMIN_SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
      return presentAdminSubscription(sub);
    } catch (error) {
      if (error instanceof AdminStateConflictError) {
        throw new AppError("ADMIN_STATE_CONFLICT", "Subscription is not active", 409);
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async listAds(options: {
    page: number;
    pageSize: number;
    placement?: string | undefined;
    isActive?: boolean | undefined;
  }): Promise<object> {
    const result = await this.repository.listAds({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.placement ? { placement: options.placement } : {}),
      ...(options.isActive !== undefined ? { isActive: options.isActive } : {}),
    });
    return paginate(result, options, presentAdminAd);
  }

  async createAd(actorId: string, input: object): Promise<object> {
    try {
      const ad = await this.repository.createAd({ actorId, ...(input as CreateAdInput) });
      return presentAdminAd(ad);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async updateAd(actorId: string, adId: string, input: object): Promise<object> {
    try {
      const ad = await this.repository.updateAd({ actorId, adId, ...(input as UpdateAdInput) });
      if (!ad) throw new AppError("ADMIN_AD_NOT_FOUND", "Ad not found", 404);
      return presentAdminAd(ad);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async deleteAd(actorId: string, adId: string): Promise<object> {
    try {
      const ad = await this.repository.deleteAd(actorId, adId);
      if (!ad) throw new AppError("ADMIN_AD_NOT_FOUND", "Ad not found", 404);
      return presentAdminAd(ad);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async listAdPlacementConfigs(): Promise<object> {
    const configs = await this.repository.listAdPlacementConfigs();
    return { items: configs.map(presentAdminAdPlacementConfig) };
  }

  async updateAdPlacementConfig(
    actorId: string,
    placement: string,
    input: {
      label?: string | undefined;
      description?: string | null | undefined;
      isEnabled?: boolean | undefined;
      insertEvery?: number | undefined;
    },
  ): Promise<object> {
    try {
      const config = await this.repository.updateAdPlacementConfig({
        actorId,
        placement,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
        ...(input.insertEvery !== undefined ? { insertEvery: input.insertEvery } : {}),
      });
      if (!config) {
        throw new AppError("NOT_FOUND", "Ad placement not found", 404);
      }
      return presentAdminAdPlacementConfig(config);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async getMobileAppConfig(): Promise<object> {
    const config = await this.repository.getMobileAppConfig();
    return presentMobileAppConfig(config);
  }

  async updateMobileAppConfig(
    actorId: string,
    input: {
      latestVersion?: string | undefined;
      androidMinBuild?: number | undefined;
      iosMinBuild?: number | undefined;
      forceUpdate?: boolean | undefined;
      androidStoreUrl?: string | undefined;
      iosStoreUrl?: string | undefined;
      title?: string | undefined;
      message?: string | undefined;
    },
  ): Promise<object> {
    try {
      const config = await this.repository.updateMobileAppConfig({
        actorId,
        ...input,
      });
      return presentMobileAppConfig(config);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async listCmsPages(options: { page: number; pageSize: number }): Promise<object> {
    const result = await this.repository.listCmsPages(options);
    return paginate(result, options, presentAdminCmsPage);
  }

  async createCmsPage(
    actorId: string,
    input: { slug: string; title: string; bodyMarkdown: string; status?: string | undefined },
  ): Promise<object> {
    try {
      const page = await this.repository.createCmsPage({
        actorId,
        slug: input.slug,
        title: input.title.trim(),
        bodyMarkdown: input.bodyMarkdown,
        ...(input.status ? { status: input.status } : {}),
      });
      return presentAdminCmsPage(page);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async updateCmsPage(
    actorId: string,
    pageId: string,
    input: { title?: string | undefined; bodyMarkdown?: string | undefined; status?: string | undefined },
  ): Promise<object> {
    try {
      const page = await this.repository.updateCmsPage({
        actorId,
        pageId,
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.bodyMarkdown !== undefined ? { bodyMarkdown: input.bodyMarkdown } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
      if (!page) throw new AppError("ADMIN_CMS_NOT_FOUND", "CMS page not found", 404);
      return presentAdminCmsPage(page);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async listBlogPosts(options: {
    page: number;
    pageSize: number;
    status?: string | undefined;
  }): Promise<object> {
    const result = await this.repository.listBlogPosts({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.status !== undefined ? { status: options.status } : {}),
    });
    return paginate(result, options, presentAdminBlogPost);
  }

  async createBlogPost(
    actorId: string,
    input: {
      slug: string;
      title: string;
      excerpt?: string | null | undefined;
      bodyMarkdown: string;
      coverImageUrl?: string | null | undefined;
      metaDescription?: string | null | undefined;
      status?: string | undefined;
    },
  ): Promise<object> {
    try {
      const post = await this.repository.createBlogPost({
        actorId,
        slug: input.slug,
        title: input.title.trim(),
        bodyMarkdown: input.bodyMarkdown,
        excerpt: input.excerpt ?? null,
        coverImageUrl: input.coverImageUrl ?? null,
        metaDescription: input.metaDescription ?? null,
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
      if (post.status === "PUBLISHED") {
        void notifyIndexNow(["/blog", `/blog/${post.slug}`, "/sitemap.xml"]);
      }
      return presentAdminBlogPost(post);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async updateBlogPost(
    actorId: string,
    postId: string,
    input: {
      slug?: string | undefined;
      title?: string | undefined;
      excerpt?: string | null | undefined;
      bodyMarkdown?: string | undefined;
      coverImageUrl?: string | null | undefined;
      metaDescription?: string | null | undefined;
      status?: string | undefined;
    },
  ): Promise<object> {
    try {
      const post = await this.repository.updateBlogPost({
        actorId,
        postId,
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
        ...(input.bodyMarkdown !== undefined ? { bodyMarkdown: input.bodyMarkdown } : {}),
        ...(input.coverImageUrl !== undefined ? { coverImageUrl: input.coverImageUrl } : {}),
        ...(input.metaDescription !== undefined
          ? { metaDescription: input.metaDescription }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
      if (!post) throw new AppError("NOT_FOUND", "Blog post not found", 404);
      if (post.status === "PUBLISHED") {
        void notifyIndexNow(["/blog", `/blog/${post.slug}`, "/sitemap.xml"]);
      }
      return presentAdminBlogPost(post);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async listMatches(options: {
    status?: string | undefined;
    userId?: string | undefined;
    q?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listMatches({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.status ? { status: options.status } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.q ? { q: options.q.trim().toLowerCase() } : {}),
    });
    return paginate(result, options, presentAdminMatch);
  }

  async matchesStats(): Promise<object> {
    const stats = await this.repository.matchesStats(new Date());
    return presentAdminMatchesStats(stats);
  }

  async referralsStats(): Promise<object> {
    const stats = await this.repository.referralsStats(new Date());
    return presentAdminReferralsStats(stats);
  }

  async listReferrals(options: {
    q?: string | undefined;
    referrerUserId?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listReferrals({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.q ? { q: options.q.trim() } : {}),
      ...(options.referrerUserId ? { referrerUserId: options.referrerUserId } : {}),
    });
    return paginate(result, options, presentAdminReferral);
  }

  async listReferralLeaderboard(options: {
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listReferralLeaderboard({
      page: options.page,
      pageSize: options.pageSize,
    });
    return paginate(result, options, presentAdminReferralLeaderboard);
  }

  async lookupReferralCode(code: string): Promise<object> {
    const row = await this.repository.lookupReferralCode(code);
    if (!row) {
      throw new AppError("NOT_FOUND", "Referral code not found", 404);
    }
    return presentAdminReferralCodeLookup(row);
  }

  async listConversations(options: {
    q?: string | undefined;
    bucket?: "all" | "active" | "closed" | "reported" | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listConversations({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.q ? { q: options.q.trim().toLowerCase() } : {}),
      ...(options.bucket ? { bucket: options.bucket } : {}),
    });
    return {
      items: result.items.map(presentAdminConversation),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async conversationsStats(): Promise<object> {
    const stats = await this.repository.conversationsStats(new Date());
    return presentAdminConversationsStats(stats);
  }

  async listConversationMessages(
    conversationId: string,
    options: { page: number; pageSize: number },
  ): Promise<object> {
    const result = await this.repository.listConversationMessages(
      conversationId,
      options,
    );
    return {
      items: result.items.map(presentAdminConversationMessage),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
  }

  async deleteMessageForEveryone(
    actorId: string,
    messageId: string,
    input: { note?: string | undefined },
  ): Promise<object> {
    try {
      const message = await this.repository.deleteMessageForEveryone({
        actorId,
        messageId,
        note: input.note?.trim() || null,
      });
      if (!message) {
        throw new AppError("ADMIN_MESSAGE_NOT_FOUND", "Message not found", 404);
      }
      return presentAdminConversationMessage(message);
    } catch (error) {
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Message has already been removed",
          409,
        );
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError(
          "FORBIDDEN",
          "Insufficient moderation authority",
          403,
        );
      }
      throw error;
    }
  }

  async listMedia(options: {
    kind?: string | undefined;
    visibility?: string | undefined;
    ownerUserId?: string | undefined;
    includeDeleted?: boolean | undefined;
    q?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listMedia({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.visibility ? { visibility: options.visibility } : {}),
      ...(options.ownerUserId ? { ownerUserId: options.ownerUserId } : {}),
      ...(options.includeDeleted !== undefined
        ? { includeDeleted: options.includeDeleted }
        : {}),
      ...(options.q ? { q: options.q.trim().toLowerCase() } : {}),
    });
    return paginate(result, options, presentAdminMedia);
  }

  async getMediaContent(mediaId: string): Promise<{
    storageKey: string;
    mimeType: string;
    checksumSha256: string | null;
  }> {
    const media = await this.repository.getMediaContent(mediaId);
    if (!media) {
      throw new AppError("ADMIN_MEDIA_NOT_FOUND", "Media not found", 404);
    }
    return media;
  }

  async updateMedia(
    actorId: string,
    mediaId: string,
    input: { deleted: boolean; purgeStorage?: boolean },
  ): Promise<object> {
    try {
      const result = await this.repository.updateMedia({
        actorId,
        mediaId,
        deleted: input.deleted,
        purgeStorage: Boolean(input.deleted && input.purgeStorage),
      });
      if (!result) {
        throw new AppError("ADMIN_MEDIA_NOT_FOUND", "Media not found", 404);
      }
      if (result.purgedStorage && result.storageKey) {
        await unlinkMediaFile(this.uploadRoot, result.storageKey);
      }
      return presentAdminMedia(result.media);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async listOutboxEvents(options: {
    status?: string | undefined;
    eventType?: string | undefined;
    aggregateType?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listOutboxEvents({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.status ? { status: options.status } : {}),
      ...(options.eventType ? { eventType: options.eventType } : {}),
      ...(options.aggregateType ? { aggregateType: options.aggregateType } : {}),
    });
    return paginate(result, options, presentAdminOutboxEvent);
  }

  async retryOutboxEvent(actorId: string, eventId: string): Promise<object> {
    try {
      const event = await this.repository.retryOutboxEvent(actorId, eventId);
      if (!event) {
        throw new AppError("ADMIN_OUTBOX_NOT_FOUND", "Outbox event not found", 404);
      }
      return presentAdminOutboxEvent(event);
    } catch (error) {
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Processed events cannot be retried",
          409,
        );
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async listEmailJobs(options: {
    status?: string | undefined;
    type?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listEmailJobs({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.status ? { status: options.status } : {}),
      ...(options.type ? { type: options.type } : {}),
    });
    return paginate(result, options, presentAdminEmailJob);
  }

  async retryEmailJob(actorId: string, jobId: string): Promise<object> {
    try {
      const job = await this.repository.retryEmailJob(actorId, jobId);
      if (!job) {
        throw new AppError("ADMIN_EMAIL_JOB_NOT_FOUND", "Email job not found", 404);
      }
      return presentAdminEmailJob(job);
    } catch (error) {
      if (error instanceof AdminStateConflictError) {
        throw new AppError(
          "ADMIN_STATE_CONFLICT",
          "Sent email jobs cannot be retried",
          409,
        );
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async listHashtags(options: {
    q?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listHashtags({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.q ? { q: options.q.trim().toLowerCase() } : {}),
    });
    return paginate(result, options, presentAdminHashtag);
  }

  async deleteHashtag(actorId: string, hashtagId: string): Promise<object> {
    try {
      const tag = await this.repository.deleteHashtag(actorId, hashtagId);
      if (!tag) {
        throw new AppError("ADMIN_HASHTAG_NOT_FOUND", "Hashtag not found", 404);
      }
      return presentAdminHashtag(tag);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async walletStats(): Promise<object> {
    return presentAdminWalletStats(await this.repository.walletStats());
  }

  async getWalletUser(userId: string): Promise<object> {
    const user = await this.repository.getWalletUser(userId);
    if (!user) {
      throw new AppError("NOT_FOUND", "User wallet not found", 404);
    }
    return presentAdminWalletUser(user);
  }

  async lookupWalletUser(query: string): Promise<object> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new AppError("VALIDATION_ERROR", "Search query is required", 400);
    }
    if (isUuid(trimmed)) {
      return this.getWalletUser(trimmed);
    }
    const needle = trimmed.toLowerCase();
    const result = await this.repository.listUsers({
      q: needle,
      page: 1,
      pageSize: 10,
    });
    const match =
      result.items.find(
        (user) =>
          user.username.toLowerCase() === needle ||
          user.email.toLowerCase() === needle,
      ) ?? result.items[0];
    if (!match) {
      throw new AppError("NOT_FOUND", "User not found", 404);
    }
    return this.getWalletUser(match.id);
  }

  async adjustWallet(
    actorId: string,
    input: {
      userId?: string | undefined;
      username?: string | undefined;
      points: number;
      direction: "credit" | "debit";
      note?: string | undefined;
    },
  ): Promise<object> {
    const userId = await this.resolveWalletUserId(input);
    try {
      const result = await this.repository.adjustWallet({
        actorId,
        userId,
        points: input.points,
        direction: input.direction,
        ...(input.note ? { note: input.note.trim() } : {}),
      });
      return presentAdminWalletAdjustResult(result);
    } catch (error) {
      if (error instanceof InsufficientWalletBalanceError) {
        throw new AppError(
          "INSUFFICIENT_WALLET_BALANCE",
          "User does not have enough points to deduct",
          409,
        );
      }
      if (error instanceof AdminStateConflictError) {
        throw new AppError("NOT_FOUND", "User not found", 404);
      }
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async listWalletTransactions(options: {
    q?: string | undefined;
    userId?: string | undefined;
    type?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listWalletTransactions({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.q ? { q: options.q.trim() } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.type ? { type: options.type as import("@prisma/client").WalletTransactionType } : {}),
    });
    return paginate(result, options, presentAdminWalletTransaction);
  }

  async listPointPurchaseRates(options: {
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listPointPurchaseRates(options);
    return paginate(result, options, presentAdminPointPurchaseRate);
  }

  async createPointPurchaseRate(
    actorId: string,
    input: {
      currency: string;
      amountMinor: number;
      points: number;
      label?: string | null | undefined;
      isActive?: boolean | undefined;
      sortOrder?: number | undefined;
    },
  ): Promise<object> {
    try {
      const rate = await this.repository.createPointPurchaseRate({
        actorId,
        currency: "USD",
        amountMinor: input.amountMinor,
        points: input.points,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      });
      return presentAdminPointPurchaseRate(rate);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  async updatePointPurchaseRate(
    actorId: string,
    rateId: string,
    input: {
      currency?: string | undefined;
      amountMinor?: number | undefined;
      points?: number | undefined;
      label?: string | null | undefined;
      isActive?: boolean | undefined;
      sortOrder?: number | undefined;
    },
  ): Promise<object> {
    try {
      const rate = await this.repository.updatePointPurchaseRate({
        actorId,
        rateId,
        currency: "USD",
        ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
        ...(input.points !== undefined ? { points: input.points } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      });
      if (!rate) {
        throw new AppError("NOT_FOUND", "Point purchase rate not found", 404);
      }
      return presentAdminPointPurchaseRate(rate);
    } catch (error) {
      if (error instanceof AdminHierarchyError) {
        throw new AppError("FORBIDDEN", "Insufficient authority", 403);
      }
      throw error;
    }
  }

  private async resolveWalletUserId(input: {
    userId?: string | undefined;
    username?: string | undefined;
  }): Promise<string> {
    if (input.userId) {
      const user = await this.repository.getWalletUser(input.userId);
      if (!user) {
        throw new AppError("NOT_FOUND", "User not found", 404);
      }
      return input.userId;
    }
    if (input.username) {
      const normalized = input.username.trim().toLowerCase();
      const result = await this.repository.listUsers({
        q: normalized,
        page: 1,
        pageSize: 10,
      });
      const match =
        result.items.find((user) => user.username.toLowerCase() === normalized) ??
        result.items[0];
      if (!match) {
        throw new AppError("NOT_FOUND", "User not found", 404);
      }
      return match.id;
    }
    throw new AppError(
      "VALIDATION_ERROR",
      "userId or username is required",
      400,
    );
  }
}

type CreateAdInput = {
  title: string;
  body?: string | null;
  imageUrl?: string | null;
  targetUrl?: string | null;
  ctaLabel?: string | null;
  placement: string;
  priority?: number;
  insertEvery?: number | null;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

type UpdateAdInput = Partial<CreateAdInput>;

function paginate<T>(
  result: { items: T[]; total: number },
  options: { page: number; pageSize: number },
  present: (item: T) => object,
) {
  return {
    items: result.items.map(present),
    total: result.total,
    page: options.page,
    pageSize: options.pageSize,
    totalPages: Math.ceil(result.total / options.pageSize),
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function unlinkMediaFile(uploadRoot: string, storageKey: string): Promise<void> {
  const root = path.resolve(uploadRoot);
  const absolutePath = path.resolve(root, storageKey);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    return;
  }
  await unlink(absolutePath).catch(() => undefined);
}
