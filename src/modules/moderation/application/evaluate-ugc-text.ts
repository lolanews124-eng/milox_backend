import {
  UGC_HARMLESS_ALONE,
  UGC_KEYWORD_RULES,
  type UgcKeywordRule,
  type UgcRuleSeverity,
} from "./ugc-keyword-rules.js";
import {
  countUrlMentions,
  normalizedContainsPhrase,
  normalizeUgcText,
  UGC_LENGTH_LIMITS,
} from "./ugc-text-normalize.js";

export type UgcModerationDecision =
  | "allow"
  | "pending"
  | "rejected";

export type UgcEvaluation = {
  decision: UgcModerationDecision;
  /** Public-safe short reason (no full phrase dump to end users). */
  publicReason: string | null;
  /** Internal audit detail. */
  auditReason: string | null;
  matchedRuleIds: string[];
  severity: UgcRuleSeverity | null;
};

export type EvaluateUgcOptions = {
  /** Override rule list (tests). */
  rules?: UgcKeywordRule[];
  /** When true, 3+ promotional URLs escalate spam → pending. */
  checkUrlSpam?: boolean;
  maxLength?: number;
};

function severityRank(s: UgcRuleSeverity): number {
  if (s === "reject") return 3;
  if (s === "review") return 2;
  return 1;
}

/**
 * Evaluate UGC text against keyword rules.
 * Client-supplied moderation status is never trusted — call this server-side only.
 */
export function evaluateUgcText(
  raw: string | null | undefined,
  options: EvaluateUgcOptions = {},
): UgcEvaluation {
  const maxLength = options.maxLength ?? UGC_LENGTH_LIMITS.postBody;
  if (typeof raw === "string" && raw.length > maxLength) {
    return {
      decision: "rejected",
      publicReason: "Content exceeds the allowed length.",
      auditReason: `length>${maxLength}`,
      matchedRuleIds: ["system.length"],
      severity: "reject",
    };
  }

  const normalized = normalizeUgcText(raw);
  if (!normalized) {
    return {
      decision: "allow",
      publicReason: null,
      auditReason: null,
      matchedRuleIds: [],
      severity: null,
    };
  }

  const rules = options.rules ?? UGC_KEYWORD_RULES;
  const matched: UgcKeywordRule[] = [];
  for (const rule of rules) {
    const phrase = normalizeUgcText(rule.phrase);
    if (!phrase) continue;
    // Never let a "harmless alone" token fire as a one-word rule.
    if (!phrase.includes(" ") && UGC_HARMLESS_ALONE.has(phrase)) continue;
    if (normalizedContainsPhrase(normalized, phrase)) {
      matched.push(rule);
    }
  }

  let top: UgcKeywordRule | null = null;
  for (const rule of matched) {
    if (!top || severityRank(rule.severity) > severityRank(top.severity)) {
      top = rule;
    }
  }

  if (options.checkUrlSpam !== false) {
    const urls = countUrlMentions(raw);
    if (urls >= 3) {
      const spamRule: UgcKeywordRule = {
        id: "spam.repeated_urls",
        category: "spam_scam",
        phrase: "repeated urls",
        severity: "spam",
      };
      matched.push(spamRule);
      if (!top || severityRank("spam") >= severityRank(top.severity)) {
        top = spamRule;
      }
    }
  }

  if (!top) {
    return {
      decision: "allow",
      publicReason: null,
      auditReason: null,
      matchedRuleIds: [],
      severity: null,
    };
  }

  if (top.severity === "reject") {
    return {
      decision: "rejected",
      publicReason:
        "This content violates our community guidelines and cannot be published.",
      auditReason: `reject:${top.id}:${top.category}`,
      matchedRuleIds: matched.map((r) => r.id),
      severity: top.severity,
    };
  }

  // review + spam → pending (hold for admin)
  return {
    decision: "pending",
    publicReason:
      "This content was held for review and is not publicly visible yet.",
    auditReason: `${top.severity}:${top.id}:${top.category}`,
    matchedRuleIds: matched.map((r) => r.id),
    severity: top.severity,
  };
}

/** Combine multiple text fields (bio + website, etc.). */
export function evaluateUgcFields(
  fields: Array<{ label: string; value: string | null | undefined; maxLength?: number }>,
  options: EvaluateUgcOptions = {},
): UgcEvaluation {
  let worst: UgcEvaluation = {
    decision: "allow",
    publicReason: null,
    auditReason: null,
    matchedRuleIds: [],
    severity: null,
  };
  const rank = (d: UgcModerationDecision) =>
    d === "rejected" ? 3 : d === "pending" ? 2 : 1;

  for (const field of fields) {
    const result = evaluateUgcText(field.value, {
      ...options,
      ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    });
    if (rank(result.decision) > rank(worst.decision)) {
      worst = {
        ...result,
        auditReason: result.auditReason
          ? `${field.label}:${result.auditReason}`
          : result.auditReason,
      };
    } else if (
      result.decision === worst.decision &&
      result.matchedRuleIds.length > 0
    ) {
      worst = {
        ...worst,
        matchedRuleIds: [
          ...new Set([...worst.matchedRuleIds, ...result.matchedRuleIds]),
        ],
        auditReason: [worst.auditReason, result.auditReason]
          .filter(Boolean)
          .join(";"),
      };
    }
  }
  return worst;
}
