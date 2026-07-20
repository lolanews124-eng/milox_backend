import { randomInt } from "node:crypto";

const CODE_SUFFIX_MAX = 99;

export function referralCodePrefix(username: string): string {
  const cleaned = username.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned.slice(0, 4).padEnd(4, "X");
}

export function generateReferralCode(username: string): string {
  const prefix = referralCodePrefix(username);
  const suffix = randomInt(10, CODE_SUFFIX_MAX + 1).toString();
  return `${prefix}${suffix}`;
}

export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

export function referralInviteUrl(
  webOrigin: string,
  code: string,
): string {
  const base = webOrigin.replace(/\/$/, "");
  return `${base}/invite/${encodeURIComponent(code)}`;
}
