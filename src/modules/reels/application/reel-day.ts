const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Midnight at the start of the current Asia/Kolkata calendar day. */
export function startOfIstDay(now = new Date()): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const utcMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(utcMidnight - IST_OFFSET_MS);
}

export const REELS_PER_DAY = 2;
