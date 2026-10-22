import { randomInt } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  assertBotDailyLimitAllows,
  readBotPermissions,
} from "./bot-daily-limits.js";
import {
  rankFreshPosts,
  rankFreshUsers,
} from "./bot-fresh-discovery.js";
import {
  readSchedulingFromActivityLimits,
  resolveActiveScheduleWindow,
} from "./bot-scheduling.js";
import {
  BOTS_TEST_FIXTURE_MARKER,
  type BotsTargetPolicy,
} from "./bot-target-policy.js";
import { DEFAULT_ACTIVITY_LIMITS } from "./bot-username.js";

export interface PlannerResult {
  enqueued: number;
  skippedBots: number;
}

/**
 * Optional scoping for isolated tests. Production leaves this unset so
 * selection remains the normal random/bounded path.
 */
export type BotActivityPlannerOptions = {
  /** Only consider this bot account (others are ignored for the tick). */
  scopeBotAccountId?: string;
  /** When eligible, use this activity type instead of a random pick. */
  forceActivityType?: "LIKE_POST" | "COMMENT_POST" | "FOLLOW_USER";
  /**
   * Prefer this post/user id when it appears in (or can be loaded into) the
   * eligible candidate pool. Does not bypass eligibility filters or target policy.
   */
  preferTargetId?: string;
  /**
   * Effective target policy from resolveBotsTargetPolicy(config).
   * Defaults to disabled (no enqueue).
   */
  targetPolicy?: BotsTargetPolicy;
};

type ActivityLimits = {
  likesEnabled: boolean;
  commentsEnabled: boolean;
  followsEnabled: boolean;
  viewsEnabled: boolean;
  plannerIntervalMs: number;
  maxJobsPerTick: number;
  maxGlobalLikesPerHour: number;
  maxGlobalCommentsPerHour: number;
  maxGlobalFollowsPerHour: number;
  excludePrivateAccounts: boolean;
  excludeAutomatedTargets: boolean;
} & Record<string, unknown>;

function readLimits(raw: unknown): ActivityLimits {
  const base: ActivityLimits = { ...DEFAULT_ACTIVITY_LIMITS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  return { ...base, ...(raw as Record<string, unknown>) };
}

function readTemplates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 280);
}

/** Prefer finite numbers including 0 — avoid `Number(x) || fallback` swallowing zero. */
function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Enqueues a bounded set of like/comment/follow jobs for ACTIVE bots.
 * Does nothing when kill switch / global pause is on.
 */
export class BotActivityPlanner {
  constructor(
    private readonly database: PrismaClient,
    private readonly options: BotActivityPlannerOptions = {},
  ) {}

  async planTick(): Promise<PlannerResult> {
    const settings = await this.database.botSettings.findUnique({
      where: { id: "default" },
    });
    if (!settings || settings.killSwitch || settings.globalPause) {
      return { enqueued: 0, skippedBots: 0 };
    }

    const targetPolicy = this.options.targetPolicy ?? "disabled";
    if (targetPolicy === "disabled") {
      return { enqueued: 0, skippedBots: 0 };
    }

    const limits = readLimits(settings.activityLimits);
    const scheduling = readSchedulingFromActivityLimits(settings.activityLimits);
    const activeWindow = resolveActiveScheduleWindow(new Date(), scheduling);
    // When scheduling is enabled, only enqueue inside the current window.
    // Missed windows are skipped (no backlog catch-up).
    if (scheduling.enabled && !activeWindow) {
      return { enqueued: 0, skippedBots: 0 };
    }

    const templates = readTemplates(settings.commentTemplates);
    let maxJobs = Math.min(Math.max(finiteOr(limits.maxJobsPerTick, 20), 1), 50);
    if (activeWindow) {
      maxJobs = Math.min(maxJobs, Math.max(0, activeWindow.window.maxJobs));
      if (maxJobs === 0) return { enqueued: 0, skippedBots: 0 };
    }
    const botTake = activeWindow
      ? Math.min(100, Math.max(0, activeWindow.window.accountQuota))
      : 100;
    if (botTake === 0) return { enqueued: 0, skippedBots: 0 };

    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const [likesHour, commentsHour, followsHour] = await Promise.all([
      this.countRecent("LIKE_POST", hourAgo),
      this.countRecent("COMMENT_POST", hourAgo),
      this.countRecent("FOLLOW_USER", hourAgo),
    ]);

    const bots = await this.database.botAccount.findMany({
      where: {
        status: "ACTIVE",
        ...(this.options.scopeBotAccountId
          ? { id: this.options.scopeBotAccountId }
          : {}),
      },
      include: {
        user: {
          select: { id: true, status: true, deletedAt: true },
        },
      },
      take: botTake,
      orderBy: { updatedAt: "asc" },
    });

    let enqueued = 0;
    let skippedBots = 0;
    let likesBudget =
      finiteOr(limits.maxGlobalLikesPerHour, 100) - likesHour;
    let commentsBudget =
      finiteOr(limits.maxGlobalCommentsPerHour, 40) - commentsHour;
    let followsBudget =
      finiteOr(limits.maxGlobalFollowsPerHour, 40) - followsHour;

    for (const bot of bots) {
      if (enqueued >= maxJobs) break;
      if (bot.user.status !== "ACTIVE" || bot.user.deletedAt) {
        skippedBots += 1;
        continue;
      }
      const permissions = readBotPermissions(bot.permissions);

      const scheduleAllowsLikes =
        !scheduling.enabled || scheduling.likesEnabled !== false;
      const scheduleAllowsComments =
        !scheduling.enabled || scheduling.commentsEnabled !== false;
      const scheduleAllowsFollows =
        !scheduling.enabled || scheduling.followsEnabled !== false;

      const types: Array<"LIKE_POST" | "COMMENT_POST" | "FOLLOW_USER"> = [];
      if (
        limits.likesEnabled !== false &&
        scheduleAllowsLikes &&
        permissions.likesEnabled &&
        likesBudget > 0
      ) {
        const allow = await assertBotDailyLimitAllows(this.database, {
          botAccountId: bot.id,
          botUserId: bot.userId,
          activityType: "LIKE_POST",
          permissions: bot.permissions,
        });
        if (allow.ok) types.push("LIKE_POST");
      }
      if (
        limits.commentsEnabled !== false &&
        scheduleAllowsComments &&
        permissions.commentsEnabled &&
        templates.length > 0 &&
        commentsBudget > 0
      ) {
        const allow = await assertBotDailyLimitAllows(this.database, {
          botAccountId: bot.id,
          botUserId: bot.userId,
          activityType: "COMMENT_POST",
          permissions: bot.permissions,
        });
        if (allow.ok) types.push("COMMENT_POST");
      }
      if (
        limits.followsEnabled !== false &&
        scheduleAllowsFollows &&
        permissions.followsEnabled &&
        followsBudget > 0
      ) {
        const allow = await assertBotDailyLimitAllows(this.database, {
          botAccountId: bot.id,
          botUserId: bot.userId,
          activityType: "FOLLOW_USER",
          permissions: bot.permissions,
        });
        if (allow.ok) types.push("FOLLOW_USER");
      }
      if (types.length === 0) {
        skippedBots += 1;
        continue;
      }

      const forced = this.options.forceActivityType;
      const pick =
        forced && types.includes(forced)
          ? forced
          : types[randomInt(0, types.length)]!;
      const created = await this.enqueueOne(
        bot.id,
        bot.userId,
        pick,
        templates,
        limits.excludePrivateAccounts !== false,
      );
      if (created) {
        enqueued += 1;
        if (pick === "LIKE_POST") likesBudget -= 1;
        if (pick === "COMMENT_POST") commentsBudget -= 1;
        if (pick === "FOLLOW_USER") followsBudget -= 1;
      }
    }

    return { enqueued, skippedBots };
  }

  /** Dry-run preview of what the next planner tick would consider. Never enqueues. */
  async previewUpcoming(limit = 20): Promise<{
    killSwitch: boolean;
    globalPause: boolean;
    activeBots: number;
    templatesConfigured: number;
    activityLimits: ActivityLimits;
    /** Eligible post targets for the active policy (0 when policy disabled). */
    eligiblePostCount: number;
    /** Eligible follow targets for the active policy. */
    eligibleUserCount: number;
    /** @deprecated alias of eligiblePostCount for older UI */
    fixturePostCount: number;
    /** @deprecated alias of eligibleUserCount for older UI */
    fixtureUserCount: number;
    sample: Array<{
      botAccountId: string;
      botUsername: string;
      activityType: string;
      note: string;
    }>;
  }> {
    const settings = await this.database.botSettings.findUnique({
      where: { id: "default" },
    });
    const limits = readLimits(settings?.activityLimits);
    const templates = readTemplates(settings?.commentTemplates);
    const targetPolicy = this.options.targetPolicy ?? "disabled";
    const excludePrivate = limits.excludePrivateAccounts !== false;

    const [bots, eligiblePostCount, eligibleUserCount] = await Promise.all([
      this.database.botAccount.findMany({
        where: { status: "ACTIVE" },
        include: { user: { select: { username: true, status: true } } },
        take: Math.min(Math.max(limit, 1), 50),
        orderBy: { updatedAt: "asc" },
      }),
      this.countEligiblePosts(targetPolicy, excludePrivate),
      this.countEligibleUsers(targetPolicy, excludePrivate),
    ]);

    const noPosts = targetPolicy !== "disabled" && eligiblePostCount === 0;
    const noUsers = targetPolicy !== "disabled" && eligibleUserCount === 0;

    const sample = bots
      .filter((bot) => bot.user.status === "ACTIVE")
      .slice(0, limit)
      .map((bot) => {
        const types: string[] = [];
        if (limits.likesEnabled !== false && !noPosts) types.push("LIKE_POST");
        if (
          limits.commentsEnabled !== false &&
          templates.length > 0 &&
          !noPosts
        ) {
          types.push("COMMENT_POST");
        }
        if (limits.followsEnabled !== false && !noUsers) {
          types.push("FOLLOW_USER");
        }
        let note = "eligible_for_bounded_enqueue";
        if (targetPolicy === "disabled") {
          note = "target_policy_disabled";
        } else if (types.length === 0) {
          const fixture = targetPolicy === "test_fixtures_only";
          if (noPosts && noUsers) {
            note = fixture ? "no_fixture_targets" : "no_eligible_targets";
          } else if (noPosts) {
            note = fixture ? "no_fixture_posts" : "no_eligible_posts";
          } else if (noUsers && limits.likesEnabled === false) {
            note = fixture
              ? "no_fixture_follow_targets"
              : "no_eligible_follow_targets";
          } else if (
            templates.length === 0 &&
            limits.likesEnabled === false &&
            limits.followsEnabled === false
          ) {
            note = "no_comment_templates";
          } else note = "no_enabled_actions";
        } else if (templates.length === 0) {
          note = "eligible_without_comment_templates";
        }
        return {
          botAccountId: bot.id,
          botUsername: bot.user.username,
          activityType: types[0] ?? "NONE",
          note,
        };
      });
    return {
      killSwitch: settings?.killSwitch ?? true,
      globalPause: settings?.globalPause ?? true,
      activeBots: bots.length,
      templatesConfigured: templates.length,
      activityLimits: limits,
      eligiblePostCount,
      eligibleUserCount,
      fixturePostCount: eligiblePostCount,
      fixtureUserCount: eligibleUserCount,
      sample,
    };
  }

  /**
   * Read-only inspection of ranked eligible targets and sample exclusions.
   * Does not create jobs or mutate domain rows.
   */
  async inspectTargetCandidates(limit = 20): Promise<{
    policy: BotsTargetPolicy;
    eligiblePosts: Array<{
      id: string;
      authorUsername: string;
      createdAt: string;
      authorActivityAt: string;
      bodyPreview: string;
      rank: number;
      reasons: string[];
    }>;
    eligibleUsers: Array<{
      id: string;
      username: string;
      createdAt: string;
      activityAt: string;
      rank: number;
      reasons: string[];
    }>;
    excludedPosts: Array<{
      id: string;
      authorUsername: string | null;
      createdAt: string;
      bodyPreview: string;
      reasons: string[];
    }>;
  }> {
    const policy = this.options.targetPolicy ?? "disabled";
    const take = Math.min(Math.max(limit, 1), 50);
    if (policy === "disabled") {
      return {
        policy,
        eligiblePosts: [],
        eligibleUsers: [],
        excludedPosts: [],
      };
    }

    const settings = await this.database.botSettings.findUnique({
      where: { id: "default" },
      select: { activityLimits: true },
    });
    const limits = readLimits(settings?.activityLimits);
    const excludePrivate = limits.excludePrivateAccounts !== false;
    const postWhere = this.postTargetWhere(policy, excludePrivate, null);
    const userWhere = this.userTargetWhere(policy, excludePrivate, null);

    const [posts, users, recentForExclusion] = await Promise.all([
      this.database.post.findMany({
        where: postWhere,
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: {
            select: {
              username: true,
              lastSeenAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 80,
      }),
      this.database.user.findMany({
        where: userWhere,
        select: {
          id: true,
          username: true,
          lastSeenAt: true,
          createdAt: true,
        },
        orderBy: [
          { lastSeenAt: { sort: "desc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        take: 80,
      }),
      this.database.post.findMany({
        where: {},
        select: {
          id: true,
          body: true,
          createdAt: true,
          deletedAt: true,
          isHidden: true,
          author: {
            select: {
              username: true,
              status: true,
              deletedAt: true,
              isAutomatedAccount: true,
              isSystemAccount: true,
              isPrivateAccount: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
    ]);

    const rankedPosts = rankFreshPosts(posts).slice(0, take);
    const eligiblePostIds = new Set(rankedPosts.map((row) => row.id));
    const eligiblePosts = rankedPosts.map((row, index) => {
      const source = posts.find((p) => p.id === row.id)!;
      const reasons = [
        "not_deleted",
        "not_hidden",
        "author_active_human_public",
        policy === "test_fixtures_only"
          ? "has_fixture_marker"
          : "fresh_public_policy",
        "ranked_by_post_createdAt_then_author_activity",
      ];
      return {
        id: row.id,
        authorUsername: source.author.username,
        createdAt: row.createdAt.toISOString(),
        authorActivityAt: row.authorActivityAt.toISOString(),
        bodyPreview: (source.body ?? "").slice(0, 120),
        rank: index + 1,
        reasons,
      };
    });

    const rankedUsers = rankFreshUsers(users).slice(0, take);
    const eligibleUsers = rankedUsers.map((row, index) => {
      const source = users.find((u) => u.id === row.id)!;
      return {
        id: row.id,
        username: source.username,
        createdAt: row.createdAt.toISOString(),
        activityAt: (row.lastSeenAt ?? row.createdAt).toISOString(),
        rank: index + 1,
        reasons: [
          "active_human_user",
          excludePrivate ? "not_private" : "private_allowed_by_settings",
          policy === "test_fixtures_only"
            ? "has_fixture_marker"
            : "fresh_public_policy",
          "ranked_by_activity_then_createdAt",
        ],
      };
    });

    const excludedPosts: Array<{
      id: string;
      authorUsername: string | null;
      createdAt: string;
      bodyPreview: string;
      reasons: string[];
    }> = [];
    for (const post of recentForExclusion) {
      if (eligiblePostIds.has(post.id)) continue;
      const reasons = this.explainPostExclusion(post, policy, excludePrivate);
      if (reasons.length === 0) continue;
      excludedPosts.push({
        id: post.id,
        authorUsername: post.author?.username ?? null,
        createdAt: post.createdAt.toISOString(),
        bodyPreview: (post.body ?? "").slice(0, 120),
        reasons,
      });
      if (excludedPosts.length >= take) break;
    }

    return { policy, eligiblePosts, eligibleUsers, excludedPosts };
  }

  private explainPostExclusion(
    post: {
      deletedAt: Date | null;
      isHidden: boolean;
      body: string | null;
      author: {
        status: string;
        deletedAt: Date | null;
        isAutomatedAccount: boolean;
        isSystemAccount: boolean;
        isPrivateAccount: boolean;
      } | null;
    },
    policy: BotsTargetPolicy,
    excludePrivate: boolean,
  ): string[] {
    const reasons: string[] = [];
    if (post.deletedAt) reasons.push("post_deleted");
    if (post.isHidden) reasons.push("post_hidden");
    const author = post.author;
    if (!author) {
      reasons.push("author_missing");
      return reasons;
    }
    if (author.deletedAt) reasons.push("author_deleted");
    if (author.status !== "ACTIVE") reasons.push(`author_status_${author.status.toLowerCase()}`);
    if (author.isAutomatedAccount) reasons.push("author_is_bot");
    if (author.isSystemAccount) reasons.push("author_is_system");
    if (excludePrivate && author.isPrivateAccount) {
      reasons.push("author_private");
    }
    if (
      policy === "test_fixtures_only" &&
      !(typeof post.body === "string" && post.body.includes(BOTS_TEST_FIXTURE_MARKER))
    ) {
      reasons.push("missing_fixture_marker");
    }
    if (reasons.length === 0 && policy === "disabled") {
      reasons.push("target_policy_disabled");
    }
    // Outside the ranked eligible pool for other reasons (e.g. not in top take).
    if (reasons.length === 0) {
      reasons.push("not_in_ranked_eligible_pool");
    }
    return reasons;
  }

  private async countEligiblePosts(
    policy: BotsTargetPolicy,
    excludePrivate: boolean,
  ): Promise<number> {
    if (policy === "disabled") return 0;
    return this.database.post.count({
      where: this.postTargetWhere(policy, excludePrivate, /*botUserId*/ null),
    });
  }

  private async countEligibleUsers(
    policy: BotsTargetPolicy,
    excludePrivate: boolean,
  ): Promise<number> {
    if (policy === "disabled") return 0;
    return this.database.user.count({
      where: this.userTargetWhere(policy, excludePrivate, /*botUserId*/ null),
    });
  }

  private postTargetWhere(
    policy: BotsTargetPolicy,
    excludePrivate: boolean,
    botUserId: string | null,
  ): Prisma.PostWhereInput {
    return {
      deletedAt: null,
      isHidden: false,
      ...(botUserId ? { authorId: { not: botUserId } } : {}),
      author: {
        status: "ACTIVE",
        deletedAt: null,
        isAutomatedAccount: false,
        isSystemAccount: false,
        ...(excludePrivate ? { isPrivateAccount: false } : {}),
      },
      ...(policy === "test_fixtures_only"
        ? { body: { contains: BOTS_TEST_FIXTURE_MARKER } }
        : {}),
    };
  }

  private userTargetWhere(
    policy: BotsTargetPolicy,
    excludePrivate: boolean,
    botUserId: string | null,
  ): Prisma.UserWhereInput {
    return {
      ...(botUserId ? { id: { not: botUserId } } : {}),
      status: "ACTIVE",
      deletedAt: null,
      isAutomatedAccount: false,
      isSystemAccount: false,
      role: "USER",
      ...(excludePrivate ? { isPrivateAccount: false } : {}),
      ...(policy === "test_fixtures_only"
        ? {
            OR: [
              { bio: { contains: BOTS_TEST_FIXTURE_MARKER } },
              { displayName: { contains: BOTS_TEST_FIXTURE_MARKER } },
            ],
          }
        : {}),
    };
  }

  private async countRecent(
    activityType: "LIKE_POST" | "COMMENT_POST" | "FOLLOW_USER",
    since: Date,
  ): Promise<number> {
    return this.database.botActivityJob.count({
      where: {
        activityType,
        createdAt: { gte: since },
        status: { in: ["PENDING", "PROCESSING", "PROCESSED"] },
      },
    });
  }

  private async enqueueOne(
    botAccountId: string,
    botUserId: string,
    activityType: "LIKE_POST" | "COMMENT_POST" | "FOLLOW_USER",
    templates: string[],
    excludePrivate: boolean,
  ): Promise<boolean> {
    const policy = this.options.targetPolicy ?? "disabled";
    if (policy === "disabled") return false;

    if (activityType === "LIKE_POST" || activityType === "COMMENT_POST") {
      const postWhere = this.postTargetWhere(policy, excludePrivate, botUserId);
      const posts = await this.database.post.findMany({
        where: postWhere,
        select: {
          id: true,
          createdAt: true,
          author: { select: { lastSeenAt: true, createdAt: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 80,
      });
      // Preserve fresh ranking; preferTargetId (tests) overrides when eligible.
      const rankedIds = rankFreshPosts(posts).map((row) => ({ id: row.id }));
      const ordered = await this.orderCandidates(rankedIds, postWhere);
      if (ordered.length === 0) return false;

      if (activityType === "LIKE_POST") {
        for (const post of ordered) {
          const already = await this.database.postLike.findUnique({
            where: { postId_userId: { postId: post.id, userId: botUserId } },
            select: { postId: true },
          });
          if (already) continue;
          const created = await this.createJob({
            botAccountId,
            activityType,
            targetType: "post",
            targetId: post.id,
            idempotencyKey: `like:${botAccountId}:${post.id}`,
            metadata: {},
          });
          if (created) return true;
        }
        return false;
      }

      const template = templates[randomInt(0, templates.length)]!;
      for (const post of ordered) {
        const created = await this.createJob({
          botAccountId,
          activityType,
          targetType: "post",
          targetId: post.id,
          idempotencyKey: `comment:${botAccountId}:${post.id}`,
          metadata: { body: template, templatePreview: template.slice(0, 80) },
        });
        if (created) return true;
      }
      return false;
    }

    const userWhere = this.userTargetWhere(policy, excludePrivate, botUserId);
    const targets = await this.database.user.findMany({
      where: userWhere,
      select: { id: true, lastSeenAt: true, createdAt: true },
      orderBy: [
        { lastSeenAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: 80,
    });
    const rankedIds = rankFreshUsers(targets).map((row) => ({ id: row.id }));
    const ordered = await this.orderCandidates(rankedIds, undefined, userWhere);
    for (const target of ordered) {
      const existingFollow = await this.database.follow.findUnique({
        where: {
          followerId_followeeId: {
            followerId: botUserId,
            followeeId: target.id,
          },
        },
        select: { id: true },
      });
      if (existingFollow) continue;
      const created = await this.createJob({
        botAccountId,
        activityType: "FOLLOW_USER",
        targetType: "user",
        targetId: target.id,
        idempotencyKey: `follow:${botAccountId}:${target.id}`,
        metadata: {},
      });
      if (created) return true;
    }
    return false;
  }

  /**
   * Candidate order for enqueue attempts. Preserves ranked pool order
   * (deterministic). When preferTargetId is set and eligible, try that alone.
   */
  private async orderCandidates(
    pool: Array<{ id: string }>,
    postWhere?: Prisma.PostWhereInput,
    userWhere?: Prisma.UserWhereInput,
  ): Promise<Array<{ id: string }>> {
    const preferred = this.options.preferTargetId;
    if (preferred) {
      const inPool = pool.find((row) => row.id === preferred);
      if (inPool) return [inPool];
      if (postWhere) {
        const row = await this.database.post.findFirst({
          where: { ...postWhere, id: preferred },
          select: { id: true },
        });
        return row ? [row] : [];
      }
      if (userWhere) {
        const row = await this.database.user.findFirst({
          where: { ...userWhere, id: preferred },
          select: { id: true },
        });
        return row ? [row] : [];
      }
      return [];
    }
    return pool;
  }

  private async createJob(input: {
    botAccountId: string;
    activityType: "LIKE_POST" | "COMMENT_POST" | "FOLLOW_USER";
    targetType: string;
    targetId: string;
    idempotencyKey: string;
    metadata: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      await this.database.botActivityJob.create({
        data: {
          botAccountId: input.botAccountId,
          activityType: input.activityType,
          targetType: input.targetType,
          targetId: input.targetId,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata as Prisma.InputJsonValue,
          status: "PENDING",
        },
      });
      return true;
    } catch {
      // Unique idempotencyKey → already enqueued / done
      return false;
    }
  }
}
