import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

export function requestId(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.header("x-request-id");
  const id = incoming && incoming.length <= 128 ? incoming : randomUUID();

  request.requestId = id;
  response.setHeader("X-Request-Id", id);
  next();
}
