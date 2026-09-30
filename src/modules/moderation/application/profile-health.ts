import { ProfileWarningKind, type PrismaClient } from "@prisma/client";

import { AppError } from "../../../shared/errors/app-error.js";

export const PROFILE_HEALTH_START = 100;
const RECOVERY_POINTS = 5;
const RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
const STRIKE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const RESTRICT_MS = 7 * 24 * 60 * 60 * 1000;

export const MODERATE_ACTIONS = [
  "DISMISS",
  "WARN",
  "REMOVE",
  "REMOVE_AND_WARN",
  "RESTRICT",
  "SUSPEND",
] as const;

export type ModerateAction = (typeof MODERATE_ACTIONS)[number];

export type ProfileHealthBand = "GOOD" | "WATCH" | "AT_RISK" | "RESTRICTED";

export interface HealthEvent {
  createdAt: Date;
  scoreDelta: number;
  reasonCode: string;
  kind: string;
  restrictUntil: Date | null;
  message: string;
}

export function isSeriousReason(reasonCode: string): boolean {
  return reasonCode === "NUDITY" || reasonCode === "UNDERAGE";
}

export function bandFor(score: number): ProfileHealthBand {
  if (score >= 80) return "GOOD";
  if (score >= 50) return "WATCH";
  if (score >= 20) return "AT_RISK";
  return "RESTRICTED";
}

export function bandLabel(band: ProfileHealthBand): string {
  if (band === "GOOD") return "Good";
  if (band === "WATCH") return "Watch";
  if (band === "AT_RISK") return "At risk";
  return "Restricted";
}

function recover(score: number, from: Date, to: Date): number {
  if (score >= PROFILE_HEALTH_START) return PROFILE_HEALTH_START;
  const steps = Math.floor((to.getTime() - from.getTime()) / RECOVERY_MS);
  if (steps <= 0) return score;
  return Math.min(PROFILE_HEALTH_START, score + steps * RECOVERY_POINTS);
}

export function computeProfileHealth(events: HealthEvent[], now: Date) {
  const ordered = [...events].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  let score = PROFILE_HEALTH_START;
  if (ordered.length > 0) {
    let cursor = ordered[0]!.createdAt;
    for (const event of ordered) {
      score = recover(score, cursor, event.createdAt);
      score = Math.max(
        0,
        Math.min(PROFILE_HEALTH_START, score + event.scoreDelta),
      );
      cursor = event.createdAt;
    }
    score = recover(score, cursor, now);
  }

  const since = now.getTime() - STRIKE_WINDOW_MS;
  const seriousStrikes90d = ordered.filter(
    (event) =>
      isSeriousReason(event.reasonCode) &&
      event.scoreDelta < 0 &&
      event.createdAt.getTime() >= since,
  ).length;
  const restrictedUntil =
    ordered
      .map((event) => event.restrictUntil)
      .filter((value): value is Date => value != null && value > now)
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
  const band = bandFor(score);
  return {
    score,
    band,
    bandLabel: bandLabel(band),
    seriousStrikes90d,
    restrictedUntil,
  };
}

export function scoreDeltaFor(action: ModerateAction, reasonCode: string): number {
  if (action === "DISMISS") return 0;
  if (action === "WARN") return -15;
  if (action === "SUSPEND") return -40;
  if (action === "RESTRICT") return -25;
  if (isSeriousReason(reasonCode)) return -25;
  if (action === "REMOVE_AND_WARN") return -20;
  return -10;
}

export function warningKindFor(action: ModerateAction): ProfileWarningKind {
  if (action === "WARN") return ProfileWarningKind.WARN;
  if (action === "RESTRICT") return ProfileWarningKind.RESTRICT;
  if (action === "SUSPEND") return ProfileWarningKind.SUSPEND;
  return ProfileWarningKind.CONTENT_REMOVED;
}

export function restrictUntilFor(action: ModerateAction, now: Date): Date | null {
  if (action !== "RESTRICT") return null;
  return new Date(now.getTime() + RESTRICT_MS);
}

const RULE_LABEL: Record<string, string> = {
  NUDITY: "nudity or sexual content",
  HARASSMENT: "harassment",
  SPAM: "spam",
  SCAM: "a scam",
  HATE_SPEECH: "hate speech",
  UNDERAGE: "a possible underage account",
  OTHER: "a community rule",
};

export function targetLabel(targetType: string): string {
  if (targetType === "POST") return "post";
  if (targetType === "STORY") return "story";
  if (targetType === "REEL") return "reel";
  if (targetType === "COMMENT") return "comment";
  if (targetType === "MESSAGE") return "message";
  return "profile";
}

export function moderationMessage(input: {
  action: ModerateAction;
  reasonCode: string;
  targetType: string;
}): string {
  const rule = RULE_LABEL[input.reasonCode] ?? "a community rule";
  const label = targetLabel(input.targetType);
  if (input.action === "WARN") {
    return `Warning: your ${label} breaks the rule on ${rule}. Your profile health went down.`;
  }
  if (input.action === "RESTRICT") {
    if (label === "profile") {
      return `Posting is paused for 7 days because of ${rule}.`;
    }
    return `Posting is paused for 7 days because of ${rule}. Your ${label} was removed.`;
  }
  if (input.action === "SUSPEND") {
    return `Your account is suspended because of ${rule}.`;
  }
  if (isSeriousReason(input.reasonCode)) {
    return `Your ${label} was removed and you were warned for ${rule}.`;
  }
  return `Your ${label} was removed because of ${rule}.`;
}

export function moderationSuggestion(
  seriousStrikes90d: number,
  reasonCode: string,
): string | null {
  if (!isSeriousReason(reasonCode)) return null;
  if (seriousStrikes90d <= 0) {
    return "First serious case: remove the content and warn.";
  }
  if (seriousStrikes90d === 1) {
    return "Second serious case in 90 days: restrict posting for 7 days.";
  }
  return "Third serious case in 90 days: suspend the account. Ban only if this is clearly deliberate.";
}

export function hidesContent(action: ModerateAction): boolean {
  return (
    action === "REMOVE" ||
    action === "REMOVE_AND_WARN" ||
    action === "RESTRICT" ||
    action === "SUSPEND"
  );
}

export async function assertCanCreateContent(
  database: PrismaClient,
  userId: string,
): Promise<void> {
  const open = await database.profileWarning.findFirst({
    where: {
      userId,
      kind: ProfileWarningKind.RESTRICT,
      restrictUntil: { gt: new Date() },
    },
    orderBy: { restrictUntil: "desc" },
    select: { restrictUntil: true },
  });
  if (!open?.restrictUntil) return;
  throw new AppError(
    "POSTING_RESTRICTED",
    `Posting is paused until ${open.restrictUntil.toISOString()} because of a profile warning.`,
    403,
  );
}
