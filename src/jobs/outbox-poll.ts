/**
 * Delay before the next outbox claim when the previous claim found no row.
 * Busy workers keep the configured interval. Idle workers back off so an
 * empty queue does not issue a claim on every short poll.
 */
export function nextOutboxPollDelay(
  baseMs: number,
  emptyStreak: number,
  capMs: number,
): number {
  if (emptyStreak <= 0) return baseMs;
  const scaled = baseMs * 2 ** Math.min(emptyStreak, 6);
  return Math.min(Math.max(scaled, baseMs), capMs);
}

export const CHAT_OUTBOX_IDLE_CAP_MS = 5_000;
export const NOTIFICATION_OUTBOX_IDLE_CAP_MS = 2_000;
export const OUTBOX_STALE_RECOVERY_MS = 5 * 60_000;
