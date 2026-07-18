import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

export function createRateLimit(
  limit: number,
  windowMs: number,
): RequestHandler {
  return rateLimit({
    limit,
    windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (request, response) => {
      response.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests; please try again later",
          details: [],
        },
        meta: { requestId: request.requestId },
      });
    },
  });
}
