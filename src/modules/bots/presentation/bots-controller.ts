import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { BotsService } from "../application/services/bots-service.js";
import {
  batchIdParamSchema,
  botIdParamSchema,
  jobIdParamSchema,
  listBotsQuerySchema,
  listJobsQuerySchema,
  listPagedQuerySchema,
  lockSelectionSchema,
  previewCandidatesSchema,
  previewJobsSchema,
  provisionSchema,
  updateBotSchema,
  updateBotSettingsSchema,
} from "./bots-schemas.js";

export class BotsController {
  constructor(private readonly bots: BotsService) {}

  metrics = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json(success(request, await this.bots.getMetrics()));
  };

  getSettings = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json(success(request, await this.bots.getSettings()));
  };

  updateSettings = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const body = updateBotSettingsSchema.parse(request.body);
    const patch = {
      ...(body.killSwitch !== undefined
        ? { killSwitch: body.killSwitch }
        : {}),
      ...(body.globalPause !== undefined
        ? { globalPause: body.globalPause }
        : {}),
      ...(body.maxConcurrency !== undefined
        ? { maxConcurrency: body.maxConcurrency }
        : {}),
      ...(body.activityLimits !== undefined
        ? { activityLimits: body.activityLimits }
        : {}),
      ...(body.commentTemplates !== undefined
        ? { commentTemplates: body.commentTemplates }
        : {}),
      ...(body.usernameSuffix !== undefined
        ? { usernameSuffix: body.usernameSuffix }
        : {}),
    };
    response.status(200).json(
      success(
        request,
        await this.bots.updateSettings(requireActor(request), patch),
      ),
    );
  };

  previewCandidates = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const body = previewCandidatesSchema.parse(request.body ?? {});
    response.status(200).json(
      success(
        request,
        await this.bots.previewCandidates({
          ...(body.limit !== undefined ? { limit: body.limit } : {}),
          persist: body.persist,
          actorUserId: requireActor(request),
        }),
      ),
    );
  };

  getCandidateBatch = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { batchId } = batchIdParamSchema.parse(request.params);
    response
      .status(200)
      .json(success(request, await this.bots.getCandidateBatch(batchId)));
  };

  lockSelection = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { batchId } = batchIdParamSchema.parse(request.params);
    const body = lockSelectionSchema.parse(request.body);
    response.status(200).json(
      success(
        request,
        await this.bots.lockSelection(
          requireActor(request),
          batchId,
          body.selectedUserIds,
        ),
      ),
    );
  };

  provision = async (request: Request, response: Response): Promise<void> => {
    const { batchId } = batchIdParamSchema.parse(request.params);
    const body = provisionSchema.parse(request.body ?? {});
    response.status(200).json(
      success(
        request,
        await this.bots.provisionPreview(requireActor(request), batchId, {
          dryRun: body.dryRun,
          confirm: body.confirm,
          ...(body.confirmPhrase !== undefined
            ? { confirmPhrase: body.confirmPhrase }
            : {}),
          ...(body.limit !== undefined ? { limit: body.limit } : {}),
        }),
      ),
    );
  };

  listBots = async (request: Request, response: Response): Promise<void> => {
    const query = listBotsQuerySchema.parse(request.query);
    response.status(200).json(
      success(
        request,
        await this.bots.listBots({
          ...(query.q !== undefined ? { query: query.q } : {}),
          ...(query.status !== undefined ? { status: query.status } : {}),
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
          ...(query.offset !== undefined ? { offset: query.offset } : {}),
        }),
      ),
    );
  };

  getBot = async (request: Request, response: Response): Promise<void> => {
    const { botId } = botIdParamSchema.parse(request.params);
    response.status(200).json(success(request, await this.bots.getBot(botId)));
  };

  updateBotStatus = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { botId } = botIdParamSchema.parse(request.params);
    const body = updateBotSchema.parse(request.body);
    const patch: {
      status?: "ACTIVE" | "PAUSED" | "DISABLED";
      permissions?: {
        likesEnabled?: boolean;
        commentsEnabled?: boolean;
        followsEnabled?: boolean;
        viewsEnabled?: false;
        maxLikesPerDay?: number;
        maxCommentsPerDay?: number;
        maxFollowsPerDay?: number;
      };
    } = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.permissions !== undefined) {
      const permissions: NonNullable<typeof patch.permissions> = {};
      if (body.permissions.likesEnabled !== undefined) {
        permissions.likesEnabled = body.permissions.likesEnabled;
      }
      if (body.permissions.commentsEnabled !== undefined) {
        permissions.commentsEnabled = body.permissions.commentsEnabled;
      }
      if (body.permissions.followsEnabled !== undefined) {
        permissions.followsEnabled = body.permissions.followsEnabled;
      }
      if (body.permissions.viewsEnabled !== undefined) {
        permissions.viewsEnabled = body.permissions.viewsEnabled;
      }
      if (body.permissions.maxLikesPerDay !== undefined) {
        permissions.maxLikesPerDay = body.permissions.maxLikesPerDay;
      }
      if (body.permissions.maxCommentsPerDay !== undefined) {
        permissions.maxCommentsPerDay = body.permissions.maxCommentsPerDay;
      }
      if (body.permissions.maxFollowsPerDay !== undefined) {
        permissions.maxFollowsPerDay = body.permissions.maxFollowsPerDay;
      }
      patch.permissions = permissions;
    }
    response.status(200).json(
      success(
        request,
        await this.bots.updateBot(requireActor(request), botId, patch),
      ),
    );
  };

  listJobs = async (request: Request, response: Response): Promise<void> => {
    const query = listJobsQuerySchema.parse(request.query);
    response.status(200).json(
      success(
        request,
        await this.bots.listJobs({
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
          ...(query.offset !== undefined ? { offset: query.offset } : {}),
          ...(query.botAccountId !== undefined
            ? { botAccountId: query.botAccountId }
            : {}),
          ...(query.activityType !== undefined
            ? { activityType: query.activityType }
            : {}),
          ...(query.status !== undefined ? { status: query.status } : {}),
          ...(query.createdFrom !== undefined
            ? { createdFrom: query.createdFrom }
            : {}),
          ...(query.createdTo !== undefined
            ? { createdTo: query.createdTo }
            : {}),
        }),
      ),
    );
  };

  cancelJob = async (request: Request, response: Response): Promise<void> => {
    const { jobId } = jobIdParamSchema.parse(request.params);
    response.status(200).json(
      success(
        request,
        await this.bots.cancelJob(requireActor(request), jobId),
      ),
    );
  };

  retryJob = async (request: Request, response: Response): Promise<void> => {
    const { jobId } = jobIdParamSchema.parse(request.params);
    response.status(200).json(
      success(
        request,
        await this.bots.retryJob(requireActor(request), jobId),
      ),
    );
  };

  previewJobs = async (request: Request, response: Response): Promise<void> => {
    const body = previewJobsSchema.parse(request.body ?? {});
    response.status(200).json(
      success(
        request,
        await this.bots.previewUpcomingJobs(body.limit),
      ),
    );
  };

  listAudit = async (request: Request, response: Response): Promise<void> => {
    const query = listPagedQuerySchema.parse(request.query);
    response.status(200).json(
      success(
        request,
        await this.bots.listAudit({
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
          ...(query.offset !== undefined ? { offset: query.offset } : {}),
        }),
      ),
    );
  };
}

function requireActor(request: Request): string {
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
