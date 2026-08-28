import type { AppConfig } from "../../../../config/env.js";
import type { PostSpamSnapshot } from "../ports/post-repository.js";

export const POST_SPAM_WARNING =
  "You're posting frequently. Continued spam may result in account suspension or a permanent ban.";

export function normalizePostBodyForDuplicateCheck(
  body: string | null,
): string | null {
  if (!body) return null;
  const normalized = body.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function assertPostingAllowed(
  snapshot: PostSpamSnapshot,
  limits: {
    cooldownSeconds: number;
    burstLimit: number;
    hourlyLimit: number;
    duplicateBlocked: boolean;
  },
  now = new Date(),
):
  | { ok: true; warning?: string }
  | {
      ok: false;
      code:
        | "POST_COOLDOWN"
        | "POST_BURST_LIMIT"
        | "POST_HOURLY_LIMIT"
        | "POST_DUPLICATE";
      message: string;
      statusCode: number;
      details?: { field?: string; issue: string }[];
    } {
  if (limits.duplicateBlocked) {
    return {
      ok: false,
      code: "POST_DUPLICATE",
      message:
        "You already posted this recently. Duplicate or random spam posts are not allowed.",
      statusCode: 409,
    };
  }

  if (snapshot.hourlyCount >= limits.hourlyLimit) {
    return {
      ok: false,
      code: "POST_HOURLY_LIMIT",
      message:
        "You've reached the hourly post limit. Try again later — repeated spam can get your account banned.",
      statusCode: 429,
    };
  }

  if (snapshot.burstCount >= limits.burstLimit) {
    return {
      ok: false,
      code: "POST_BURST_LIMIT",
      message:
        "You're posting too quickly. Slow down — continued spam may result in account suspension or a permanent ban.",
      statusCode: 429,
    };
  }

  if (snapshot.lastCreatedAt) {
    const elapsedSeconds = Math.floor(
      (now.getTime() - snapshot.lastCreatedAt.getTime()) / 1000,
    );
    const retryAfterSeconds = limits.cooldownSeconds - elapsedSeconds;
    if (retryAfterSeconds > 0) {
      return {
        ok: false,
        code: "POST_COOLDOWN",
        message: `Please wait ${retryAfterSeconds} seconds before posting again.`,
        statusCode: 429,
        details: [
          {
            field: "retryAfterSeconds",
            issue: String(retryAfterSeconds),
          },
        ],
      };
    }
  }

  const warning =
    snapshot.burstCount >= 1 ? POST_SPAM_WARNING : undefined;
  return warning ? { ok: true, warning } : { ok: true };
}

export function postSpamLimitsFromConfig(config: AppConfig) {
  return {
    cooldownSeconds: config.POST_COOLDOWN_SECONDS,
    burstLimit: config.POST_BURST_LIMIT,
    burstWindowMs: config.POST_BURST_WINDOW_SECONDS * 1000,
    hourlyLimit: config.POST_HOURLY_LIMIT,
    duplicateWindowMs: config.POST_DUPLICATE_WINDOW_SECONDS * 1000,
  };
}
