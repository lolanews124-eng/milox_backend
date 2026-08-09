import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

export interface RateLimitOptions {
  /** Override default IP-based bucket key. */
  keyGenerator?: (request: Request) => string;
  skip?: (request: Request) => boolean;
}

export function createRateLimit(
  limit: number,
  windowMs: number,
  options?: RateLimitOptions,
): RequestHandler {
  return rateLimit({
    limit,
    windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(options?.keyGenerator
      ? { keyGenerator: options.keyGenerator }
      : {}),
    ...(options?.skip ? { skip: options.skip } : {}),
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

/** Prefer authenticated user id so NAT/proxy IPs do not share one bucket. */
export function authenticatedRateLimitKey(request: Request): string {
  if (request.auth?.userId) {
    return `user:${request.auth.userId}`;
  }
  return ipKeyGenerator(request.ip ?? "unknown");
}
