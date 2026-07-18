import type { ReportStatus, UserStatus } from "@prisma/client";

import type {
  AdminDashboardRecord,
  AdminReportRecord,
  AdminUserRecord,
} from "../admin-view.js";

export interface OffsetPage {
  page: number;
  pageSize: number;
}

export interface AdminUserQuery extends OffsetPage {
  q?: string;
  status?: UserStatus;
}

export interface AdminReportQuery extends OffsetPage {
  status?: ReportStatus;
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
  changeUserStatus(
    data: ChangeUserStatusData,
  ): Promise<AdminUserRecord | null>;
  listReports(
    query: AdminReportQuery,
  ): Promise<AdminPage<AdminReportRecord>>;
  resolveReport(
    data: ResolveReportData,
  ): Promise<AdminReportRecord | null>;
}
