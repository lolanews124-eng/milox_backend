export const IST_TIME_ZONE = "Asia/Kolkata";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight at the start of the current Asia/Kolkata calendar day, as a UTC instant. */
export function startOfIstDay(now = new Date()): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const utcMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(utcMidnight - IST_OFFSET_MS);
}

/** Calendar date in Asia/Kolkata, `YYYY-MM-DD`. */
export function istDateKey(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Inclusive start and exclusive end of an Asia/Kolkata calendar day. */
export function istDayRange(dateKey: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
  if (istDateKey(start) !== dateKey) return null;
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
