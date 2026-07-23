import type { Request, Response } from "express";
import path from "node:path";

import { AppError } from "../../../shared/errors/app-error.js";
import type { AdminService } from "../application/services/admin-service.js";
import {
  adminAdIdParamSchema,
  adminAuditLogQuerySchema,
  adminCmsPageIdParamSchema,
  adminEmailJobIdParamSchema,
  adminEmailJobQuerySchema,
  adminHashtagIdParamSchema,
  adminHashtagQuerySchema,
  adminMatchQuerySchema,
  adminMediaIdParamSchema,
  adminMediaQuerySchema,
  adminOutboxEventIdParamSchema,
  adminOutboxQuerySchema,
  adminCommentIdParamSchema,
  adminCommentQuerySchema,
  adminInterestTagIdParamSchema,
  adminPlanIdParamSchema,
  adminPostIdParamSchema,
  adminPostQuerySchema,
  adminReportIdParamSchema,
  adminReportQuerySchema,
  adminSubscriptionIdParamSchema,
  adminSubscriptionQuerySchema,
  adminUserIdParamSchema,
  adminUserQuerySchema,
  changeStaffRoleSchema,
  changeUserStatusSchema,
  createAdSchema,
  createCmsPageSchema,
  createInterestTagSchema,
  createPremiumPlanSchema,
  deletePostSchema,
  grantSubscriptionSchema,
  resolveReportSchema,
  setVerifiedBadgeSchema,
  updateAdSchema,
  updateCmsPageSchema,
  updateInterestTagSchema,
  updateMediaSchema,
  updatePremiumPlanSchema,
  updatePostVisibilitySchema,
} from "./admin-schemas.js";

export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly uploadRoot: string,
  ) {}

  dashboard = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const data = await this.admin.dashboard();
    response.status(200).json(success(request, data));
  };

  listUsers = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = adminUserQuerySchema.parse(request.query);
    const data = await this.admin.listUsers(query);
    response.status(200).json(success(request, data));
  };

  usersStats = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const data = await this.admin.usersStats();
    response.status(200).json(success(request, data));
  };

  getUser = async (request: Request, response: Response): Promise<void> => {
    const { userId } = adminUserIdParamSchema.parse(request.params);
    const data = await this.admin.getUser(userId);
    response.status(200).json(success(request, data));
  };

  listUserModerationHistory = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { userId } = adminUserIdParamSchema.parse(request.params);
    const query = adminUserQuerySchema.parse(request.query);
    const data = await this.admin.listUserModerationHistory(userId, query);
    response.status(200).json(success(request, data));
  };

  changeUserStatus = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { userId } = adminUserIdParamSchema.parse(request.params);
    const input = changeUserStatusSchema.parse(request.body as unknown);
    const data = await this.admin.changeUserStatus(
      requireUser(request),
      userId,
      input,
    );
    response.status(200).json(success(request, data));
  };

  listReports = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = adminReportQuerySchema.parse(request.query);
    const data = await this.admin.listReports(query);
    response.status(200).json(success(request, data));
  };

  resolveReport = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { reportId } = adminReportIdParamSchema.parse(request.params);
    const input = resolveReportSchema.parse(request.body as unknown);
    const data = await this.admin.resolveReport(
      requireUser(request),
      reportId,
      input,
    );
    response.status(200).json(success(request, data));
  };

  listPosts = async (request: Request, response: Response): Promise<void> => {
    const query = adminPostQuerySchema.parse(request.query);
    const data = await this.admin.listPosts(query);
    response.status(200).json(success(request, data));
  };

  postsStats = async (request: Request, response: Response): Promise<void> => {
    const data = await this.admin.postsStats();
    response.status(200).json(success(request, data));
  };

  updatePostVisibility = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { postId } = adminPostIdParamSchema.parse(request.params);
    const input = updatePostVisibilitySchema.parse(request.body as unknown);
    const data = await this.admin.updatePostVisibility(
      requireUser(request),
      postId,
      input,
    );
    response.status(200).json(success(request, data));
  };

  deletePost = async (request: Request, response: Response): Promise<void> => {
    const { postId } = adminPostIdParamSchema.parse(request.params);
    const input = deletePostSchema.parse(request.body as unknown);
    const data = await this.admin.deletePost(
      requireUser(request),
      postId,
      input,
    );
    response.status(200).json(success(request, data));
  };

  listComments = async (request: Request, response: Response): Promise<void> => {
    const query = adminCommentQuerySchema.parse(request.query);
    const data = await this.admin.listComments(query);
    response.status(200).json(success(request, data));
  };

  updateCommentVisibility = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { commentId } = adminCommentIdParamSchema.parse(request.params);
    const input = updatePostVisibilitySchema.parse(request.body as unknown);
    const data = await this.admin.updateCommentVisibility(
      requireUser(request),
      commentId,
      input,
    );
    response.status(200).json(success(request, data));
  };

  deleteComment = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { commentId } = adminCommentIdParamSchema.parse(request.params);
    const input = deletePostSchema.parse(request.body as unknown);
    const data = await this.admin.deleteComment(
      requireUser(request),
      commentId,
      input,
    );
    response.status(200).json(success(request, data));
  };

  listAuditLogs = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = adminAuditLogQuerySchema.parse(request.query);
    const data = await this.admin.listAuditLogs(query);
    response.status(200).json(success(request, data));
  };

  listStaff = async (request: Request, response: Response): Promise<void> => {
    const query = adminUserQuerySchema.parse(request.query);
    const data = await this.admin.listStaff(query);
    response.status(200).json(success(request, data));
  };

  changeStaffRole = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { userId } = adminUserIdParamSchema.parse(request.params);
    const input = changeStaffRoleSchema.parse(request.body as unknown);
    const data = await this.admin.changeStaffRole(
      requireUser(request),
      userId,
      input,
    );
    response.status(200).json(success(request, data));
  };

  setVerifiedBadge = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { userId } = adminUserIdParamSchema.parse(request.params);
    const input = setVerifiedBadgeSchema.parse(request.body as unknown);
    const data = await this.admin.setVerifiedBadge(
      requireUser(request),
      userId,
      input,
    );
    response.status(200).json(success(request, data));
  };

  listInterestTags = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = adminUserQuerySchema.parse(request.query);
    const data = await this.admin.listInterestTags(query);
    response.status(200).json(success(request, data));
  };

  createInterestTag = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = createInterestTagSchema.parse(request.body as unknown);
    const data = await this.admin.createInterestTag(requireUser(request), input);
    response.status(201).json(success(request, data));
  };

  updateInterestTag = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { tagId } = adminInterestTagIdParamSchema.parse(request.params);
    const input = updateInterestTagSchema.parse(request.body as unknown);
    const data = await this.admin.updateInterestTag(
      requireUser(request),
      tagId,
      input,
    );
    response.status(200).json(success(request, data));
  };

  getAnalytics = async (request: Request, response: Response): Promise<void> => {
    const data = await this.admin.getAnalytics();
    response.status(200).json(success(request, data));
  };

  listPremiumPlans = async (request: Request, response: Response): Promise<void> => {
    const query = adminUserQuerySchema.parse(request.query);
    const data = await this.admin.listPremiumPlans(query);
    response.status(200).json(success(request, data));
  };

  createPremiumPlan = async (request: Request, response: Response): Promise<void> => {
    const input = createPremiumPlanSchema.parse(request.body as unknown);
    const data = await this.admin.createPremiumPlan(requireUser(request), input);
    response.status(201).json(success(request, data));
  };

  updatePremiumPlan = async (request: Request, response: Response): Promise<void> => {
    const { planId } = adminPlanIdParamSchema.parse(request.params);
    const input = updatePremiumPlanSchema.parse(request.body as unknown);
    const data = await this.admin.updatePremiumPlan(requireUser(request), planId, input);
    response.status(200).json(success(request, data));
  };

  listSubscriptions = async (request: Request, response: Response): Promise<void> => {
    const query = adminSubscriptionQuerySchema.parse(request.query);
    const data = await this.admin.listSubscriptions(query);
    response.status(200).json(success(request, data));
  };

  grantSubscription = async (request: Request, response: Response): Promise<void> => {
    const input = grantSubscriptionSchema.parse(request.body as unknown);
    const data = await this.admin.grantSubscription(requireUser(request), input);
    response.status(201).json(success(request, data));
  };

  cancelSubscription = async (request: Request, response: Response): Promise<void> => {
    const { subscriptionId } = adminSubscriptionIdParamSchema.parse(request.params);
    const data = await this.admin.cancelSubscription(requireUser(request), subscriptionId);
    response.status(200).json(success(request, data));
  };

  listAds = async (request: Request, response: Response): Promise<void> => {
    const query = adminUserQuerySchema.parse(request.query);
    const data = await this.admin.listAds(query);
    response.status(200).json(success(request, data));
  };

  createAd = async (request: Request, response: Response): Promise<void> => {
    const input = createAdSchema.parse(request.body as unknown);
    const data = await this.admin.createAd(requireUser(request), input);
    response.status(201).json(success(request, data));
  };

  updateAd = async (request: Request, response: Response): Promise<void> => {
    const { adId } = adminAdIdParamSchema.parse(request.params);
    const input = updateAdSchema.parse(request.body as unknown);
    const data = await this.admin.updateAd(requireUser(request), adId, input);
    response.status(200).json(success(request, data));
  };

  deleteAd = async (request: Request, response: Response): Promise<void> => {
    const { adId } = adminAdIdParamSchema.parse(request.params);
    const data = await this.admin.deleteAd(requireUser(request), adId);
    response.status(200).json(success(request, data));
  };

  listCmsPages = async (request: Request, response: Response): Promise<void> => {
    const query = adminUserQuerySchema.parse(request.query);
    const data = await this.admin.listCmsPages(query);
    response.status(200).json(success(request, data));
  };

  createCmsPage = async (request: Request, response: Response): Promise<void> => {
    const input = createCmsPageSchema.parse(request.body as unknown);
    const data = await this.admin.createCmsPage(requireUser(request), input);
    response.status(201).json(success(request, data));
  };

  updateCmsPage = async (request: Request, response: Response): Promise<void> => {
    const { pageId } = adminCmsPageIdParamSchema.parse(request.params);
    const input = updateCmsPageSchema.parse(request.body as unknown);
    const data = await this.admin.updateCmsPage(requireUser(request), pageId, input);
    response.status(200).json(success(request, data));
  };

  listMatches = async (request: Request, response: Response): Promise<void> => {
    const query = adminMatchQuerySchema.parse(request.query);
    const data = await this.admin.listMatches(query);
    response.status(200).json(success(request, data));
  };

  listMedia = async (request: Request, response: Response): Promise<void> => {
    const query = adminMediaQuerySchema.parse(request.query);
    const data = await this.admin.listMedia(query);
    response.status(200).json(success(request, data));
  };

  getMediaContent = async (request: Request, response: Response): Promise<void> => {
    const { mediaId } = adminMediaIdParamSchema.parse(request.params);
    const media = await this.admin.getMediaContent(mediaId);
    const root = path.resolve(this.uploadRoot);
    const absolutePath = path.resolve(root, media.storageKey);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) {
      throw new AppError("ADMIN_MEDIA_NOT_FOUND", "Media not found", 404);
    }
    response.type(media.mimeType);
    response.setHeader("Cache-Control", "private, no-store");
    if (media.checksumSha256) {
      response.setHeader("ETag", `"${media.checksumSha256}"`);
    }
    await new Promise<void>((resolve, reject) => {
      response.sendFile(absolutePath, (error) => {
        if (error) {
          reject(new AppError("ADMIN_MEDIA_NOT_FOUND", "Media not found", 404));
          return;
        }
        resolve();
      });
    });
  };

  updateMedia = async (request: Request, response: Response): Promise<void> => {
    const { mediaId } = adminMediaIdParamSchema.parse(request.params);
    const input = updateMediaSchema.parse(request.body as unknown);
    const data = await this.admin.updateMedia(requireUser(request), mediaId, input);
    response.status(200).json(success(request, data));
  };

  listOutboxEvents = async (request: Request, response: Response): Promise<void> => {
    const query = adminOutboxQuerySchema.parse(request.query);
    const data = await this.admin.listOutboxEvents(query);
    response.status(200).json(success(request, data));
  };

  retryOutboxEvent = async (request: Request, response: Response): Promise<void> => {
    const { eventId } = adminOutboxEventIdParamSchema.parse(request.params);
    const data = await this.admin.retryOutboxEvent(requireUser(request), eventId);
    response.status(200).json(success(request, data));
  };

  listEmailJobs = async (request: Request, response: Response): Promise<void> => {
    const query = adminEmailJobQuerySchema.parse(request.query);
    const data = await this.admin.listEmailJobs(query);
    response.status(200).json(success(request, data));
  };

  retryEmailJob = async (request: Request, response: Response): Promise<void> => {
    const { jobId } = adminEmailJobIdParamSchema.parse(request.params);
    const data = await this.admin.retryEmailJob(requireUser(request), jobId);
    response.status(200).json(success(request, data));
  };

  listHashtags = async (request: Request, response: Response): Promise<void> => {
    const query = adminHashtagQuerySchema.parse(request.query);
    const data = await this.admin.listHashtags(query);
    response.status(200).json(success(request, data));
  };

  deleteHashtag = async (request: Request, response: Response): Promise<void> => {
    const { hashtagId } = adminHashtagIdParamSchema.parse(request.params);
    const data = await this.admin.deleteHashtag(requireUser(request), hashtagId);
    response.status(200).json(success(request, data));
  };
}

function requireUser(request: Request): string {
  if (!request.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }
  return request.auth.userId;
}

function success(request: Request, data: object) {
  return {
    success: true,
    data,
    meta: { requestId: request.requestId },
  };
}
