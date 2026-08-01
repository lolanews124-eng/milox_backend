import type { Request } from "express";

import type { AppConfig } from "../../../config/env.js";
import type { AuthClientKind } from "../application/services/auth-service.js";

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function resolveAuthClientKind(
  request: Request,
  config: AppConfig,
): AuthClientKind {
  const platform = request.header("x-client-platform")?.trim().toLowerCase();
  if (platform === "admin") return "admin";

  const adminOrigin = normalizeOrigin(config.ADMIN_ORIGIN);
  const origin = request.header("origin");
  if (origin && normalizeOrigin(origin) === adminOrigin) {
    return "admin";
  }

  const referer = request.header("referer");
  if (referer?.startsWith(adminOrigin)) {
    return "admin";
  }

  return "consumer";
}
