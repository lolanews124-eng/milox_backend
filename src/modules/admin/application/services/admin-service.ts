import type { ReportStatus, UserStatus } from "@prisma/client";

import { AppError } from "../../../../shared/errors/app-error.js";
import {
  AdminHierarchyError,
  AdminSelfActionError,
  AdminStateConflictError,
  type AdminRepository,
} from "../ports/admin-repository.js";
import {
  presentAdminReport,
  presentAdminUser,
} from "../admin-view.js";

export class AdminService {
  constructor(private readonly repository: AdminRepository) {}

  dashboard(): ReturnType<AdminRepository["dashboard"]> {
    return this.repository.dashboard(new Date());
  }

  async listUsers(options: {
    q?: string | undefined;
    status?: UserStatus | undefined;
    page: number;
    pageSize: number;
  }): Promise<object> {
    const result = await this.repository.listUsers({
      page: options.page,
      pageSize: options.pageSize,
      ...(options.q ? { q: options.q.trim().toLowerCase() } : {}),
      ...(options.status ? { status: options.status } : {}),
    });
    return {
      items: result.items.map(presentAdminUser),
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
}
