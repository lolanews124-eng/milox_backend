import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { InterestService } from "../application/services/interest-service.js";
import {
  idempotencyKeySchema,
  interestIdParamSchema,
  interestPageQuerySchema,
  matchIdParamSchema,
  matchPageQuerySchema,
  sendInterestSchema,
} from "./interest-schemas.js";

export class InterestController {
  constructor(private readonly interests: InterestService) {}

  create = async (request: Request, response: Response): Promise<void> => {
    const input = sendInterestSchema.parse(request.body as unknown);
    const idempotencyKey = idempotencyKeySchema.parse(
      request.header("Idempotency-Key"),
    );
    const result = await this.interests.create(
      requireUser(request),
      input,
      idempotencyKey,
    );
    response
      .status(201)
      .set("Idempotency-Replayed", String(result.replayed))
      .json(success(request, result.item));
  };

  listIncoming = (request: Request, response: Response): Promise<void> =>
    this.listInterests("incoming", request, response);

  listOutgoing = (request: Request, response: Response): Promise<void> =>
    this.listInterests("outgoing", request, response);

  accept = (request: Request, response: Response): Promise<void> =>
    this.change("accept", request, response);

  reject = (request: Request, response: Response): Promise<void> =>
    this.change("reject", request, response);

  cancel = (request: Request, response: Response): Promise<void> =>
    this.change("cancel", request, response);

  listMatches = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = matchPageQuerySchema.parse(request.query);
    const page = await this.interests.listMatches(requireUser(request), {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    response.status(200).json(pageSuccess(request, page));
  };

  unmatch = async (request: Request, response: Response): Promise<void> => {
    const { matchId } = matchIdParamSchema.parse(request.params);
    await this.interests.unmatch(matchId, requireUser(request));
    response.status(204).send();
  };

  private async listInterests(
    direction: "incoming" | "outgoing",
    request: Request,
    response: Response,
  ): Promise<void> {
    const query = interestPageQuerySchema.parse(request.query);
    const page = await this.interests[
      direction === "incoming" ? "listIncoming" : "listOutgoing"
    ](requireUser(request), {
      limit: query.limit,
      ...(query.status ? { status: query.status } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    response.status(200).json(pageSuccess(request, page));
  }

  private async change(
    action: "accept" | "reject" | "cancel",
    request: Request,
    response: Response,
  ): Promise<void> {
    const { interestId } = interestIdParamSchema.parse(request.params);
    const data = await this.interests[action](
      interestId,
      requireUser(request),
    );
    response.status(200).json(success(request, data));
  }
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

function pageSuccess(
  request: Request,
  page: { items: object[]; nextCursor: string | null; hasMore: boolean },
) {
  return {
    success: true,
    data: { items: page.items },
    meta: {
      requestId: request.requestId,
      pagination: {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
    },
  };
}
