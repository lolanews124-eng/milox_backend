export const REEL_REJECT_REASON_CODES = [
  "NUDITY",
  "VIOLENCE",
  "HATE",
  "SPAM",
  "MINOR",
  "COPYRIGHT",
  "OTHER",
] as const;

export const REEL_REJECT_REASONS = [
  { code: "NUDITY", label: "Nudity or sexual content" },
  { code: "VIOLENCE", label: "Violence or dangerous acts" },
  { code: "HATE", label: "Hate, bullying, or harassment" },
  { code: "SPAM", label: "Spam or misleading" },
  { code: "MINOR", label: "Involves a minor" },
  { code: "COPYRIGHT", label: "Copyright or someone else's content" },
  { code: "OTHER", label: "Breaks community rules" },
] as const;

export type ReelRejectReasonCode = (typeof REEL_REJECT_REASON_CODES)[number];

const labels = new Map<string, string>(
  REEL_REJECT_REASONS.map((reason) => [reason.code, reason.label]),
);

export function reelRejectReasonLabel(code: string): string {
  return labels.get(code) ?? code;
}
