import type { ReportStatus, UserRole, UserStatus } from "@prisma/client";

import { AppError } from "../../../../shared/errors/app-error.js";
import {
  AdminHierarchyError,
  AdminSelfActionError,
  AdminStateConflictError,
  type AdminRepository,
} from "../ports/admin-repository.js";
import {
  presentAdminAuditLog,
  presentAdminComment,
  presentAdminInterestTag,
  presentAdminModerationAction,
  presentAdminPost,
  presentAdminPostsStats,
  presentAdminStory,
  presentAdminStoriesStats,
  presentAdminPremiumPlan,
  presentAdminAd,
  presentAdminAnalytics,
  presentAdminCmsPage,
  presentAdminEmailJob,
  presentAdminHashtag,
  presentAdminMatch,
  presentAdminMatchesStats,
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
} from "../admin-view.js";

export class AdminService {
  constructor(private readonly repository: AdminRepository) {}

  dashboard(): ReturnType<AdminRepository["dashboard"]> {
    return this.repository.dashboard(new Date());
  }

  async usersStats(): Promise<object> {
    const stats = await this.repository.usersStats(new Date());
    return presentAdminUsersStats(stats);
  }

  async listUsers(options: {
    q?: string | undefined;
    status?: UserStatus | undefined;
    verified?: boolean | undefined;
    online?: boolean | undefined;
    reported?: boolean | undefined;
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
    });
    return {
      items: result.items.map(presentAdminUser),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
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
    hidden?: boolean | undefined;
    includeDeleted?: boolean | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listComments({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.q ? { q: options.q.trim().toLowerCase() } : {}),
      ...(options.hidden !== undefined ? { hidden: options.hidden } : {}),
      ...(options.includeDeleted ? { includeDeleted: true } : {}),
    });
    return {
      items: result.items.map(presentAdminComment),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: Math.ceil(result.total / options.pageSize),
    };
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

  async createPremiumPlan(
    actorId: string,
    input: {
      code: string;
      name: string;
      description?: string | undefined;
      priceCents: number;
      currency: string;
      durationDays: number;
    },
  ): Promise<object> {
    try {
      const plan = await this.repository.createPremiumPlan({
        actorId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        description: input.description?.trim() || null,
        priceCents: input.priceCents,
        currency: input.currency.toUpperCase(),
        durationDays: input.durationDays,
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
    input: {
      name?: string | undefined;
      description?: string | null | undefined;
      priceCents?: number | undefined;
      durationDays?: number | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<object> {
    try {
      const plan = await this.repository.updatePremiumPlan({
        actorId,
        planId,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
        ...(input.durationDays !== undefined ? { durationDays: input.durationDays } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
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
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listSubscriptions({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.status ? { status: options.status } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
    });
    return paginate(result, options, presentAdminSubscription);
  }

  async grantSubscription(
    actorId: string,
    input: { userId: string; planId: string },
  ): Promise<object> {
    try {
      const sub = await this.repository.grantSubscription({
        actorId,
        userId: input.userId,
        planId: input.planId,
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

  async listAds(options: { page: number; pageSize: number }): Promise<object> {
    const result = await this.repository.listAds(options);
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
    input: { deleted: boolean },
  ): Promise<object> {
    try {
      const media = await this.repository.updateMedia({
        actorId,
        mediaId,
        deleted: input.deleted,
      });
      if (!media) {
        throw new AppError("ADMIN_MEDIA_NOT_FOUND", "Media not found", 404);
      }
      return presentAdminMedia(media);
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
}

type CreateAdInput = {
  title: string;
  body?: string | null;
  imageUrl?: string | null;
  targetUrl?: string | null;
  placement: string;
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
