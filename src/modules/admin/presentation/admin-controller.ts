import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { AdminService } from "../application/services/admin-service.js";
import {
  adminReportIdParamSchema,
  adminReportQuerySchema,
  adminUserIdParamSchema,
  adminUserQuerySchema,
  changeUserStatusSchema,
  resolveReportSchema,
} from "./admin-schemas.js";

export class AdminController {
  constructor(private readonly admin: AdminService) {}

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
