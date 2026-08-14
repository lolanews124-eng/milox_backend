import type { Request, Response } from "express";
import path from "node:path";
import { MediaKind } from "@prisma/client";

import { AppError } from "../../../shared/errors/app-error.js";
import type { MediaService } from "../../media/application/services/media-service.js";
import type { OfficialChatService } from "../../official-chat/application/official-chat-service.js";
import { officialBroadcastJobStore } from "../../official-chat/application/official-broadcast-job-store.js";
import type { OfficialMessageButton } from "../../official-chat/official-chat-types.js";
import type { AdminService } from "../application/services/admin-service.js";
import {
  adminAdIdParamSchema,
  adminAuditLogQuerySchema,
  adminCmsPageIdParamSchema,
  adminBlogQuerySchema,
  createBlogPostSchema,
  updateBlogPostSchema,
  adminBlogPostIdParamSchema,
  adminEmailJobIdParamSchema,
  adminEmailJobQuerySchema,
  adminHashtagIdParamSchema,
  adminHashtagQuerySchema,
  adminReferralCodeParamSchema,
  adminReferralQuerySchema,
  adminMatchQuerySchema,
  adminConversationQuerySchema,
  adminConversationIdParamSchema,
  adminMessageIdParamSchema,
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
  adminStoryIdParamSchema,
  adminStoryQuerySchema,
  adminReportIdParamSchema,
  adminReportQuerySchema,
  adminSubscriptionIdParamSchema,
  adminSubscriptionQuerySchema,
  adminUserIdParamSchema,
  adminUserQuerySchema,
  broadcastOfficialMessageSchema,
  officialBroadcastJobIdParamSchema,
  changeStaffRoleSchema,
  changeUserStatusSchema,
  createAdSchema,
  adminAdQuerySchema,
  adminAdPlacementParamSchema,
  updateAdPlacementConfigSchema,
  updateMobileAppConfigSchema,
  createCmsPageSchema,
  createInterestTagSchema,
  createPremiumPlanSchema,
  deletePostSchema,
  deleteStorySchema,
  deleteAdminMessageSchema,
  grantSubscriptionSchema,
  adminAdjustWalletSchema,
  adminWalletLookupQuerySchema,
  adminWalletTransactionQuerySchema,
  adminPointPurchaseRateIdParamSchema,
  createPointPurchaseRateSchema,
  updatePointPurchaseRateSchema,
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
    private readonly media: MediaService,
    private readonly officialChat?: OfficialChatService,
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

  verificationStats = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const data = await this.admin.verificationStats();
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

  listStories = async (request: Request, response: Response): Promise<void> => {
    const query = adminStoryQuerySchema.parse(request.query);
    const data = await this.admin.listStories(query);
    response.status(200).json(success(request, data));
  };

  storiesStats = async (request: Request, response: Response): Promise<void> => {
    const data = await this.admin.storiesStats();
    response.status(200).json(success(request, data));
  };

  deleteStory = async (request: Request, response: Response): Promise<void> => {
    const { storyId } = adminStoryIdParamSchema.parse(request.params);
    const input = deleteStorySchema.parse(request.body as unknown);
    const data = await this.admin.deleteStory(
      requireUser(request),
      storyId,
      input,
    );
    response.status(200).json(success(request, data));
  };

  listComments = async (request: Request, response: Response): Promise<void> => {
    const query = adminCommentQuerySchema.parse(request.query);
    const data = await this.admin.listComments(query);
    response.status(200).json(success(request, data));
  };

  commentsStats = async (request: Request, response: Response): Promise<void> => {
    const data = await this.admin.commentsStats();
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

  walletStats = async (request: Request, response: Response): Promise<void> => {
    const data = await this.admin.walletStats();
    response.status(200).json(success(request, data));
  };

  lookupWalletUser = async (request: Request, response: Response): Promise<void> => {
    const { q } = adminWalletLookupQuerySchema.parse(request.query);
    const data = await this.admin.lookupWalletUser(q);
    response.status(200).json(success(request, data));
  };

  getWalletUser = async (request: Request, response: Response): Promise<void> => {
    const { userId } = adminUserIdParamSchema.parse(request.params);
    const data = await this.admin.getWalletUser(userId);
    response.status(200).json(success(request, data));
  };

  adjustWallet = async (request: Request, response: Response): Promise<void> => {
    const input = adminAdjustWalletSchema.parse(request.body as unknown);
    const data = await this.admin.adjustWallet(requireUser(request), input);
    response.status(200).json(success(request, data));
  };

  listWalletTransactions = async (request: Request, response: Response): Promise<void> => {
    const query = adminWalletTransactionQuerySchema.parse(request.query);
    const data = await this.admin.listWalletTransactions(query);
    response.status(200).json(success(request, data));
  };

  listPointPurchaseRates = async (request: Request, response: Response): Promise<void> => {
    const query = adminUserQuerySchema.parse(request.query);
    const data = await this.admin.listPointPurchaseRates(query);
    response.status(200).json(success(request, data));
  };

  createPointPurchaseRate = async (request: Request, response: Response): Promise<void> => {
    const input = createPointPurchaseRateSchema.parse(request.body as unknown);
    const data = await this.admin.createPointPurchaseRate(requireUser(request), input);
    response.status(201).json(success(request, data));
  };

  updatePointPurchaseRate = async (request: Request, response: Response): Promise<void> => {
    const { rateId } = adminPointPurchaseRateIdParamSchema.parse(request.params);
    const input = updatePointPurchaseRateSchema.parse(request.body as unknown);
    const data = await this.admin.updatePointPurchaseRate(requireUser(request), rateId, input);
    response.status(200).json(success(request, data));
  };

  listAds = async (request: Request, response: Response): Promise<void> => {
    const query = adminAdQuerySchema.parse(request.query);
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

  listAdPlacementConfigs = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const data = await this.admin.listAdPlacementConfigs();
    response.status(200).json(success(request, data));
  };

  updateAdPlacementConfig = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { placement } = adminAdPlacementParamSchema.parse(request.params);
    const input = updateAdPlacementConfigSchema.parse(request.body as unknown);
    const data = await this.admin.updateAdPlacementConfig(
      requireUser(request),
      placement,
      input,
    );
    response.status(200).json(success(request, data));
  };

  getMobileAppConfig = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const data = await this.admin.getMobileAppConfig();
    response.status(200).json(success(request, data));
  };

  updateMobileAppConfig = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = updateMobileAppConfigSchema.parse(request.body as unknown);
    const data = await this.admin.updateMobileAppConfig(
      requireUser(request),
      input,
    );
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

  listBlogPosts = async (request: Request, response: Response): Promise<void> => {
    const query = adminBlogQuerySchema.parse(request.query);
    const data = await this.admin.listBlogPosts(query);
    response.status(200).json(success(request, data));
  };

  createBlogPost = async (request: Request, response: Response): Promise<void> => {
    const input = createBlogPostSchema.parse(request.body as unknown);
    const data = await this.admin.createBlogPost(requireUser(request), input);
    response.status(201).json(success(request, data));
  };

  updateBlogPost = async (request: Request, response: Response): Promise<void> => {
    const { postId } = adminBlogPostIdParamSchema.parse(request.params);
    const input = updateBlogPostSchema.parse(request.body as unknown);
    const data = await this.admin.updateBlogPost(requireUser(request), postId, input);
    response.status(200).json(success(request, data));
  };

  uploadBlogImage = async (request: Request, response: Response): Promise<void> => {
    if (!request.file) {
      throw new AppError("VALIDATION_ERROR", "Image file is required", 400, [
        { field: "file", issue: "required" },
      ]);
    }
    const actor = requireUser(request);
    const asset = (await this.media.uploadImage(
      actor,
      MediaKind.POST_IMAGE,
      request.file.buffer,
    )) as { id: string; url: string | null; mimeType: string; width: number | null; height: number | null };
    if (!asset.url) {
      throw new AppError("INTERNAL_ERROR", "Uploaded image has no public URL", 500);
    }
    response.status(201).json(
      success(request, {
        id: asset.id,
        url: asset.url,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      }),
    );
  };

  listMatches = async (request: Request, response: Response): Promise<void> => {
    const query = adminMatchQuerySchema.parse(request.query);
    const data = await this.admin.listMatches(query);
    response.status(200).json(success(request, data));
  };

  matchesStats = async (request: Request, response: Response): Promise<void> => {
    const data = await this.admin.matchesStats();
    response.status(200).json(success(request, data));
  };

  referralsStats = async (request: Request, response: Response): Promise<void> => {
    const data = await this.admin.referralsStats();
    response.status(200).json(success(request, data));
  };

  listReferrals = async (request: Request, response: Response): Promise<void> => {
    const query = adminReferralQuerySchema.parse(request.query);
    const data = await this.admin.listReferrals(query);
    response.status(200).json(success(request, data));
  };

  listReferralLeaderboard = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = adminReferralQuerySchema
      .pick({ page: true, pageSize: true })
      .parse(request.query);
    const data = await this.admin.listReferralLeaderboard(query);
    response.status(200).json(success(request, data));
  };

  lookupReferralCode = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { code } = adminReferralCodeParamSchema.parse(request.params);
    const data = await this.admin.lookupReferralCode(code);
    response.status(200).json(success(request, data));
  };

  listConversations = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = adminConversationQuerySchema.parse(request.query);
    const data = await this.admin.listConversations(query);
    response.status(200).json(success(request, data));
  };

  conversationsStats = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const data = await this.admin.conversationsStats();
    response.status(200).json(success(request, data));
  };

  listConversationMessages = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { conversationId } = adminConversationIdParamSchema.parse(
      request.params,
    );
    const query = adminConversationQuerySchema
      .pick({ page: true, pageSize: true })
      .parse(request.query);
    const data = await this.admin.listConversationMessages(
      conversationId,
      query,
    );
    response.status(200).json(success(request, data));
  };

  deleteMessage = async (request: Request, response: Response): Promise<void> => {
    const { messageId } = adminMessageIdParamSchema.parse(request.params);
    const input = deleteAdminMessageSchema.parse(request.body as unknown);
    const data = await this.admin.deleteMessageForEveryone(
      requireUser(request),
      messageId,
      input,
    );
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
    const data = await this.admin.updateMedia(requireUser(request), mediaId, {
      deleted: input.deleted,
      purgeStorage: input.purgeStorage,
    });
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

  broadcastOfficialMessage = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    if (!this.officialChat) {
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "Official messaging is not configured",
        503,
      );
    }
    const input = broadcastOfficialMessageSchema.parse(request.body);
    const buttons = input.buttons?.map(
      (button): OfficialMessageButton => ({
        label: button.label,
        action:
          button.actionType === "OPEN_URL"
            ? { type: "OPEN_URL", url: button.url! }
            : { type: "NAVIGATE", route: button.route! },
      }),
    );
    const payload = {
      body: input.body,
      ...(buttons?.length ? { buttons } : {}),
      ...(input.mediaId ? { mediaId: input.mediaId } : {}),
    };

    const total = await this.officialChat.countBroadcastRecipients();
    if (total === 0) {
      throw new AppError(
        "NO_RECIPIENTS",
        "No active user accounts are available to receive this message",
        400,
      );
    }

    const job = officialBroadcastJobStore.create(total);

    void this.officialChat
      .broadcast(payload)
      .then((result) => {
        if (result.sent === 0 && result.failed > 0) {
          officialBroadcastJobStore.fail(
            job.id,
            "Could not deliver the official message to any users",
          );
          return;
        }
        const message =
          result.failed > 0
            ? `Delivered to ${result.sent} of ${result.total} users (${result.failed} failed)`
            : `Delivered to all ${result.sent} active users`;
        officialBroadcastJobStore.complete(job.id, result, message);
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : "Official message broadcast failed";
        officialBroadcastJobStore.fail(job.id, message);
        console.error("Official message broadcast job failed", {
          jobId: job.id,
          error,
        });
      });

    response.status(202).json(
      success(request, {
        jobId: job.id,
        status: job.status,
        sent: job.sent,
        failed: job.failed,
        total: job.total,
        message: `Broadcast started for ${total} users. Delivery continues in the background.`,
      }),
    );
  };

  getOfficialBroadcastJob = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { jobId } = officialBroadcastJobIdParamSchema.parse(request.params);
    const job = officialBroadcastJobStore.get(jobId);
    if (!job) {
      throw new AppError("NOT_FOUND", "Broadcast job not found or expired", 404);
    }
    response.status(200).json(success(request, job));
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
