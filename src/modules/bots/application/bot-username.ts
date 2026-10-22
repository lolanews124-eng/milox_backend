import { randomBytes } from "node:crypto";

const RESERVED = new Set([
  "admin",
  "administrator",
  "api",
  "help",
  "milox",
  "moderator",
  "root",
  "security",
  "staff",
  "support",
]);

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

/** Keep letters/digits/underscore; preserve casing (unlike the lowercase helper). */
export function sanitizeUsernameBase(source: string): string {
  return source.trim().replace(/[^a-zA-Z0-9_]/g, "");
}

/** Lowercase inspiration used for comparisons / legacy callers. */
export function sanitizeUsernameInspiration(source: string): string {
  return sanitizeUsernameBase(source).toLowerCase();
}

export function isValidBotUsername(username: string): boolean {
  return (
    username.length >= 3 &&
    username.length <= 32 &&
    USERNAME_RE.test(username) &&
    !RESERVED.has(username.toLowerCase())
  );
}

function finalizeUsername(candidate: string): string {
  let value = candidate.slice(0, 32);
  if (value.length < 3) {
    value = `${value}bot`.slice(0, 32);
  }
  if (isValidBotUsername(value)) return value;
  // Reserved / invalid after mutation — smallest salvage append.
  const salvaged = `${value.slice(0, 30)}2`.slice(0, 32);
  if (isValidBotUsername(salvaged)) return salvaged;
  return `bot_${randomBytes(4).toString("hex")}`;
}

function appendUnderscoreNumber(root: string, n: number): string {
  const suffix = `_${n}`;
  const maxRoot = Math.max(1, 32 - suffix.length);
  return `${root.slice(0, maxRoot)}${suffix}`;
}

/**
 * Minimal username variations derived from the source username.
 *
 * - attempt 0: sanitized original (case preserved) when valid
 * - later attempts: increment trailing digits, append digits, then `_n`
 * - attempt ≥ 20: `bot_<hex>` fallback after reasonable variations are exhausted
 *
 * `suffix` is ignored (legacy settings field; no mandatory suffix).
 */
export function buildBotUsernameCandidate(
  inspiration: string,
  _ignoredSuffix: string,
  attempt: number,
): string {
  if (attempt >= 20) {
    return `bot_${randomBytes(4).toString("hex")}`;
  }

  const cleaned = sanitizeUsernameBase(inspiration);
  const root =
    cleaned.length >= 3
      ? cleaned.slice(0, 32)
      : finalizeUsername(cleaned.length > 0 ? cleaned : "user");

  if (attempt === 0) {
    return finalizeUsername(root);
  }

  const digitMatch = root.match(/^(.*?)(\d+)$/);

  // Trailing-digit usernames: jane01 → jane02 … jane09 → jane10, then jane011, then jane01_2
  if (digitMatch) {
    const prefix = digitMatch[1] ?? "";
    const digits = digitMatch[2] ?? "0";

    if (attempt <= 12) {
      try {
        const next = (BigInt(digits) + BigInt(attempt)).toString();
        const padded =
          next.length < digits.length
            ? next.padStart(digits.length, "0")
            : next;
        return finalizeUsername(`${prefix}${padded}`);
      } catch {
        // fall through to append strategies
      }
    }

    if (attempt <= 16) {
      const extra = String(attempt - 12);
      return finalizeUsername(`${root}${extra}`);
    }

    return finalizeUsername(appendUnderscoreNumber(root, attempt - 15));
  }

  // No trailing digits: alice → alice2, alice3, … then alice_2
  if (attempt <= 12) {
    return finalizeUsername(`${root}${attempt + 1}`);
  }
  if (attempt <= 16) {
    return finalizeUsername(`${root}${attempt}`);
  }
  return finalizeUsername(appendUnderscoreNumber(root, attempt - 15));
}

/**
 * Preserve the source profile name exactly when present.
 * Falls back to the source username (not a fictional name).
 */
export function buildBotDisplayNameFromSource(
  displayName: string | null | undefined,
  username: string,
): string {
  if (typeof displayName === "string" && displayName.length > 0) {
    return displayName;
  }
  return username;
}

/** @deprecated Prefer buildBotDisplayNameFromSource — kept for call-site clarity during migration. */
export function buildBotDisplayName(
  displayName?: string | null,
  username = "bot",
): string {
  return buildBotDisplayNameFromSource(displayName, username);
}

/**
 * Fallbacks only for required User columns when the source row is incomplete.
 * Bio is never invented — use {@link normalizeReusableBio} instead.
 */
export const BOT_PROFILE_DEFAULTS = {
  ageRange: "AGE_25_28" as const,
  gender: "PREFER_NOT_TO_SAY" as const,
  country: "India",
};

/** Preserve source bio; treat missing/blank as null (do not invent copy). */
export function normalizeReusableBio(
  bio: string | null | undefined,
): string | null {
  if (typeof bio !== "string") return null;
  const trimmed = bio.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 500);
}

export const DEFAULT_BOT_PERMISSIONS = {
  likesEnabled: true,
  commentsEnabled: true,
  followsEnabled: true,
  viewsEnabled: false,
  maxLikesPerDay: 20,
  maxCommentsPerDay: 5,
  maxFollowsPerDay: 10,
} as const;

export const DEFAULT_ACTIVITY_LIMITS = {
  likesEnabled: true,
  commentsEnabled: true,
  followsEnabled: true,
  viewsEnabled: false,
  plannerIntervalMs: 60_000,
  maxJobsPerTick: 20,
  maxGlobalLikesPerHour: 100,
  maxGlobalCommentsPerHour: 40,
  maxGlobalFollowsPerHour: 40,
  excludePrivateAccounts: true,
  excludeAutomatedTargets: true,
} as const;
