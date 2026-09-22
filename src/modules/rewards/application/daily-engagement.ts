import {
  Prisma,
  WalletTransactionType,
  type PrismaClient,
} from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";

export type DailyMissionId = "POST" | "INTEREST" | "CHAT";

export const DAILY_MISSION_POINTS = 10;
export const DAILY_MISSIONS_ALL_BONUS = 20;
export const STREAK_7_BADGE_POINTS = 100;
export const STREAK_7_DAYS = 7;

const MISSION_META: Record<
  DailyMissionId,
  { title: string; hint: string; cta: string }
> = {
  POST: {
    title: "Share a moment",
    hint: "Post a photo or thought on your feed",
    cta: "Create post",
  },
  INTEREST: {
    title: "Send an interest",
    hint: "Show interest in someone on Discover",
    cta: "Open Discover",
  },
  CHAT: {
    title: "Send a message",
    hint: "Say hi in any chat",
    cta: "Open Chat",
  },
};

export type DailyMissionView = {
  id: DailyMissionId;
  title: string;
  hint: string;
  cta: string;
  points: number;
  completed: boolean;
  rewarded: boolean;
};

export type DailyEngagementView = {
  dayKey: string;
  missions: DailyMissionView[];
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  allBonusPoints: number;
  allBonusClaimed: boolean;
  missionPointsEarnedToday: number;
  streakDays: number;
  streakBadge7Earned: boolean;
  streakBadge7Points: number;
  nextStreakBadgeAt: number | null;
};

function checkInDayKey(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function missionKey(userId: string, dayKey: string, mission: DailyMissionId) {
  return `daily-mission:${mission.toLowerCase()}:${userId}:${dayKey}`;
}

function missionBonusKey(userId: string, dayKey: string) {
  return `daily-mission:bonus:${userId}:${dayKey}`;
}

async function creditOnce(
  database: PrismaClient,
  input: {
    userId: string;
    amount: number;
    type: WalletTransactionType;
    idempotencyKey: string;
    referenceType: string;
    /** Must be a UUID when set — day keys are not valid here. */
    referenceId?: string | null;
    description: string;
  },
): Promise<{ awarded: boolean; balance: number | null; amount: number }> {
  const existing = await database.walletTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { balanceAfter: true, amount: true },
  });
  if (existing) {
    return {
      awarded: false,
      balance: existing.balanceAfter,
      amount: existing.amount,
    };
  }

  try {
    const result = await database.$transaction(async (tx) => {
      const wallet = await tx.wallet.update({
        where: { userId: input.userId },
        data: {
          balance: { increment: input.amount },
          lifetimeEarned: { increment: input.amount },
        },
        select: { balance: true },
      });
      await tx.walletTransaction.create({
        data: {
          walletUserId: input.userId,
          type: input.type,
          amount: input.amount,
          balanceAfter: wallet.balance,
          referenceType: input.referenceType,
          referenceId: input.referenceId ?? null,
          idempotencyKey: input.idempotencyKey,
          description: input.description,
        },
      });
      return wallet.balance;
    });
    return { awarded: true, balance: result, amount: input.amount };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { awarded: false, balance: null, amount: input.amount };
    }
    throw error;
  }
}

async function activityToday(
  database: PrismaClient,
  userId: string,
  timeZone: string,
  dayKey: string,
): Promise<Record<DailyMissionId, boolean>> {
  // Bound queries to ~this calendar day (±14h) instead of scanning 40h of rows.
  const dayStartGuess = zonedDayStartUtc(dayKey, timeZone);
  const since = new Date(dayStartGuess.getTime() - 2 * 60 * 60 * 1000);
  const until = new Date(dayStartGuess.getTime() + 28 * 60 * 60 * 1000);

  const [post, interest, message] = await Promise.all([
    database.post.findFirst({
      where: {
        authorId: userId,
        kind: "STANDARD",
        createdAt: { gte: since, lt: until },
        deletedAt: null,
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    database.interest.findFirst({
      where: {
        senderId: userId,
        createdAt: { gte: since, lt: until },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    database.message.findFirst({
      where: {
        senderId: userId,
        createdAt: { gte: since, lt: until },
        type: { in: ["TEXT", "IMAGE"] },
        deletedForEveryoneAt: null,
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const inDay = (row: { createdAt: Date } | null) =>
    row != null && checkInDayKey(row.createdAt, timeZone) === dayKey;

  return {
    POST: inDay(post),
    INTEREST: inDay(interest),
    CHAT: inDay(message),
  };
}

/** Approximate local-midnight UTC for YYYY-MM-DD in [timeZone]. */
function zonedDayStartUtc(dayKey: string, timeZone: string): Date {
  const [year, month, day] = dayKey.split("-").map((part) => Number(part));
  if (!year || !month || !day) return new Date();
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let i = 0; i < 36; i += 1) {
    const key = checkInDayKey(new Date(utc), timeZone);
    if (key === dayKey) {
      while (
        checkInDayKey(new Date(utc - 60_000), timeZone) === dayKey
      ) {
        utc -= 60_000;
      }
      return new Date(utc);
    }
    if (key > dayKey) utc -= 3_600_000;
    else utc += 3_600_000;
  }
  return new Date(utc);
}

async function rewardedToday(
  database: PrismaClient,
  userId: string,
  dayKey: string,
  options: { checkStreakBadge?: boolean } = {},
): Promise<Record<DailyMissionId, boolean> & { bonus: boolean; streak7: boolean }> {
  const keys = [
    missionKey(userId, dayKey, "POST"),
    missionKey(userId, dayKey, "INTEREST"),
    missionKey(userId, dayKey, "CHAT"),
    missionBonusKey(userId, dayKey),
  ];
  const rows = await database.walletTransaction.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { idempotencyKey: true },
  });
  const set = new Set(rows.map((row) => row.idempotencyKey));
  let streak7 = false;
  if (options.checkStreakBadge !== false) {
    const ever7 = await database.walletTransaction.findFirst({
      where: {
        walletUserId: userId,
        type: WalletTransactionType.STREAK_MILESTONE,
        referenceType: "streak_milestone_7",
      },
      select: { id: true },
    });
    streak7 = Boolean(ever7);
  }
  return {
    POST: set.has(missionKey(userId, dayKey, "POST")),
    INTEREST: set.has(missionKey(userId, dayKey, "INTEREST")),
    CHAT: set.has(missionKey(userId, dayKey, "CHAT")),
    bonus: set.has(missionBonusKey(userId, dayKey)),
    streak7,
  };
}

async function maybeAwardBonus(
  database: PrismaClient,
  userId: string,
  dayKey: string,
  rewarded: Record<DailyMissionId, boolean>,
): Promise<number> {
  if (!rewarded.POST || !rewarded.INTEREST || !rewarded.CHAT) return 0;
  const result = await creditOnce(database, {
    userId,
    amount: DAILY_MISSIONS_ALL_BONUS,
    type: WalletTransactionType.DAILY_MISSION,
    idempotencyKey: missionBonusKey(userId, dayKey),
    referenceType: "daily_mission_bonus",
    // referenceId is @db.Uuid — day keys are not UUIDs; uniqueness is idempotencyKey.
    referenceId: null,
    description: `Daily missions complete bonus (${dayKey})`,
  });
  return result.awarded ? result.amount : 0;
}

/** Credit mission points when the user completes an action (idempotent). */
export async function recordDailyMission(
  database: PrismaClient,
  config: AppConfig,
  userId: string,
  mission: DailyMissionId,
): Promise<{ awarded: number; bonusAwarded: number }> {
  const timeZone = config.DAILY_CHECK_IN_TIMEZONE;
  const dayKey = checkInDayKey(new Date(), timeZone);
  const labels: Record<DailyMissionId, string> = {
    POST: "Daily mission: post",
    INTEREST: "Daily mission: interest",
    CHAT: "Daily mission: chat",
  };
  const result = await creditOnce(database, {
    userId,
    amount: DAILY_MISSION_POINTS,
    type: WalletTransactionType.DAILY_MISSION,
    idempotencyKey: missionKey(userId, dayKey, mission),
    referenceType: `daily_mission_${mission.toLowerCase()}`,
    referenceId: null,
    description: `${labels[mission]} (${dayKey})`,
  });

  const rewarded = await rewardedToday(database, userId, dayKey);
  rewarded[mission] = true;
  const bonusAwarded = await maybeAwardBonus(database, userId, dayKey, rewarded);

  return {
    awarded: result.awarded ? result.amount : 0,
    bonusAwarded,
  };
}

/** Sync rewards from today's activity (covers missed hooks). */
export async function syncDailyMissions(
  database: PrismaClient,
  config: AppConfig,
  userId: string,
): Promise<void> {
  const timeZone = config.DAILY_CHECK_IN_TIMEZONE;
  const dayKey = checkInDayKey(new Date(), timeZone);
  const activity = await activityToday(database, userId, timeZone, dayKey);
  for (const mission of ["POST", "INTEREST", "CHAT"] as DailyMissionId[]) {
    if (activity[mission]) {
      await recordDailyMission(database, config, userId, mission);
    }
  }
}

export async function awardStreakMilestoneIfNeeded(
  database: PrismaClient,
  config: AppConfig,
  userId: string,
  streakDays: number,
): Promise<{ awarded: number; badge: string | null }> {
  if (streakDays < STREAK_7_DAYS) {
    return { awarded: 0, badge: null };
  }
  // Award for the current 7-day cycle (7, 14, 21…) even if the user
  // claims a day or two late within that streak (e.g. streak 8–13 still
  // unlocks the missed 7-day badge once).
  const cycle =
    Math.floor(streakDays / STREAK_7_DAYS) * STREAK_7_DAYS;
  if (cycle < STREAK_7_DAYS) {
    return { awarded: 0, badge: null };
  }
  const result = await creditOnce(database, {
    userId,
    amount: STREAK_7_BADGE_POINTS,
    type: WalletTransactionType.STREAK_MILESTONE,
    idempotencyKey: `streak-milestone:${cycle}:${userId}`,
    referenceType: "streak_milestone_7",
    referenceId: null,
    description: `${cycle}-day streak badge`,
  });
  return {
    awarded: result.awarded ? result.amount : 0,
    badge: result.awarded ? String(cycle) : null,
  };
}

export async function getDailyEngagement(
  database: PrismaClient,
  config: AppConfig,
  userId: string,
  streakDays: number,
  options: { sync?: boolean } = {},
): Promise<DailyEngagementView> {
  const sync = options.sync === true;
  if (sync) {
    await syncDailyMissions(database, config, userId);
  }

  const timeZone = config.DAILY_CHECK_IN_TIMEZONE;
  const dayKey = checkInDayKey(new Date(), timeZone);
  const rewarded = await rewardedToday(database, userId, dayKey, {
    checkStreakBadge: streakDays >= STREAK_7_DAYS,
  });
  // Fast path (wallet opens / Discover): trust already-credited mission txs.
  // Sync path (Milox Points): also scan today's activity for catch-up.
  const activity = sync
    ? await activityToday(database, userId, timeZone, dayKey)
    : {
        POST: rewarded.POST,
        INTEREST: rewarded.INTEREST,
        CHAT: rewarded.CHAT,
      };

  const missions: DailyMissionView[] = (
    ["POST", "INTEREST", "CHAT"] as DailyMissionId[]
  ).map((id) => {
    const meta = MISSION_META[id];
    const done = activity[id] || rewarded[id];
    return {
      id,
      title: meta.title,
      hint: meta.hint,
      cta: meta.cta,
      points: DAILY_MISSION_POINTS,
      completed: done,
      rewarded: rewarded[id],
    };
  });

  const completedCount = missions.filter((m) => m.completed).length;
  const missionPointsEarnedToday =
    missions.filter((m) => m.rewarded).length * DAILY_MISSION_POINTS +
    (rewarded.bonus ? DAILY_MISSIONS_ALL_BONUS : 0);

  const nextStreakBadgeAt =
    streakDays <= 0
      ? STREAK_7_DAYS
      : streakDays % STREAK_7_DAYS === 0
        ? streakDays + STREAK_7_DAYS
        : Math.ceil(streakDays / STREAK_7_DAYS) * STREAK_7_DAYS;

  return {
    dayKey,
    missions,
    completedCount,
    totalCount: missions.length,
    allComplete: completedCount === missions.length,
    allBonusPoints: DAILY_MISSIONS_ALL_BONUS,
    allBonusClaimed: rewarded.bonus,
    missionPointsEarnedToday,
    streakDays,
    streakBadge7Earned: rewarded.streak7 || streakDays >= STREAK_7_DAYS,
    streakBadge7Points: STREAK_7_BADGE_POINTS,
    nextStreakBadgeAt,
  };
}
