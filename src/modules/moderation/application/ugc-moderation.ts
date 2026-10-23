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
export function assertUgcNotRejected(evaluation: UgcEvaluation): void {
  if (evaluation.decision === "rejected") {
    throw new AppError(
      "CONTENT_REJECTED",
      evaluation.publicReason ??
        "This content violates our community guidelines.",
      422,
      [
        {
          field: "body",
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
  assertUgcNotRejected(evaluation);
  return applyUgcEvaluation(evaluation);
}

export function moderateCommentBody(body: string): AppliedUgcModeration {
  const evaluation = evaluateUgcText(body, {
    maxLength: UGC_LENGTH_LIMITS.comment,
  });
  assertUgcNotRejected(evaluation);
  return applyUgcEvaluation(evaluation);
}

export function moderateProfileText(input: {
  bio?: string | null;
  websiteUrl?: string | null;
}): AppliedUgcModeration {
  const evaluation = evaluateUgcFields([
    { label: "bio", value: input.bio, maxLength: UGC_LENGTH_LIMITS.bio },
    {
      label: "websiteUrl",
      value: input.websiteUrl,
      maxLength: UGC_LENGTH_LIMITS.websiteUrl,
    },
  ]);
  assertUgcNotRejected(evaluation);
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
