import type {
  ReportStatus,
  ReportTargetType,
  UserRole,
  UserStatus,
} from "@prisma/client";

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
