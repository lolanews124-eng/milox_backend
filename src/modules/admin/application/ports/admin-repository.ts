import type { MobileAppConfig, PaypalSettings, ReportStatus, UserRole, UserStatus, WalletTransactionType } from "@prisma/client";

import type {
  AdminAuditLogRecord,
  AdminCommentRecord,
  AdminCommentsStatsRecord,
  AdminDashboardRecord,
  AdminInterestTagRecord,
  AdminModerationActionRecord,
  AdminPostRecord,
  AdminPostsStatsRecord,
  AdminStoryRecord,
  AdminStoriesStatsRecord,
  AdminPremiumPlanRecord,
  AdminAdRecord,
  AdminAdPlacementConfigRecord,
  AdminAnalyticsRecord,
  AdminCmsPageRecord,
  AdminBlogPostRecord,
  AdminEmailJobRecord,
  AdminHashtagRecord,
  AdminMatchRecord,
  AdminMatchesStatsRecord,
  AdminReferralCodeLookupRecord,
  AdminReferralLeaderboardRecord,
  AdminReferralRecord,
  AdminReferralsStatsRecord,
  AdminConversationsStatsRecord,
  AdminConversationRecord,
  AdminConversationMessageRecord,
  AdminMediaContentRecord,
  AdminMediaRecord,
  AdminOutboxEventRecord,
  AdminSubscriptionRecord,
  AdminReportRecord,
  AdminUserDetailRecord,
  AdminUserRecord,
  AdminUsersStatsRecord,
  AdminVerificationStatsRecord,
  AdminWalletAdjustResultRecord,
  AdminWalletStatsRecord,
  AdminWalletTransactionRecord,
  AdminWalletUserRecord,
  AdminPointPurchaseRateRecord,
} from "../admin-view.js";

export interface OffsetPage {
  page: number;
  pageSize: number;
}

export interface AdminUserQuery extends OffsetPage {
  q?: string;
  status?: UserStatus;
  verified?: boolean;
  online?: boolean;
  reported?: boolean;
  emailVerified?: boolean;
  activity?: "online" | "today" | "week" | "quiet" | "dormant";
}

export interface AdminUserEmailExportQuery {
  actorId: string;
  audience: "active" | "inactive";
  inactiveDays: number;
  emailVerified?: boolean;
}

export interface AdminUserEmailExportResult {
  csv: string;
  count: number;
  truncated: boolean;
}

export interface AdminReportQuery extends OffsetPage {
  status?: ReportStatus;
}

export interface AdminPostQuery extends OffsetPage {
  q?: string;
  hidden?: boolean;
  includeDeleted?: boolean;
  bucket?: "all" | "reported" | "pending" | "hidden" | "removed";
  mediaKind?: "image" | "video" | "text" | "audio";
  createdFrom?: Date;
  createdTo?: Date;
}

export interface AdminStoryQuery extends OffsetPage {
  q?: string;
  bucket?: "all" | "active" | "expired" | "removed";
  createdFrom?: Date;
  createdTo?: Date;
}

export interface DeleteStoryData {
  actorId: string;
  storyId: string;
  note: string | null;
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
  postId?: string;
  hidden?: boolean;
  includeDeleted?: boolean;
  bucket?: "all" | "reported" | "hidden" | "removed" | "replies";
  createdFrom?: Date;
  createdTo?: Date;
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

export interface AdminWalletTransactionQuery extends OffsetPage {
  q?: string;
  userId?: string;
  type?: WalletTransactionType;
}

export interface AdminAdjustWalletData {
  actorId: string;
  userId: string;
  points: number;
  direction: "credit" | "debit";
  note?: string | null;
}

export interface CreatePointPurchaseRateData {
  actorId: string;
  currency: string;
  amountMinor: number;
  points: number;
  label?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdatePointPurchaseRateData {
  actorId: string;
  rateId: string;
  currency?: string;
  amountMinor?: number;
  points?: number;
  label?: string | null;
  isActive?: boolean;
  sortOrder?: number;
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

export interface PremiumPlanPriceInput {
  billingCycle: "MONTHLY" | "YEARLY" | "ONE_TIME";
  priceCents: number;
  durationDays: number;
  isActive?: boolean;
}

export interface CreatePremiumPlanData {
  actorId: string;
  code: string;
  name: string;
  description?: string | null;
  tier?: string;
  sortOrder?: number;
  badgeLabel?: string;
  priceCents: number;
  currency: string;
  durationDays: number;
  adsFree?: boolean;
  houseAdsFree?: boolean;
  profileViews?: boolean;
  discoverBoost?: number;
  grantVerifiedBadge?: boolean;
  dailyInterestLimit?: number;
  interstitialAdsFree?: boolean;
  directMessageEnabled?: boolean;
  prices?: PremiumPlanPriceInput[];
}

export interface UpdatePremiumPlanData {
  actorId: string;
  planId: string;
  name?: string;
  description?: string | null;
  tier?: string;
  sortOrder?: number;
  badgeLabel?: string;
  priceCents?: number;
  durationDays?: number;
  isActive?: boolean;
  adsFree?: boolean;
  houseAdsFree?: boolean;
  profileViews?: boolean;
  discoverBoost?: number;
  grantVerifiedBadge?: boolean;
  dailyInterestLimit?: number;
  interstitialAdsFree?: boolean;
  directMessageEnabled?: boolean;
  prices?: PremiumPlanPriceInput[];
}

export interface AdminSubscriptionQuery extends OffsetPage {
  status?: string;
  userId?: string;
  q?: string;
}

export interface GrantSubscriptionData {
  actorId: string;
  userId: string;
  planId: string;
  billingCycle?: "MONTHLY" | "YEARLY" | "ONE_TIME";
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
  ctaLabel?: string | null;
  placement: string;
  priority?: number;
  insertEvery?: number | null;
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
  ctaLabel?: string | null;
  placement?: string;
  priority?: number;
  insertEvery?: number | null;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface UpdateAdPlacementConfigData {
  actorId: string;
  placement: string;
  label?: string;
  description?: string | null;
  isEnabled?: boolean;
  insertEvery?: number;
}

export interface AdminAdQuery extends OffsetPage {
  placement?: string;
  isActive?: boolean;
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

export interface AdminBlogQuery extends OffsetPage {
  status?: string | undefined;
}

export interface CreateBlogPostData {
  actorId: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  bodyMarkdown: string;
  coverImageUrl?: string | null;
  metaDescription?: string | null;
  status?: string;
}

export interface UpdateBlogPostData {
  actorId: string;
  postId: string;
  slug?: string;
  title?: string;
  excerpt?: string | null;
  bodyMarkdown?: string;
  coverImageUrl?: string | null;
  metaDescription?: string | null;
  status?: string;
}

export interface AdminMatchQuery extends OffsetPage {
  status?: string;
  userId?: string;
  q?: string;
}

export interface AdminReferralQuery extends OffsetPage {
  q?: string;
  referrerUserId?: string;
}

export interface AdminConversationQuery extends OffsetPage {
  q?: string;
  bucket?: "all" | "active" | "closed" | "reported";
}

export interface DeleteAdminMessageData {
  actorId: string;
  messageId: string;
  note: string | null;
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
  /** When true with deleted, caller should unlink the file from UPLOAD_ROOT. */
  purgeStorage?: boolean;
}

export interface AdminMediaUpdateResult {
  media: AdminMediaRecord;
  storageKey: string | null;
  purgedStorage: boolean;
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
  usersStats(now: Date): Promise<AdminUsersStatsRecord>;
  verificationStats(): Promise<AdminVerificationStatsRecord>;
  listUsers(query: AdminUserQuery): Promise<AdminPage<AdminUserRecord>>;
  exportUserEmails(
    query: AdminUserEmailExportQuery,
  ): Promise<AdminUserEmailExportResult>;
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
  postsStats(): Promise<AdminPostsStatsRecord>;
  updatePostVisibility(
    data: UpdatePostVisibilityData,
  ): Promise<AdminPostRecord | null>;
  deletePost(data: DeletePostData): Promise<AdminPostRecord | null>;
  listStories(query: AdminStoryQuery): Promise<AdminPage<AdminStoryRecord>>;
  storiesStats(now: Date): Promise<AdminStoriesStatsRecord>;
  deleteStory(data: DeleteStoryData): Promise<AdminStoryRecord | null>;
  listComments(
    query: AdminCommentQuery,
  ): Promise<AdminPage<AdminCommentRecord>>;
  commentsStats(): Promise<AdminCommentsStatsRecord>;
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
  listAds(query: AdminAdQuery): Promise<AdminPage<AdminAdRecord>>;
  createAd(data: CreateAdData): Promise<AdminAdRecord>;
  updateAd(data: UpdateAdData): Promise<AdminAdRecord | null>;
  deleteAd(actorId: string, adId: string): Promise<AdminAdRecord | null>;
  listAdPlacementConfigs(): Promise<AdminAdPlacementConfigRecord[]>;
  updateAdPlacementConfig(
    data: UpdateAdPlacementConfigData,
  ): Promise<AdminAdPlacementConfigRecord | null>;
  listCmsPages(query: OffsetPage): Promise<AdminPage<AdminCmsPageRecord>>;
  createCmsPage(data: CreateCmsPageData): Promise<AdminCmsPageRecord>;
  updateCmsPage(data: UpdateCmsPageData): Promise<AdminCmsPageRecord | null>;
  listBlogPosts(query: AdminBlogQuery): Promise<AdminPage<AdminBlogPostRecord>>;
  createBlogPost(data: CreateBlogPostData): Promise<AdminBlogPostRecord>;
  updateBlogPost(data: UpdateBlogPostData): Promise<AdminBlogPostRecord | null>;
  analytics(now: Date): Promise<AdminAnalyticsRecord>;
  listMatches(query: AdminMatchQuery): Promise<AdminPage<AdminMatchRecord>>;
  matchesStats(now: Date): Promise<AdminMatchesStatsRecord>;
  referralsStats(now: Date): Promise<AdminReferralsStatsRecord>;
  listReferrals(query: AdminReferralQuery): Promise<AdminPage<AdminReferralRecord>>;
  listReferralLeaderboard(
    query: OffsetPage,
  ): Promise<AdminPage<AdminReferralLeaderboardRecord>>;
  lookupReferralCode(code: string): Promise<AdminReferralCodeLookupRecord | null>;
  listConversations(
    query: AdminConversationQuery,
  ): Promise<AdminPage<AdminConversationRecord>>;
  conversationsStats(now: Date): Promise<AdminConversationsStatsRecord>;
  listConversationMessages(
    conversationId: string,
    query: OffsetPage,
  ): Promise<AdminPage<AdminConversationMessageRecord>>;
  deleteMessageForEveryone(
    data: DeleteAdminMessageData,
  ): Promise<AdminConversationMessageRecord | null>;
  listMedia(query: AdminMediaQuery): Promise<AdminPage<AdminMediaRecord>>;
  getMediaContent(mediaId: string): Promise<AdminMediaContentRecord | null>;
  updateMedia(data: UpdateMediaData): Promise<AdminMediaUpdateResult | null>;
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
  walletStats(): Promise<AdminWalletStatsRecord>;
  getWalletUser(userId: string): Promise<AdminWalletUserRecord | null>;
  adjustWallet(data: AdminAdjustWalletData): Promise<AdminWalletAdjustResultRecord>;
  listWalletTransactions(
    query: AdminWalletTransactionQuery,
  ): Promise<AdminPage<AdminWalletTransactionRecord>>;
  listPointPurchaseRates(query: OffsetPage): Promise<AdminPage<AdminPointPurchaseRateRecord>>;
  createPointPurchaseRate(
    data: CreatePointPurchaseRateData,
  ): Promise<AdminPointPurchaseRateRecord>;
  updatePointPurchaseRate(
    data: UpdatePointPurchaseRateData,
  ): Promise<AdminPointPurchaseRateRecord | null>;
  getMobileAppConfig(): Promise<MobileAppConfig>;
  updateMobileAppConfig(
    data: UpdateMobileAppConfigData,
  ): Promise<MobileAppConfig>;
  getPaypalSettings(): Promise<PaypalSettings>;
  updatePaypalSettings(
    data: UpdatePaypalSettingsData,
  ): Promise<PaypalSettings>;
  paypalIncomeReport(): Promise<AdminPaypalIncomeRecord>;
}

export interface UpdatePaypalSettingsData {
  actorId: string;
  encryptionSecret: string;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  mode?: "sandbox" | "live" | undefined;
  webhookId?: string | undefined;
  clearSecret?: boolean | undefined;
}

export interface AdminPaypalIncomeRecord {
  allTime: Array<{ currency: string; amountMinor: number; count: number }>;
  today: Array<{ currency: string; amountMinor: number; count: number }>;
  last7Days: Array<{ currency: string; amountMinor: number; count: number }>;
  last30Days: Array<{ currency: string; amountMinor: number; count: number }>;
  byKind: Array<{
    kind: string;
    currency: string;
    amountMinor: number;
    count: number;
  }>;
  series: Array<{
    date: string;
    totals: Array<{ currency: string; amountMinor: number; count: number }>;
  }>;
  recent: Array<{
    id: string;
    kind: string;
    username: string;
    amountMinor: number;
    currency: string;
    description: string;
    paidAt: string;
  }>;
}

export interface UpdateMobileAppConfigData {
  actorId: string;
  latestVersion?: string | undefined;
  androidMinBuild?: number | undefined;
  iosMinBuild?: number | undefined;
  forceUpdate?: boolean | undefined;
  androidStoreUrl?: string | undefined;
  iosStoreUrl?: string | undefined;
  title?: string | undefined;
  message?: string | undefined;
}
