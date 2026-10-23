/**
 * Conservative text normalization for keyword matching.
 * Avoids aggressive transforms that change ordinary word meaning.
 */

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060\u180E]/g;
const MULTI_SPACE = /\s+/g;
/** Treat punctuation as token separators so "horny, seducing" ≡ "horny seducing". */
const PUNCT_AS_SPACE = /[!?.,;:·•|/\\_+~^=#"'`()[\]{}<>]+/g;

/** Collapse runs of the same letter longer than 2 (sexxx → sexx) for bypass resistance. */
function collapseRepeatedLetters(input: string): string {
  return input.replace(/([a-z\u0900-\u097F])\1{2,}/gi, "$1$1");
}

/**
 * Normalize for matching: NFKC, lowercase, strip zero-width, punct → space.
 */
export function normalizeUgcText(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  let text = raw.normalize("NFKC");
  text = text.replace(ZERO_WIDTH, "");
  text = text.toLowerCase();
  // Common leetspeak / separators used to bypass filters (conservative).
  text = text
    .replace(/[@]/g, "a")
    .replace(/\$/g, "s")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/[|_./\\-]+/g, " ");
  text = text.replace(PUNCT_AS_SPACE, " ");
  text = collapseRepeatedLetters(text);
  text = text.replace(MULTI_SPACE, " ").trim();
  return text;
}

/**
 * True when `phrase` appears as whole token(s) in normalized text.
 * Prevents single-token rules (e.g. "horny") from matching inside longer words.
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
