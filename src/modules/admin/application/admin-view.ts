import type {
  ReportStatus,
  ReportTargetType,
  UserRole,
  UserStatus,
} from "@prisma/client";

export interface AdminUsersStatsRecord {
  totalUsers: number;
  verifiedUsers: number;
  onlineNow: number;
  newUsersToday: number;
  maleUsers: number;
  femaleUsers: number;
  suspendedUsers: number;
  reportedUsers: number;
  deletedUsers: number;
}

export interface AdminVerificationStatsRecord {
  pendingBadge: number;
  verifiedBadge: number;
  emailUnverified: number;
  totalActive: number;
}

export interface AdminDashboardRecord {
  totalUsers: number;
  dailyActiveUsers: number;
  newUsersToday: number;
  deletedUsers: number;
  totalPosts: number;
  totalComments: number;
  totalMessages: number;
  openReports: number;
  premiumUsers: number;
  revenueCents: number;
}

export interface AdminUserRecord {
  id: string;
  username: string;
  email: string;
  emailVerifiedAt: Date | null;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  isVerifiedBadge: boolean;
  country: string | null;
  profilePhotoMediaId: string | null;
  lastSeenAt: Date | null;
  followerCount: number;
  followingCount: number;
  postCount: number;
  lastLoginAt: Date | null;
  bannedAt: Date | null;
  banReason: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminReportPartyRecord {
  id: string;
  username: string;
  displayName: string | null;
  profilePhotoMediaId: string | null;
}

export interface AdminReportRecord {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  reportedUserId: string | null;
  postId: string | null;
  commentId: string | null;
  messageId: string | null;
  reasonCode: string;
  details: string | null;
  status: ReportStatus;
  resolvedAt: Date | null;
  resolverNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  reporter: AdminReportPartyRecord;
  reportedUser: AdminReportPartyRecord | null;
}

export function presentAdminUser(user: AdminUserRecord): object {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    isVerifiedBadge: user.isVerifiedBadge,
    country: user.country,
    profilePhotoMediaId: user.profilePhotoMediaId,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    followerCount: user.followerCount,
    followingCount: user.followingCount,
    postCount: user.postCount,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    bannedAt: user.bannedAt?.toISOString() ?? null,
    banReason: user.banReason,
    deletedAt: user.deletedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function presentAdminUsersStats(stats: AdminUsersStatsRecord): object {
  return { ...stats };
}

export function presentAdminVerificationStats(stats: AdminVerificationStatsRecord): object {
  return { ...stats };
}

export function presentAdminReport(report: AdminReportRecord): object {
  return {
    id: report.id,
    reporterId: report.reporterId,
    reporterUsername: report.reporter.username,
    reporterDisplayName: report.reporter.displayName,
    reporterProfilePhotoMediaId: report.reporter.profilePhotoMediaId,
    targetType: report.targetType,
    reportedUserId: report.reportedUserId,
    reportedUsername: report.reportedUser?.username ?? null,
    reportedDisplayName: report.reportedUser?.displayName ?? null,
    reportedProfilePhotoMediaId: report.reportedUser?.profilePhotoMediaId ?? null,
    postId: report.postId,
    commentId: report.commentId,
    messageId: report.messageId,
    reasonCode: report.reasonCode,
    details: report.details,
    status: report.status,
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    resolverNote: report.resolverNote,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

export interface AdminUserDetailRecord extends AdminUserRecord {
  bio: string | null;
  country: string;
  gender: string;
  ageRange: string;
  isPrivateAccount: boolean;
  lastSeenAt: Date | null;
  reportsAgainstCount: number;
  openReportsAgainstCount: number;
}

export interface AdminModerationActionRecord {
  id: string;
  actorId: string;
  actorUsername: string;
  actionCode: string;
  note: string | null;
  createdAt: Date;
}

export interface AdminPostsStatsRecord {
  totalPosts: number;
  approvedPosts: number;
  reportedPosts: number;
  pendingReviewPosts: number;
  hiddenPosts: number;
  removedPosts: number;
}

export interface AdminStoriesStatsRecord {
  totalStories: number;
  activeStories: number;
  expiredStories: number;
  removedStories: number;
  totalViews: number;
}

export interface AdminStoryRecord {
  id: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string | null;
  authorIsVerifiedBadge: boolean;
  authorProfilePhotoMediaId: string | null;
  mediaAssetId: string;
  mimeType: string;
  captionPreview: string | null;
  viewCount: number;
  expiresAt: Date;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface AdminPostRecord {
  id: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string | null;
  authorIsVerifiedBadge: boolean;
  authorProfilePhotoMediaId: string | null;
  bodyPreview: string | null;
  mediaCount: number;
  mediaPreview: Array<{ id: string; mimeType: string }>;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  hasOpenReport: boolean;
  hasPendingReview: boolean;
  isHidden: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface AdminCommentsStatsRecord {
  totalComments: number;
  visibleComments: number;
  reportedComments: number;
  hiddenComments: number;
  removedComments: number;
  replyComments: number;
}

export interface AdminCommentRecord {
  id: string;
  postId: string;
  parentId: string | null;
  depth: number;
  replyCount: number;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string | null;
  authorIsVerifiedBadge: boolean;
  authorProfilePhotoMediaId: string | null;
  bodyPreview: string | null;
  likeCount: number;
  hasOpenReport: boolean;
  isHidden: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface AdminAuditLogRecord {
  id: string;
  actorType: string;
  actorUserId: string | null;
  actorUsername: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AdminInterestTagRecord {
  id: string;
  slug: string;
  label: string;
  isActive: boolean;
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminPlanPriceRecord {
  id: string;
  billingCycle: string;
  priceCents: number;
  durationDays: number;
  isActive: boolean;
}

export interface AdminPremiumPlanRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  tier: string;
  sortOrder: number;
  badgeLabel: string;
  priceCents: number;
  currency: string;
  durationDays: number;
  adsFree: boolean;
  houseAdsFree: boolean;
  profileViews: boolean;
  discoverBoost: number;
  grantVerifiedBadge: boolean;
  dailyInterestLimit: number;
  interstitialAdsFree: boolean;
  directMessageEnabled: boolean;
  isActive: boolean;
  prices: AdminPlanPriceRecord[];
  subscriberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminSubscriptionRecord {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  profilePhotoMediaId: string | null;
  planId: string;
  planName: string;
  planCode: string;
  planTier: string;
  billingCycle: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
  createdAt: Date;
}

export interface AdminAdRecord {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  targetUrl: string | null;
  ctaLabel: string | null;
  placement: string;
  priority: number;
  insertEvery: number | null;
  isActive: boolean;
  impressionCount: number;
  clickCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAdPlacementConfigRecord {
  placement: string;
  label: string;
  description: string | null;
  isEnabled: boolean;
  insertEvery: number;
  updatedAt: Date;
}

export interface AdminCmsPageRecord {
  id: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminBlogPostRecord {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMarkdown: string;
  coverImageUrl: string | null;
  metaDescription: string | null;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAnalyticsDemographics {
  totalUsers: number;
  gender: Array<{ key: string; label: string; count: number; percentage: number }>;
  ageRanges: Array<{ key: string; label: string; count: number; percentage: number }>;
  countries: Array<{ key: string; label: string; count: number; percentage: number }>;
}

export interface AdminAnalyticsRecord {
  userSignups: Array<{ date: string; count: number }>;
  postsCreated: Array<{ date: string; count: number }>;
  reportsFiled: Array<{ date: string; count: number }>;
  demographics: AdminAnalyticsDemographics;
}

export interface AdminMatchesStatsRecord {
  totalMatches: number;
  activeMatches: number;
  unmatchedMatches: number;
  withMessages: number;
  matchedToday: number;
}

export interface AdminReferralsStatsRecord {
  totalReferrals: number;
  referralsToday: number;
  referralsLast7Days: number;
  referralsLast30Days: number;
  activeReferrers: number;
  referralCodesIssued: number;
  referredSignupShare: number;
  totalRewardPointsPaid: number;
  rewardPerReferral: number;
  sharingActive: boolean;
  referralsTrend: Array<{ date: string; count: number }>;
}

export interface AdminReferralRecord {
  id: string;
  referrerUserId: string;
  referrerUsername: string;
  referrerDisplayName: string | null;
  referredUserId: string;
  referredUsername: string;
  referredDisplayName: string | null;
  rewardPoints: number;
  status: string;
  createdAt: Date;
}

export interface AdminReferralLeaderboardRecord {
  userId: string;
  username: string;
  displayName: string | null;
  profilePhotoMediaId: string | null;
  referralCode: string;
  referralCount: number;
  totalEarned: number;
  lastReferralAt: Date | null;
}

export interface AdminReferralCodeLookupRecord {
  code: string;
  userId: string;
  username: string;
  displayName: string | null;
  profilePhotoMediaId: string | null;
  userStatus: string;
  referralCount: number;
  totalEarned: number;
  codeCreatedAt: Date;
}

export interface AdminConversationsStatsRecord {
  totalConversations: number;
  activeConversations: number;
  closedConversations: number;
  reportedConversations: number;
  totalMessages: number;
  messagesToday: number;
}

export interface AdminConversationMemberRecord {
  id: string;
  username: string;
  displayName: string | null;
  profilePhotoMediaId: string | null;
}

export interface AdminConversationRecord {
  id: string;
  status: string;
  matchId: string | null;
  messageCount: number;
  openReportCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageType: string | null;
  members: AdminConversationMemberRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminConversationMessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  senderUsername: string;
  type: string;
  bodyPreview: string | null;
  mediaAssetId: string | null;
  mimeType: string | null;
  hasOpenReport: boolean;
  deletedForEveryoneAt: Date | null;
  createdAt: Date;
}

export interface AdminMatchRecord {
  id: string;
  status: string;
  matchedAt: Date;
  unmatchedAt: Date | null;
  interestId: string;
  conversationId: string | null;
  userAId: string;
  userAUsername: string;
  userADisplayName: string | null;
  userAProfilePhotoMediaId: string | null;
  userBId: string;
  userBUsername: string;
  userBDisplayName: string | null;
  userBProfilePhotoMediaId: string | null;
  messageCount: number;
  createdAt: Date;
}

export interface AdminMediaRecord {
  id: string;
  kind: string;
  visibility: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  ownerUserId: string | null;
  ownerUsername: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface AdminMediaContentRecord {
  storageKey: string;
  mimeType: string;
  checksumSha256: string | null;
}

export interface AdminOutboxEventRecord {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  availableAt: Date;
  processedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface AdminEmailJobRecord {
  id: string;
  type: string;
  toEmailMasked: string;
  payloadSummary: Record<string, unknown>;
  status: string;
  attempts: number;
  availableAt: Date;
  sentAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface AdminHashtagRecord {
  id: string;
  tag: string;
  postCount: number;
  lastUsedAt: Date;
  createdAt: Date;
}

export function presentAdminUserDetail(user: AdminUserDetailRecord): object {
  return {
    ...presentAdminUser(user),
    bio: user.bio,
    country: user.country,
    gender: user.gender,
    ageRange: user.ageRange,
    isPrivateAccount: user.isPrivateAccount,
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    reportsAgainstCount: user.reportsAgainstCount,
    openReportsAgainstCount: user.openReportsAgainstCount,
  };
}

export function presentAdminModerationAction(
  action: AdminModerationActionRecord,
): object {
  return {
    id: action.id,
    actorId: action.actorId,
    actorUsername: action.actorUsername,
    actionCode: action.actionCode,
    note: action.note,
    createdAt: action.createdAt.toISOString(),
  };
}

export function presentAdminPost(post: AdminPostRecord): object {
  return {
    id: post.id,
    authorId: post.authorId,
    authorUsername: post.authorUsername,
    authorDisplayName: post.authorDisplayName,
    authorIsVerifiedBadge: post.authorIsVerifiedBadge,
    authorProfilePhotoMediaId: post.authorProfilePhotoMediaId,
    bodyPreview: post.bodyPreview,
    mediaCount: post.mediaCount,
    mediaPreview: post.mediaPreview,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    shareCount: post.shareCount,
    hasOpenReport: post.hasOpenReport,
    hasPendingReview: post.hasPendingReview,
    isHidden: post.isHidden,
    deletedAt: post.deletedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
  };
}

export function presentAdminPostsStats(stats: AdminPostsStatsRecord): object {
  return { ...stats };
}

export function presentAdminStory(story: AdminStoryRecord): object {
  const now = Date.now();
  const isActive =
    story.deletedAt == null && story.expiresAt.getTime() > now;
  const isExpired =
    story.deletedAt == null && story.expiresAt.getTime() <= now;
  return {
    id: story.id,
    authorId: story.authorId,
    authorUsername: story.authorUsername,
    authorDisplayName: story.authorDisplayName,
    authorIsVerifiedBadge: story.authorIsVerifiedBadge,
    authorProfilePhotoMediaId: story.authorProfilePhotoMediaId,
    mediaAssetId: story.mediaAssetId,
    mimeType: story.mimeType,
    captionPreview: story.captionPreview,
    viewCount: story.viewCount,
    expiresAt: story.expiresAt.toISOString(),
    deletedAt: story.deletedAt?.toISOString() ?? null,
    createdAt: story.createdAt.toISOString(),
    isActive,
    isExpired,
    isRemoved: story.deletedAt != null,
  };
}

export function presentAdminStoriesStats(stats: AdminStoriesStatsRecord): object {
  return { ...stats };
}

export function presentAdminCommentsStats(stats: AdminCommentsStatsRecord): object {
  return { ...stats };
}

export function presentAdminComment(comment: AdminCommentRecord): object {
  return {
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId,
    depth: comment.depth,
    replyCount: comment.replyCount,
    authorId: comment.authorId,
    authorUsername: comment.authorUsername,
    authorDisplayName: comment.authorDisplayName,
    authorIsVerifiedBadge: comment.authorIsVerifiedBadge,
    authorProfilePhotoMediaId: comment.authorProfilePhotoMediaId,
    bodyPreview: comment.bodyPreview,
    likeCount: comment.likeCount,
    hasOpenReport: comment.hasOpenReport,
    isHidden: comment.isHidden,
    deletedAt: comment.deletedAt?.toISOString() ?? null,
    createdAt: comment.createdAt.toISOString(),
  };
}

export function presentAdminAuditLog(log: AdminAuditLogRecord): object {
  return {
    id: log.id,
    actorType: log.actorType,
    actorUserId: log.actorUserId,
    actorUsername: log.actorUsername,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    metadata: log.metadata,
    createdAt: log.createdAt.toISOString(),
  };
}

export function presentAdminInterestTag(tag: AdminInterestTagRecord): object {
  return {
    id: tag.id,
    slug: tag.slug,
    label: tag.label,
    isActive: tag.isActive,
    userCount: tag.userCount,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}

export function presentAdminPremiumPlan(plan: AdminPremiumPlanRecord): object {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    tier: plan.tier,
    sortOrder: plan.sortOrder,
    badgeLabel: plan.badgeLabel,
    priceCents: plan.priceCents,
    currency: plan.currency,
    durationDays: plan.durationDays,
    adsFree: plan.adsFree,
    houseAdsFree: plan.houseAdsFree,
    profileViews: plan.profileViews,
    discoverBoost: plan.discoverBoost,
    grantVerifiedBadge: plan.grantVerifiedBadge,
    dailyInterestLimit:
      plan.dailyInterestLimit >= 9999 ? "unlimited" : plan.dailyInterestLimit,
    interstitialAdsFree: plan.interstitialAdsFree,
    directMessageEnabled: plan.directMessageEnabled,
    isActive: plan.isActive,
    prices: plan.prices.map((price) => ({
      id: price.id,
      billingCycle: price.billingCycle,
      priceCents: price.priceCents,
      durationDays: price.durationDays,
      isActive: price.isActive,
    })),
    subscriberCount: plan.subscriberCount,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export function presentAdminSubscription(sub: AdminSubscriptionRecord): object {
  return {
    id: sub.id,
    userId: sub.userId,
    username: sub.username,
    displayName: sub.displayName,
    profilePhotoMediaId: sub.profilePhotoMediaId,
    planId: sub.planId,
    planName: sub.planName,
    planCode: sub.planCode,
    planTier: sub.planTier,
    billingCycle: sub.billingCycle,
    status: sub.status,
    startsAt: sub.startsAt.toISOString(),
    endsAt: sub.endsAt.toISOString(),
    cancelledAt: sub.cancelledAt?.toISOString() ?? null,
    createdAt: sub.createdAt.toISOString(),
  };
}

export function presentAdminAd(ad: AdminAdRecord): object {
  return {
    id: ad.id,
    title: ad.title,
    body: ad.body,
    imageUrl: ad.imageUrl,
    targetUrl: ad.targetUrl,
    ctaLabel: ad.ctaLabel,
    placement: ad.placement,
    priority: ad.priority,
    insertEvery: ad.insertEvery,
    isActive: ad.isActive,
    impressionCount: ad.impressionCount,
    clickCount: ad.clickCount,
    startsAt: ad.startsAt?.toISOString() ?? null,
    endsAt: ad.endsAt?.toISOString() ?? null,
    createdAt: ad.createdAt.toISOString(),
    updatedAt: ad.updatedAt.toISOString(),
  };
}

export function presentAdminAdPlacementConfig(
  config: AdminAdPlacementConfigRecord,
): object {
  return {
    placement: config.placement,
    label: config.label,
    description: config.description,
    isEnabled: config.isEnabled,
    insertEvery: config.insertEvery,
    updatedAt: config.updatedAt.toISOString(),
  };
}

export function presentAdminCmsPage(page: AdminCmsPageRecord): object {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    bodyMarkdown: page.bodyMarkdown,
    status: page.status,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

export function presentAdminBlogPost(post: AdminBlogPostRecord): object {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    bodyMarkdown: post.bodyMarkdown,
    coverImageUrl: post.coverImageUrl,
    metaDescription: post.metaDescription,
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function presentAdminAnalytics(data: AdminAnalyticsRecord): object {
  return data;
}

export function presentAdminMatch(match: AdminMatchRecord): object {
  return {
    id: match.id,
    status: match.status,
    matchedAt: match.matchedAt.toISOString(),
    unmatchedAt: match.unmatchedAt?.toISOString() ?? null,
    interestId: match.interestId,
    conversationId: match.conversationId,
    userA: {
      id: match.userAId,
      username: match.userAUsername,
      displayName: match.userADisplayName,
      profilePhotoMediaId: match.userAProfilePhotoMediaId,
    },
    userB: {
      id: match.userBId,
      username: match.userBUsername,
      displayName: match.userBDisplayName,
      profilePhotoMediaId: match.userBProfilePhotoMediaId,
    },
    messageCount: match.messageCount,
    createdAt: match.createdAt.toISOString(),
  };
}

export function presentAdminMatchesStats(stats: AdminMatchesStatsRecord): object {
  return { ...stats };
}

export function presentAdminReferralsStats(stats: AdminReferralsStatsRecord): object {
  return { ...stats };
}

export function presentAdminReferral(referral: AdminReferralRecord): object {
  return {
    id: referral.id,
    referrerUserId: referral.referrerUserId,
    referrerUsername: referral.referrerUsername,
    referrerDisplayName: referral.referrerDisplayName,
    referredUserId: referral.referredUserId,
    referredUsername: referral.referredUsername,
    referredDisplayName: referral.referredDisplayName,
    rewardPoints: referral.rewardPoints,
    status: referral.status,
    createdAt: referral.createdAt.toISOString(),
  };
}

export function presentAdminReferralLeaderboard(
  row: AdminReferralLeaderboardRecord,
): object {
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    profilePhotoMediaId: row.profilePhotoMediaId,
    referralCode: row.referralCode,
    referralCount: row.referralCount,
    totalEarned: row.totalEarned,
    lastReferralAt: row.lastReferralAt?.toISOString() ?? null,
  };
}

export function presentAdminReferralCodeLookup(
  row: AdminReferralCodeLookupRecord,
): object {
  return {
    code: row.code,
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    profilePhotoMediaId: row.profilePhotoMediaId,
    userStatus: row.userStatus,
    referralCount: row.referralCount,
    totalEarned: row.totalEarned,
    codeCreatedAt: row.codeCreatedAt.toISOString(),
  };
}

export function presentAdminConversation(
  conversation: AdminConversationRecord,
): object {
  return {
    id: conversation.id,
    status: conversation.status,
    matchId: conversation.matchId,
    messageCount: conversation.messageCount,
    openReportCount: conversation.openReportCount,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageType: conversation.lastMessageType,
    members: conversation.members,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export function presentAdminConversationsStats(
  stats: AdminConversationsStatsRecord,
): object {
  return { ...stats };
}

export function presentAdminConversationMessage(
  message: AdminConversationMessageRecord,
): object {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderUsername: message.senderUsername,
    type: message.type,
    bodyPreview: message.bodyPreview,
    mediaAssetId: message.mediaAssetId,
    mimeType: message.mimeType,
    hasOpenReport: message.hasOpenReport,
    deletedForEveryoneAt: message.deletedForEveryoneAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}

export function presentAdminMedia(media: AdminMediaRecord): object {
  return {
    id: media.id,
    kind: media.kind,
    visibility: media.visibility,
    mimeType: media.mimeType,
    byteSize: media.byteSize,
    width: media.width,
    height: media.height,
    ownerUserId: media.ownerUserId,
    ownerUsername: media.ownerUsername,
    deletedAt: media.deletedAt?.toISOString() ?? null,
    createdAt: media.createdAt.toISOString(),
  };
}

export function presentAdminOutboxEvent(event: AdminOutboxEventRecord): object {
  return {
    id: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: event.payload,
    status: event.status,
    attempts: event.attempts,
    availableAt: event.availableAt.toISOString(),
    processedAt: event.processedAt?.toISOString() ?? null,
    lastError: event.lastError,
    createdAt: event.createdAt.toISOString(),
  };
}

export function presentAdminEmailJob(job: AdminEmailJobRecord): object {
  return {
    id: job.id,
    type: job.type,
    toEmailMasked: job.toEmailMasked,
    payloadSummary: job.payloadSummary,
    status: job.status,
    attempts: job.attempts,
    availableAt: job.availableAt.toISOString(),
    sentAt: job.sentAt?.toISOString() ?? null,
    lastError: job.lastError,
    createdAt: job.createdAt.toISOString(),
  };
}

export function presentAdminHashtag(tag: AdminHashtagRecord): object {
  return {
    id: tag.id,
    tag: tag.tag,
    postCount: tag.postCount,
    lastUsedAt: tag.lastUsedAt.toISOString(),
    createdAt: tag.createdAt.toISOString(),
  };
}

export interface AdminWalletStatsRecord {
  totalWallets: number;
  totalBalance: number;
  totalLifetimeEarned: number;
  adminAdjustmentsCount: number;
}

export interface AdminWalletUserRecord {
  userId: string;
  username: string;
  displayName: string | null;
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
}

export interface AdminWalletAdjustResultRecord {
  userId: string;
  username: string;
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  direction: "credit" | "debit";
  points: number;
}

export interface AdminWalletTransactionRecord {
  id: string;
  userId: string;
  username: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: Date;
}

export interface AdminPointPurchaseRateRecord {
  id: string;
  currency: string;
  amountMinor: number;
  points: number;
  label: string | null;
  isActive: boolean;
  sortOrder: number;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function presentAdminWalletStats(stats: AdminWalletStatsRecord): object {
  return stats;
}

export function presentAdminWalletUser(user: AdminWalletUserRecord): object {
  return user;
}

export function presentAdminWalletAdjustResult(
  result: AdminWalletAdjustResultRecord,
): object {
  return result;
}

export function presentAdminWalletTransaction(
  tx: AdminWalletTransactionRecord,
): object {
  return {
    id: tx.id,
    userId: tx.userId,
    username: tx.username,
    type: tx.type,
    amount: tx.amount,
    balanceAfter: tx.balanceAfter,
    description: tx.description,
    createdAt: tx.createdAt.toISOString(),
  };
}

export function presentAdminPointPurchaseRate(
  rate: AdminPointPurchaseRateRecord,
): object {
  return {
    id: rate.id,
    currency: rate.currency,
    amountMinor: rate.amountMinor,
    points: rate.points,
    label: rate.label,
    isActive: rate.isActive,
    sortOrder: rate.sortOrder,
    updatedById: rate.updatedById,
    createdAt: rate.createdAt.toISOString(),
    updatedAt: rate.updatedAt.toISOString(),
  };
}
