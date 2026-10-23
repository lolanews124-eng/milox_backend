/**
 * Layered, deterministic UGC text normalization for keyword matching.
 * Avoids a single giant / unbounded regex; each transform is local and testable.
 */

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060\u180E]/g;
const MULTI_SPACE = /\s+/g;
/** Treat punctuation as token separators so "horny, seducing" ≡ "horny seducing". */
const PUNCT_AS_SPACE = /[!?.,;:·•|/\\_+~^=#"'`()[\]{}<>]+/g;

/** Collapse runs of the same letter longer than 2 (sexxx → sexx) for display-ish form. */
function collapseRepeatedLettersSoft(input: string): string {
  return input.replace(/([a-z\u0900-\u097F])\1{2,}/gi, "$1$1");
}

/** Full collapse for matching only (sexxx → sex). */
function collapseRepeatedLettersHard(input: string): string {
  return input.replace(/([a-z\u0900-\u097F])\1+/gi, "$1");
}

function applyLeetspeakAndSeparators(text: string): string {
  return text
    .replace(/[@]/g, "a")
    .replace(/\$/g, "s")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/[|_./\\-]+/g, " ");
}

/**
 * Normalize for ordinary token matching: NFKC, lowercase, strip zero-width,
 * punct → space, soft letter collapse.
 */
export function normalizeUgcText(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  let text = raw.normalize("NFKC");
  text = text.replace(ZERO_WIDTH, "");
  text = text.toLowerCase();
  text = applyLeetspeakAndSeparators(text);
  text = text.replace(PUNCT_AS_SPACE, " ");
  text = collapseRepeatedLettersSoft(text);
  text = text.replace(MULTI_SPACE, " ").trim();
  return text;
}

/**
 * Merge runs of single-letter tokens so spaced evasion "s e x" → "sex".
 * Multi-letter tokens are left intact (Essex stays Essex).
 */
export function collapseSpacedLetterTokens(normalized: string): string {
  if (!normalized) return "";
  const tokens = normalized.split(" ");
  const out: string[] = [];
  let run = "";
  const flushRun = () => {
    if (run) {
      out.push(run);
      run = "";
    }
  };
  for (const token of tokens) {
    if (token.length === 1) {
      run += token;
    } else {
      flushRun();
      out.push(token);
    }
  }
  flushRun();
  return out.join(" ");
}

/**
 * Compact form: all spaces removed (after spaced-letter collapse + hard
 * letter collapse). Used for multi-word rules against joined text like
 * "sexchat" matching phrase "sex chat".
 */
export function normalizeUgcCompact(raw: string | null | undefined): string {
  const spaced = collapseSpacedLetterTokens(normalizeUgcText(raw));
  return collapseRepeatedLettersHard(spaced.replace(/\s+/g, ""));
}

export type UgcNormalizedLayers = {
  /** Soft-normalized, space-separated tokens. */
  tokens: string;
  /** After merging single-letter token runs ("s e x" → "sex"). */
  spacedCollapsed: string;
  /** No spaces; hard letter collapse — evasion / joined multi-word checks. */
  compact: string;
};

/** Build all matching layers from raw input once. */
export function normalizeUgcLayers(
  raw: string | null | undefined,
): UgcNormalizedLayers {
  const tokens = normalizeUgcText(raw);
  const spacedCollapsed = collapseRepeatedLettersHard(
    collapseSpacedLetterTokens(tokens),
  );
  const compact = spacedCollapsed.replace(/\s+/g, "");
  return { tokens, spacedCollapsed, compact };
}

/**
 * True when `phrase` appears as whole token(s) in normalized text.
 * Prevents single-token rules (e.g. "horny") from matching inside longer words
 * when only this helper is used.
 */
export function normalizedContainsPhrase(
  normalizedHaystack: string,
  normalizedPhrase: string,
): boolean {
  if (!normalizedHaystack || !normalizedPhrase) return false;
  if (!normalizedHaystack.includes(normalizedPhrase)) return false;
  const escaped = normalizedPhrase
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(normalizedHaystack);
}

/**
 * Config for carefully scoped joined-word / compound detection.
 * Prefer prefix/suffix compounds over arbitrary mid-token substrings so
 * "Essex" / "thorny" are not treated like "chatsex" / "hornymen".
 */
export type UgcEmbeddableStem = {
  stem: string;
  /**
   * Match `sex` + glue (e.g. sexchat) only when the remainder is in this set.
   * When omitted, any remainder with length >= prefixCompoundMinRest matches.
   */
  prefixGlue?: ReadonlySet<string>;
  /** Minimum remainder length for unrestricted prefix compounds. */
  prefixCompoundMinRest?: number;
  /** Match glue + stem (e.g. chatsex) when prefix length >= this. */
  suffixCompoundMinPrefix?: number;
  /** Whole tokens that must never count as embedded hits. */
  falsePositiveTokens?: ReadonlySet<string>;
};

/**
 * Detect stem as an exact token, or as a prefix/suffix compound inside a
 * longer alphabetic token. Does not use unbounded regexes.
 */
export function tokenHasEmbeddedStem(
  token: string,
  config: UgcEmbeddableStem,
): boolean {
  const stem = config.stem;
  if (!token || !stem || token.length < stem.length) return false;
  if (config.falsePositiveTokens?.has(token)) return false;
  if (token === stem) return true;

  if (token.startsWith(stem) && token.length > stem.length) {
    const rest = token.slice(stem.length);
    if (config.prefixGlue) {
      return config.prefixGlue.has(rest);
    }
    const minRest = config.prefixCompoundMinRest ?? 2;
    return rest.length >= minRest;
  }

  if (token.endsWith(stem) && token.length > stem.length) {
    const prefix = token.slice(0, token.length - stem.length);
    const minPrefix = config.suffixCompoundMinPrefix ?? 2;
    return prefix.length >= minPrefix;
  }

  return false;
}

/** Scan space-separated tokens for any embeddable stem hit. */
export function layersContainEmbeddedStem(
  layers: UgcNormalizedLayers,
  config: UgcEmbeddableStem,
): boolean {
  const haystacks = [layers.spacedCollapsed, layers.tokens];
  for (const haystack of haystacks) {
    if (!haystack) continue;
    for (const token of haystack.split(" ")) {
      if (tokenHasEmbeddedStem(token, config)) return true;
    }
  }
  return false;
}

const URL_RE =
  /https?:\/\/[^\s]+|www\.[^\s]+|(?:wa\.me|t\.me|bit\.ly|tinyurl\.com)\/[^\s]+/gi;

export function extractUrls(raw: string | null | undefined): string[] {
  if (typeof raw !== "string" || !raw) return [];
  const matches = raw.match(URL_RE) ?? [];
  return [...new Set(matches.map((u) => u.toLowerCase()))];
}

export function countUrlMentions(raw: string | null | undefined): number {
  return extractUrls(raw).length;
}

/** Sensible length caps (chars) — enforced before moderation. */
export const UGC_LENGTH_LIMITS = {
  bio: 500,
  postBody: 2000,
  comment: 1000,
  websiteUrl: 255,
  caption: 300,
} as const;
