import { UgcModerationState } from "@prisma/client";

import { AppError } from "../../../shared/errors/app-error.js";
import {
  evaluateUgcFields,
  evaluateUgcText,
  type UgcEvaluation,
} from "./evaluate-ugc-text.js";
import { UGC_LENGTH_LIMITS } from "./ugc-text-normalize.js";

export type AppliedUgcModeration = {
  state: UgcModerationState;
  reason: string | null;
  isHidden: boolean;
  evaluation: UgcEvaluation;
};

/**
 * Map keyword evaluation → DB moderation fields.
 * REJECTED content is not created (caller throws). PENDING is stored hidden.
 */
export function applyUgcEvaluation(
  evaluation: UgcEvaluation,
): AppliedUgcModeration {
  if (evaluation.decision === "rejected") {
    return {
      state: UgcModerationState.REJECTED,
      reason: evaluation.auditReason,
      isHidden: true,
      evaluation,
    };
  }
  if (evaluation.decision === "pending") {
    return {
      state: UgcModerationState.PENDING,
      reason: evaluation.auditReason,
      isHidden: true,
      evaluation,
    };
  }
  return {
    state: UgcModerationState.APPROVED,
    reason: null,
    isHidden: false,
    evaluation,
  };
}

/** Throw before persistence when content must not be stored as public. */
export function assertUgcNotRejected(
  evaluation: UgcEvaluation,
  field = "body",
): void {
  if (evaluation.decision === "rejected") {
    throw new AppError(
      "CONTENT_REJECTED",
      evaluation.publicReason ??
        "This content violates our community guidelines.",
      422,
      [
        {
          field,
          issue: `Matched ${evaluation.matchedRuleIds.length} policy rule(s)`,
        },
      ],
    );
  }
}

/**
 * Identity fields (display name, username) and captions without a separate
 * moderation column must be immediately publishable — reject both `rejected`
 * and `pending` so we never save a prohibited public label.
 */
export function assertUgcImmediatelyPublishable(
  evaluation: UgcEvaluation,
  field: string,
): void {
  assertUgcNotRejected(evaluation, field);
  if (evaluation.decision === "pending") {
    throw new AppError(
      "CONTENT_REJECTED",
      evaluation.publicReason ??
        "This content was held for review and cannot be used here. Please choose different text.",
      422,
      [
        {
          field,
          issue: `Matched ${evaluation.matchedRuleIds.length} policy rule(s)`,
        },
      ],
    );
  }
}

export function moderatePostBody(body: string | null | undefined): AppliedUgcModeration {
  const evaluation = evaluateUgcText(body, {
    maxLength: UGC_LENGTH_LIMITS.postBody,
  });
  assertUgcNotRejected(evaluation, "body");
  return applyUgcEvaluation(evaluation);
}

export function moderateCommentBody(body: string): AppliedUgcModeration {
  const evaluation = evaluateUgcText(body, {
    maxLength: UGC_LENGTH_LIMITS.comment,
  });
  assertUgcNotRejected(evaluation, "body");
  return applyUgcEvaluation(evaluation);
}

/**
 * Public text with no PENDING storage path (identity, reel/story captions,
 * reel comments). Reject both reject and review severities before save.
 */
export function moderateStrictPublicText(
  value: string | null | undefined,
  field: string,
  maxLength: number,
): void {
  if (value == null) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  const evaluation = evaluateUgcText(trimmed, { maxLength });
  assertUgcImmediatelyPublishable(evaluation, field);
}

/** Reel / story captions — no UGC state column; must be clean to save. */
export function moderateCaption(
  caption: string | null | undefined,
  maxLength: number = UGC_LENGTH_LIMITS.caption,
): void {
  moderateStrictPublicText(caption, "caption", maxLength);
}

/** Public display name — reject-before-save (never publish prohibited names). */
export function moderateDisplayName(
  displayName: string | null | undefined,
): void {
  moderateStrictPublicText(
    displayName,
    "displayName",
    UGC_LENGTH_LIMITS.displayName,
  );
}

/** Username / handle — same reject-before-save policy as display name. */
export function moderateUsername(username: string): void {
  moderateStrictPublicText(username, "username", UGC_LENGTH_LIMITS.username);
}

export function moderateProfileText(input: {
  bio?: string | null;
  websiteUrl?: string | null;
  instagramHandle?: string | null;
}): AppliedUgcModeration {
  const evaluation = evaluateUgcFields([
    { label: "bio", value: input.bio, maxLength: UGC_LENGTH_LIMITS.bio },
    {
      label: "websiteUrl",
      value: input.websiteUrl,
      maxLength: UGC_LENGTH_LIMITS.websiteUrl,
    },
    {
      label: "instagramHandle",
      value: input.instagramHandle,
      maxLength: UGC_LENGTH_LIMITS.username,
    },
  ]);
  assertUgcNotRejected(evaluation, "bio");
  return applyUgcEvaluation(evaluation);
}

/** Public pages may show ads only when content is approved and not hidden/removed. */
export function isAdsEligibleContent(input: {
  moderationState?: UgcModerationState | string | null;
  isHidden?: boolean | null;
  deletedAt?: Date | null;
}): boolean {
  if (input.deletedAt) return false;
  if (input.isHidden) return false;
  const state = input.moderationState ?? UgcModerationState.APPROVED;
  return state === UgcModerationState.APPROVED;
}

export function isAdsEligibleProfile(input: {
  bioModerationState?: UgcModerationState | string | null;
  status?: string | null;
  deletedAt?: Date | null;
}): boolean {
  if (input.deletedAt) return false;
  if (input.status && input.status !== "ACTIVE") return false;
  const state = input.bioModerationState ?? UgcModerationState.APPROVED;
  return state === UgcModerationState.APPROVED;
}
