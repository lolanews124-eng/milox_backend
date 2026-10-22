/**
 * Timezone-aware activity window configuration stored under
 * BotSettings.activityLimits.scheduling (JSON — no schema migration).
 *
 * Missed windows are skipped (no backlog catch-up). DST transitions use the
 * host Intl calendar for the configured IANA timezone.
 */

export const SCHEDULE_WINDOW_IDS = [
  "morning",
  "afternoon",
  "evening",
  "night",
] as const;

export type ScheduleWindowId = (typeof SCHEDULE_WINDOW_IDS)[number];

export type ScheduleWindowConfig = {
  enabled: boolean;
  /** Local wall-clock "HH:mm" (24h) in the configured timezone. */
  start: string;
  end: string;
  /** Soft allocation of eligible ACTIVE bots considered in this window. */
  accountQuota: number;
  /** Cap on jobs enqueued during this window's planner ticks. */
  maxJobs: number;
};

export type SchedulingConfig = {
  enabled: boolean;
  timezone: string;
  windows: Record<ScheduleWindowId, ScheduleWindowConfig>;
  likesEnabled: boolean;
  commentsEnabled: boolean;
  followsEnabled: boolean;
  defaultMaxLikesPerDay: number;
  defaultMaxCommentsPerDay: number;
  defaultMaxFollowsPerDay: number;
  /** Always skip missed windows — never execute a backlog unexpectedly. */
  missedWindowPolicy: "skip";
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_SCHEDULING: SchedulingConfig = {
  enabled: false,
  timezone: "Asia/Kolkata",
  windows: {
    morning: {
      enabled: true,
      start: "06:00",
      end: "11:00",
      accountQuota: 50,
      maxJobs: 50,
    },
    afternoon: {
      enabled: true,
      start: "11:00",
      end: "16:00",
      accountQuota: 50,
      maxJobs: 50,
    },
    evening: {
      enabled: true,
      start: "16:00",
      end: "21:00",
      accountQuota: 50,
      maxJobs: 50,
    },
    night: {
      enabled: true,
      start: "21:00",
      end: "06:00",
      accountQuota: 50,
      maxJobs: 50,
    },
  },
  likesEnabled: true,
  commentsEnabled: true,
  followsEnabled: true,
  defaultMaxLikesPerDay: 20,
  defaultMaxCommentsPerDay: 5,
  defaultMaxFollowsPerDay: 10,
  missedWindowPolicy: "skip",
};

function parseHm(value: string): number | null {
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes from midnight in the given IANA timezone (0–1439). */
export function zonedMinutesOfDay(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
    return hour * 60 + minute;
  } catch {
    // Invalid timezone → treat as UTC wall clock via ISO slice.
    const iso = now.toISOString();
    const hour = Number(iso.slice(11, 13));
    const minute = Number(iso.slice(14, 16));
    return hour * 60 + minute;
  }
}

/** Inclusive start, exclusive end; supports overnight windows (start > end). */
export function isWithinWindow(
  minutesOfDay: number,
  startHm: string,
  endHm: string,
): boolean {
  const start = parseHm(startHm);
  const end = parseHm(endHm);
  if (start == null || end == null) return false;
  if (start === end) return true; // full-day degenerate
  if (start < end) return minutesOfDay >= start && minutesOfDay < end;
  // Overnight: e.g. 21:00 → 06:00
  return minutesOfDay >= start || minutesOfDay < end;
}

export function mergeSchedulingConfig(raw: unknown): SchedulingConfig {
  const base: SchedulingConfig = structuredClone(DEFAULT_SCHEDULING);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const input = raw as Record<string, unknown>;

  if (typeof input.enabled === "boolean") base.enabled = input.enabled;
  if (typeof input.timezone === "string" && input.timezone.trim().length > 0) {
    base.timezone = input.timezone.trim().slice(0, 64);
  }
  if (typeof input.likesEnabled === "boolean") {
    base.likesEnabled = input.likesEnabled;
  }
  if (typeof input.commentsEnabled === "boolean") {
    base.commentsEnabled = input.commentsEnabled;
  }
  if (typeof input.followsEnabled === "boolean") {
    base.followsEnabled = input.followsEnabled;
  }
  for (const key of [
    "defaultMaxLikesPerDay",
    "defaultMaxCommentsPerDay",
    "defaultMaxFollowsPerDay",
  ] as const) {
    const n = Number(input[key]);
    if (Number.isFinite(n)) {
      base[key] = Math.min(500, Math.max(0, Math.trunc(n)));
    }
  }
  base.missedWindowPolicy = "skip";

  const windowsRaw =
    input.windows && typeof input.windows === "object" && !Array.isArray(input.windows)
      ? (input.windows as Record<string, unknown>)
      : {};
  for (const id of SCHEDULE_WINDOW_IDS) {
    const w = windowsRaw[id];
    if (!w || typeof w !== "object" || Array.isArray(w)) continue;
    const row = w as Record<string, unknown>;
    const target = base.windows[id];
    if (typeof row.enabled === "boolean") target.enabled = row.enabled;
    if (typeof row.start === "string" && TIME_RE.test(row.start.trim())) {
      target.start = row.start.trim();
    }
    if (typeof row.end === "string" && TIME_RE.test(row.end.trim())) {
      target.end = row.end.trim();
    }
    const quota = Number(row.accountQuota);
    if (Number.isFinite(quota)) {
      target.accountQuota = Math.min(200, Math.max(0, Math.trunc(quota)));
    }
    const maxJobs = Number(row.maxJobs);
    if (Number.isFinite(maxJobs)) {
      target.maxJobs = Math.min(200, Math.max(0, Math.trunc(maxJobs)));
    }
  }
  return base;
}

export function readSchedulingFromActivityLimits(
  activityLimits: unknown,
): SchedulingConfig {
  if (
    !activityLimits ||
    typeof activityLimits !== "object" ||
    Array.isArray(activityLimits)
  ) {
    return structuredClone(DEFAULT_SCHEDULING);
  }
  const scheduling = (activityLimits as Record<string, unknown>).scheduling;
  return mergeSchedulingConfig(scheduling);
}

export function resolveActiveScheduleWindow(
  now: Date,
  config: SchedulingConfig,
): { windowId: ScheduleWindowId; window: ScheduleWindowConfig } | null {
  if (!config.enabled) return null;
  const minutes = zonedMinutesOfDay(now, config.timezone);
  for (const id of SCHEDULE_WINDOW_IDS) {
    const window = config.windows[id];
    if (!window.enabled) continue;
    if (isWithinWindow(minutes, window.start, window.end)) {
      return { windowId: id, window };
    }
  }
  return null;
}

export type ScheduleWindowPreview = {
  windowId: ScheduleWindowId;
  enabled: boolean;
  start: string;
  end: string;
  accountQuota: number;
  maxJobs: number;
  /** Illustrative allocation: min(activeBots, accountQuota). */
  allocatedAccounts: number;
  isCurrent: boolean;
};

export function buildSchedulePreview(input: {
  scheduling: SchedulingConfig;
  activeBots: number;
  now?: Date;
}): {
  schedulingEnabled: boolean;
  timezone: string;
  currentWindowId: ScheduleWindowId | null;
  missedWindowPolicy: "skip";
  windows: ScheduleWindowPreview[];
} {
  const now = input.now ?? new Date();
  const active = resolveActiveScheduleWindow(now, input.scheduling);
  return {
    schedulingEnabled: input.scheduling.enabled,
    timezone: input.scheduling.timezone,
    currentWindowId: active?.windowId ?? null,
    missedWindowPolicy: "skip",
    windows: SCHEDULE_WINDOW_IDS.map((id) => {
      const w = input.scheduling.windows[id];
      return {
        windowId: id,
        enabled: w.enabled,
        start: w.start,
        end: w.end,
        accountQuota: w.accountQuota,
        maxJobs: w.maxJobs,
        allocatedAccounts: Math.min(
          Math.max(0, input.activeBots),
          w.accountQuota,
        ),
        isCurrent: active?.windowId === id,
      };
    }),
  };
}
