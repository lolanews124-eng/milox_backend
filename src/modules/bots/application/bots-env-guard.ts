import { AppError } from "../../../shared/errors/app-error.js";
import type { AppConfig } from "../../../config/env.js";

/**
 * Blocks bot-mutating operations when the process cannot prove it is a safe
 * local/staging target. Production mutations require an explicit allow flag.
 */
export function assertBotsMutationsAllowed(
  config: AppConfig,
  operation: string,
): void {
  if (config.MILOX_ENV === "local" || config.MILOX_ENV === "test") {
    return;
  }
  if (config.MILOX_ENV === "staging" && config.BOTS_ALLOW_MUTATIONS) {
    return;
  }
  if (config.MILOX_ENV === "production" && config.BOTS_ALLOW_MUTATIONS) {
    return;
  }
  throw new AppError(
    "BOTS_ENV_BLOCKED",
    `Bot operation "${operation}" is blocked for MILOX_ENV=${config.MILOX_ENV}. Set BOTS_ALLOW_MUTATIONS=true only after explicit approval.`,
    403,
  );
}

export function assertNotProductionDatabaseHost(databaseUrl: string): void {
  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new AppError(
      "BOTS_ENV_BLOCKED",
      "DATABASE_URL is not a valid URL; refusing bot operations",
      500,
    );
  }
  const blocked = [
    "amazonaws.com",
    "neon.tech",
    "supabase.co",
    "railway.app",
    "render.com",
    "milox.in",
  ];
  if (
    process.env.MILOX_ENV === "local" &&
    blocked.some((fragment) => hostname.includes(fragment))
  ) {
    throw new AppError(
      "BOTS_ENV_BLOCKED",
      `Local bot operations refuse DATABASE_URL host "${hostname}"`,
      403,
    );
  }
}
