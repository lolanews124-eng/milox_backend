import {
  UGC_CONTEXT_ALLOW_PHRASES,
  UGC_EMBEDDABLE_STEMS,
  UGC_HARMLESS_ALONE,
  UGC_KEYWORD_RULES,
  type UgcKeywordRule,
  type UgcRuleSeverity,
} from "./ugc-keyword-rules.js";
import {
  countUrlMentions,
  layersContainEmbeddedStem,
  normalizedContainsPhrase,
  normalizeUgcLayers,
  normalizeUgcText,
  UGC_LENGTH_LIMITS,
  type UgcNormalizedLayers,
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
  /** Skip embeddable-stem compound detection (tests). */
  skipEmbedded?: boolean;
};

function severityRank(s: UgcRuleSeverity): number {
  if (s === "reject") return 3;
  if (s === "review") return 2;
  return 1;
}

function decisionRank(d: UgcModerationDecision): number {
  if (d === "rejected") return 3;
  if (d === "pending") return 2;
  return 1;
}

function hasContextAllow(layers: UgcNormalizedLayers): boolean {
  for (const phrase of UGC_CONTEXT_ALLOW_PHRASES) {
    const normalizedPhrase = normalizeUgcText(phrase);
    if (!normalizedPhrase) continue;
    if (
      normalizedContainsPhrase(layers.spacedCollapsed, normalizedPhrase) ||
      normalizedContainsPhrase(layers.tokens, normalizedPhrase)
    ) {
      return true;
    }
  }
  return false;
}

/** Token-boundary match on spaced layers; compact match for multi-word phrases. */
function ruleMatchesLayers(
  rule: UgcKeywordRule,
  layers: UgcNormalizedLayers,
): boolean {
  const phrase = normalizeUgcText(rule.phrase);
  if (!phrase) return false;
  if (!phrase.includes(" ") && UGC_HARMLESS_ALONE.has(phrase)) return false;

  if (
    normalizedContainsPhrase(layers.spacedCollapsed, phrase) ||
    normalizedContainsPhrase(layers.tokens, phrase)
  ) {
    return true;
  }

  // Joined multi-word evasion: "sex chat" ↔ compact "sexchat"
  if (phrase.includes(" ")) {
    const compactPhrase = phrase.replace(/\s+/g, "");
    if (
      compactPhrase.length >= 4 &&
      layers.compact.includes(compactPhrase)
    ) {
      return true;
    }
  }

  return false;
}

function collectEmbeddedMatches(
  layers: UgcNormalizedLayers,
): UgcKeywordRule[] {
  const matched: UgcKeywordRule[] = [];
  for (const stem of UGC_EMBEDDABLE_STEMS) {
    if (!layersContainEmbeddedStem(layers, stem)) continue;
    matched.push({
      id: stem.ruleId,
      category: stem.category,
      phrase: stem.stem,
      severity: stem.severity,
    });
  }
  return matched;
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

  const layers = normalizeUgcLayers(raw);
  if (!layers.spacedCollapsed && !layers.tokens) {
    return {
      decision: "allow",
      publicReason: null,
      auditReason: null,
      matchedRuleIds: [],
      severity: null,
    };
  }

  const contextAllow = hasContextAllow(layers);
  const rules = options.rules ?? UGC_KEYWORD_RULES;
  const matched: UgcKeywordRule[] = [];

  for (const rule of rules) {
    if (!ruleMatchesLayers(rule, layers)) continue;
    // Educational / medical context: suppress solitary "sex" token hits.
    if (
      contextAllow &&
      rule.phrase === "sex" &&
      rule.category === "sexual_solicitous"
    ) {
      continue;
    }
    matched.push(rule);
  }

  if (!options.skipEmbedded && !contextAllow) {
    matched.push(...collectEmbeddedMatches(layers));
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
      matchedRuleIds: [...new Set(matched.map((r) => r.id))],
      severity: top.severity,
    };
  }

  // review + spam → pending (hold for admin)
  return {
    decision: "pending",
    publicReason:
      "This content was held for review and is not publicly visible yet.",
    auditReason: `${top.severity}:${top.id}:${top.category}`,
    matchedRuleIds: [...new Set(matched.map((r) => r.id))],
    severity: top.severity,
  };
}

/** Combine multiple text fields (bio + website, etc.). */
export function evaluateUgcFields(
  fields: Array<{
    label: string;
    value: string | null | undefined;
    maxLength?: number;
  }>,
  options: EvaluateUgcOptions = {},
): UgcEvaluation {
  let worst: UgcEvaluation = {
    decision: "allow",
    publicReason: null,
    auditReason: null,
    matchedRuleIds: [],
    severity: null,
  };

  for (const field of fields) {
    const result = evaluateUgcText(field.value, {
      ...options,
      ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    });
    if (decisionRank(result.decision) > decisionRank(worst.decision)) {
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
