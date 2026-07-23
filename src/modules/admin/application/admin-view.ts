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
}

export interface AdminDashboardRecord {
  totalUsers: number;
  dailyActiveUsers: number;
  newUsersToday: number;
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
  createdAt: Date;
  updatedAt: Date;
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
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function presentAdminUsersStats(stats: AdminUsersStatsRecord): object {
  return { ...stats };
}

export function presentAdminReport(report: AdminReportRecord): object {
  return {
    id: report.id,
    reporterId: report.reporterId,
    targetType: report.targetType,
    reportedUserId: report.reportedUserId,
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

export interface AdminCommentRecord {
  id: string;
  postId: string;
  authorId: string;
  authorUsername: string;
  bodyPreview: string | null;
  likeCount: number;
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

export interface AdminPremiumPlanRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  durationDays: number;
  isActive: boolean;
  subscriberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminSubscriptionRecord {
  id: string;
  userId: string;
  username: string;
  planId: string;
  planName: string;
  planCode: string;
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
  placement: string;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
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
  userBId: string;
  userBUsername: string;
  userBDisplayName: string | null;
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

export function presentAdminComment(comment: AdminCommentRecord): object {
  return {
    id: comment.id,
    postId: comment.postId,
    authorId: comment.authorId,
    authorUsername: comment.authorUsername,
    bodyPreview: comment.bodyPreview,
    likeCount: comment.likeCount,
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
    priceCents: plan.priceCents,
    currency: plan.currency,
    durationDays: plan.durationDays,
    isActive: plan.isActive,
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
    planId: sub.planId,
    planName: sub.planName,
    planCode: sub.planCode,
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
    placement: ad.placement,
    isActive: ad.isActive,
    startsAt: ad.startsAt?.toISOString() ?? null,
    endsAt: ad.endsAt?.toISOString() ?? null,
    createdAt: ad.createdAt.toISOString(),
    updatedAt: ad.updatedAt.toISOString(),
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
    },
    userB: {
      id: match.userBId,
      username: match.userBUsername,
      displayName: match.userBDisplayName,
    },
    messageCount: match.messageCount,
    createdAt: match.createdAt.toISOString(),
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
