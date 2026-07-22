import type { ReportStatus, UserRole, UserStatus } from "@prisma/client";

import type {
  AdminAuditLogRecord,
  AdminCommentRecord,
  AdminDashboardRecord,
  AdminInterestTagRecord,
  AdminModerationActionRecord,
  AdminPostRecord,
  AdminPremiumPlanRecord,
  AdminAdRecord,
  AdminAnalyticsRecord,
  AdminCmsPageRecord,
  AdminEmailJobRecord,
  AdminHashtagRecord,
  AdminMatchRecord,
  AdminMediaContentRecord,
  AdminMediaRecord,
  AdminOutboxEventRecord,
  AdminSubscriptionRecord,
  AdminReportRecord,
  AdminUserDetailRecord,
  AdminUserRecord,
} from "../admin-view.js";

export interface OffsetPage {
  page: number;
  pageSize: number;
}

export interface AdminUserQuery extends OffsetPage {
  q?: string;
  status?: UserStatus;
  verified?: boolean;
}

export interface AdminReportQuery extends OffsetPage {
  status?: ReportStatus;
}

export interface AdminPostQuery extends OffsetPage {
  q?: string;
  hidden?: boolean;
  includeDeleted?: boolean;
}

export interface UpdatePostVisibilityData {
  actorId: string;
  postId: string;
  isHidden: boolean;
  note?: string | null;
}

export interface DeletePostData {
  actorId: string;
  postId: string;
  note?: string | null;
}

export interface AdminCommentQuery extends OffsetPage {
  q?: string;
  hidden?: boolean;
  includeDeleted?: boolean;
}

export interface UpdateCommentVisibilityData {
  actorId: string;
  commentId: string;
  isHidden: boolean;
  note?: string | null;
}

export interface DeleteCommentData {
  actorId: string;
  commentId: string;
  note?: string | null;
}

export interface AdminAuditLogQuery extends OffsetPage {
  action?: string;
  resourceType?: string;
}

export interface CreateInterestTagData {
  actorId: string;
  label: string;
  slug: string;
}

export interface UpdateInterestTagData {
  actorId: string;
  tagId: string;
  label?: string;
  isActive?: boolean;
}

export interface ChangeStaffRoleData {
  actorId: string;
  targetUserId: string;
  role: UserRole;
}

export interface SetVerifiedBadgeData {
  actorId: string;
  targetUserId: string;
  isVerifiedBadge: boolean;
}

export interface CreatePremiumPlanData {
  actorId: string;
  code: string;
  name: string;
  description?: string | null;
  priceCents: number;
  currency: string;
  durationDays: number;
}

export interface UpdatePremiumPlanData {
  actorId: string;
  planId: string;
  name?: string;
  description?: string | null;
  priceCents?: number;
  durationDays?: number;
  isActive?: boolean;
}

export interface AdminSubscriptionQuery extends OffsetPage {
  status?: string;
  userId?: string;
}

export interface GrantSubscriptionData {
  actorId: string;
  userId: string;
  planId: string;
}

export interface CancelSubscriptionData {
  actorId: string;
  subscriptionId: string;
}

export interface CreateAdData {
  actorId: string;
  title: string;
  body?: string | null;
  imageUrl?: string | null;
  targetUrl?: string | null;
  placement: string;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface UpdateAdData {
  actorId: string;
  adId: string;
  title?: string;
  body?: string | null;
  imageUrl?: string | null;
  targetUrl?: string | null;
  placement?: string;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface CreateCmsPageData {
  actorId: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  status?: string;
}

export interface UpdateCmsPageData {
  actorId: string;
  pageId: string;
  title?: string;
  bodyMarkdown?: string;
  status?: string;
}

export interface AdminMatchQuery extends OffsetPage {
  status?: string;
  userId?: string;
  q?: string;
}

export interface AdminMediaQuery extends OffsetPage {
  kind?: string;
  visibility?: string;
  ownerUserId?: string;
  includeDeleted?: boolean;
  q?: string;
}

export interface UpdateMediaData {
  actorId: string;
  mediaId: string;
  deleted: boolean;
}

export interface AdminOutboxQuery extends OffsetPage {
  status?: string;
  eventType?: string;
  aggregateType?: string;
}

export interface AdminEmailJobQuery extends OffsetPage {
  status?: string;
  type?: string;
}

export interface AdminHashtagQuery extends OffsetPage {
  q?: string;
}

export interface AdminPage<T> {
  items: T[];
  total: number;
}

export interface ChangeUserStatusData {
  actorId: string;
  targetUserId: string;
  status: UserStatus;
  reason: string | null;
}

export interface ResolveReportData {
  actorId: string;
  reportId: string;
  resolution: "resolved" | "dismissed";
  actionCode: string | null;
  note: string | null;
}

export class AdminSelfActionError extends Error {}
export class AdminHierarchyError extends Error {}
export class AdminStateConflictError extends Error {}

export interface AdminRepository {
  dashboard(now: Date): Promise<AdminDashboardRecord>;
  listUsers(query: AdminUserQuery): Promise<AdminPage<AdminUserRecord>>;
  getUserById(userId: string): Promise<AdminUserDetailRecord | null>;
  listUserModerationHistory(
    userId: string,
    query: OffsetPage,
  ): Promise<AdminPage<AdminModerationActionRecord>>;
  changeUserStatus(
    data: ChangeUserStatusData,
  ): Promise<AdminUserRecord | null>;
  listReports(
    query: AdminReportQuery,
  ): Promise<AdminPage<AdminReportRecord>>;
  resolveReport(
    data: ResolveReportData,
  ): Promise<AdminReportRecord | null>;
  listPosts(query: AdminPostQuery): Promise<AdminPage<AdminPostRecord>>;
  updatePostVisibility(
    data: UpdatePostVisibilityData,
  ): Promise<AdminPostRecord | null>;
  deletePost(data: DeletePostData): Promise<AdminPostRecord | null>;
  listComments(
    query: AdminCommentQuery,
  ): Promise<AdminPage<AdminCommentRecord>>;
  updateCommentVisibility(
    data: UpdateCommentVisibilityData,
  ): Promise<AdminCommentRecord | null>;
  deleteComment(data: DeleteCommentData): Promise<AdminCommentRecord | null>;
  listAuditLogs(
    query: AdminAuditLogQuery,
  ): Promise<AdminPage<AdminAuditLogRecord>>;
  listStaff(query: OffsetPage): Promise<AdminPage<AdminUserRecord>>;
  changeStaffRole(data: ChangeStaffRoleData): Promise<AdminUserRecord | null>;
  setVerifiedBadge(data: SetVerifiedBadgeData): Promise<AdminUserRecord | null>;
  listInterestTags(query: OffsetPage): Promise<AdminPage<AdminInterestTagRecord>>;
  createInterestTag(
    data: CreateInterestTagData,
  ): Promise<AdminInterestTagRecord>;
  updateInterestTag(
    data: UpdateInterestTagData,
  ): Promise<AdminInterestTagRecord | null>;
  listPremiumPlans(query: OffsetPage): Promise<AdminPage<AdminPremiumPlanRecord>>;
  createPremiumPlan(data: CreatePremiumPlanData): Promise<AdminPremiumPlanRecord>;
  updatePremiumPlan(
    data: UpdatePremiumPlanData,
  ): Promise<AdminPremiumPlanRecord | null>;
  listSubscriptions(
    query: AdminSubscriptionQuery,
  ): Promise<AdminPage<AdminSubscriptionRecord>>;
  grantSubscription(
    data: GrantSubscriptionData,
  ): Promise<AdminSubscriptionRecord>;
  cancelSubscription(
    data: CancelSubscriptionData,
  ): Promise<AdminSubscriptionRecord | null>;
  listAds(query: OffsetPage): Promise<AdminPage<AdminAdRecord>>;
  createAd(data: CreateAdData): Promise<AdminAdRecord>;
  updateAd(data: UpdateAdData): Promise<AdminAdRecord | null>;
  deleteAd(actorId: string, adId: string): Promise<AdminAdRecord | null>;
  listCmsPages(query: OffsetPage): Promise<AdminPage<AdminCmsPageRecord>>;
  createCmsPage(data: CreateCmsPageData): Promise<AdminCmsPageRecord>;
  updateCmsPage(data: UpdateCmsPageData): Promise<AdminCmsPageRecord | null>;
  analytics(now: Date): Promise<AdminAnalyticsRecord>;
  listMatches(query: AdminMatchQuery): Promise<AdminPage<AdminMatchRecord>>;
  listMedia(query: AdminMediaQuery): Promise<AdminPage<AdminMediaRecord>>;
  getMediaContent(mediaId: string): Promise<AdminMediaContentRecord | null>;
  updateMedia(data: UpdateMediaData): Promise<AdminMediaRecord | null>;
  listOutboxEvents(
    query: AdminOutboxQuery,
  ): Promise<AdminPage<AdminOutboxEventRecord>>;
  retryOutboxEvent(
    actorId: string,
    eventId: string,
  ): Promise<AdminOutboxEventRecord | null>;
  listEmailJobs(
    query: AdminEmailJobQuery,
  ): Promise<AdminPage<AdminEmailJobRecord>>;
  retryEmailJob(
    actorId: string,
    jobId: string,
  ): Promise<AdminEmailJobRecord | null>;
  listHashtags(query: AdminHashtagQuery): Promise<AdminPage<AdminHashtagRecord>>;
  deleteHashtag(
    actorId: string,
    hashtagId: string,
  ): Promise<AdminHashtagRecord | null>;
}
