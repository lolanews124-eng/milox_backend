import { describe, expect, it, vi } from "vitest";

import { BotActivityPlanner } from "../src/modules/bots/application/bot-activity-planner.js";
import { BOTS_TEST_FIXTURE_MARKER } from "../src/modules/bots/application/bot-target-policy.js";

const tOlder = new Date("2026-01-01T00:00:00.000Z");
const tNewer = new Date("2026-01-02T00:00:00.000Z");

function postRow(
  id: string,
  createdAt: Date,
  authorActivity: Date = createdAt,
) {
  return {
    id,
    createdAt,
    author: { lastSeenAt: authorActivity, createdAt: tOlder },
  };
}

describe("bot planner target selection", () => {
  it("preview reports no_fixture_targets when marker posts/users are absent", async () => {
    const database = {
      botSettings: {
        findUnique: vi.fn().mockResolvedValue({
          killSwitch: false,
          globalPause: false,
          activityLimits: { likesEnabled: true, followsEnabled: true },
          commentTemplates: [],
        }),
      },
      botAccount: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "bot-1",
            user: { username: "bot_a", status: "ACTIVE" },
          },
        ]),
      },
      post: { count: vi.fn().mockResolvedValue(0) },
      user: { count: vi.fn().mockResolvedValue(0) },
    };

    const planner = new BotActivityPlanner(database as never, {
      targetPolicy: "test_fixtures_only",
    });
    const preview = await planner.previewUpcoming(10);

    expect(preview.eligiblePostCount).toBe(0);
    expect(preview.eligibleUserCount).toBe(0);
    expect(preview.fixturePostCount).toBe(0);
    expect(preview.templatesConfigured).toBe(0);
    expect(preview.sample[0]?.note).toBe("no_fixture_targets");
    expect(preview.sample[0]?.activityType).toBe("NONE");
  });

  it("preview under fresh_public reports no_eligible_targets without claiming eligibility", async () => {
    const database = {
      botSettings: {
        findUnique: vi.fn().mockResolvedValue({
          killSwitch: false,
          globalPause: false,
          activityLimits: { likesEnabled: true, followsEnabled: true },
          commentTemplates: ["nice"],
        }),
      },
      botAccount: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "bot-1",
            user: { username: "bot_a", status: "ACTIVE" },
          },
        ]),
      },
      post: { count: vi.fn().mockResolvedValue(0) },
      user: { count: vi.fn().mockResolvedValue(0) },
    };

    const planner = new BotActivityPlanner(database as never, {
      targetPolicy: "fresh_public",
    });
    const preview = await planner.previewUpcoming(10);
    expect(preview.eligiblePostCount).toBe(0);
    expect(preview.sample[0]?.note).toBe("no_eligible_targets");
    expect(preview.sample[0]?.activityType).toBe("NONE");
  });

  it("skips already-liked posts and enqueues the next ranked candidate", async () => {
    const created: string[] = [];
    const postA = "post-already-liked";
    const postB = "post-fresh";

    const database = {
      botSettings: {
        findUnique: vi.fn().mockResolvedValue({
          killSwitch: false,
          globalPause: false,
          activityLimits: {
            likesEnabled: true,
            commentsEnabled: false,
            followsEnabled: false,
            maxJobsPerTick: 5,
            maxGlobalLikesPerHour: 100,
          },
          commentTemplates: [],
        }),
      },
      botAccount: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "bot-1",
            userId: "bot-user-1",
            permissions: {
              likesEnabled: true,
              commentsEnabled: false,
              followsEnabled: false,
              maxLikesPerDay: 20,
            },
            user: { id: "bot-user-1", status: "ACTIVE", deletedAt: null },
          },
        ]),
      },
      botActivityJob: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(async ({ data }) => {
          created.push(data.targetId as string);
          return data;
        }),
      },
      post: {
        findMany: vi.fn().mockResolvedValue([
          postRow(postA, tNewer),
          postRow(postB, tOlder),
        ]),
        count: vi.fn().mockResolvedValue(2),
      },
      postLike: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.postId_userId.postId === postA) {
            return { postId: postA };
          }
          return null;
        }),
        count: vi.fn().mockResolvedValue(0),
      },
      comment: { count: vi.fn().mockResolvedValue(0) },
      follow: { count: vi.fn().mockResolvedValue(0) },
      user: { count: vi.fn().mockResolvedValue(0) },
    };

    const plannerLikedFirst = new BotActivityPlanner(database as never, {
      targetPolicy: "test_fixtures_only",
      forceActivityType: "LIKE_POST",
      preferTargetId: postA,
    });
    expect((await plannerLikedFirst.planTick()).enqueued).toBe(0);

    const plannerFresh = new BotActivityPlanner(database as never, {
      targetPolicy: "fresh_public",
      forceActivityType: "LIKE_POST",
    });
    const result = await plannerFresh.planTick();
    expect(result.enqueued).toBe(1);
    // Ranked newest-first; postA liked → fall through to postB.
    expect(created).toEqual([postB]);
    expect(database.botActivityJob.create).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(database.botActivityJob.create).mock.calls[0]?.[0]?.data
        ?.idempotencyKey,
    ).toBe(`like:bot-1:${postB}`);
  });

  it("fresh_public enqueues the newest eligible post without fixture markers", async () => {
    const created: string[] = [];
    const database = {
      botSettings: {
        findUnique: vi.fn().mockResolvedValue({
          killSwitch: false,
          globalPause: false,
          activityLimits: {
            likesEnabled: true,
            commentsEnabled: false,
            followsEnabled: false,
            maxJobsPerTick: 5,
            maxGlobalLikesPerHour: 100,
          },
          commentTemplates: [],
        }),
      },
      botAccount: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "bot-1",
            userId: "bot-user-1",
            permissions: {
              likesEnabled: true,
              commentsEnabled: false,
              followsEnabled: false,
              maxLikesPerDay: 20,
            },
            user: { id: "bot-user-1", status: "ACTIVE", deletedAt: null },
          },
        ]),
      },
      botActivityJob: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(async ({ data }) => {
          created.push(data.targetId as string);
          return data;
        }),
      },
      post: {
        findMany: vi.fn().mockResolvedValue([
          postRow("old", tOlder),
          postRow("new", tNewer),
        ]),
        count: vi.fn().mockResolvedValue(2),
      },
      postLike: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },
      comment: { count: vi.fn().mockResolvedValue(0) },
      follow: { count: vi.fn().mockResolvedValue(0) },
      user: { count: vi.fn().mockResolvedValue(0) },
    };

    const planner = new BotActivityPlanner(database as never, {
      targetPolicy: "fresh_public",
      forceActivityType: "LIKE_POST",
    });
    const result = await planner.planTick();
    expect(result.enqueued).toBe(1);
    expect(created).toEqual(["new"]);
    const whereArg = vi.mocked(database.post.findMany).mock.calls[0]?.[0]
      ?.where as { body?: unknown };
    expect(whereArg?.body).toBeUndefined();
  });

  it("inspectTargetCandidates lists eligible posts with reasons (read-only)", async () => {
    const database = {
      botSettings: {
        findUnique: vi.fn().mockResolvedValue({
          activityLimits: { excludePrivateAccounts: true },
        }),
      },
      post: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            postRow("new", tNewer),
            postRow("old", tOlder),
          ])
          .mockResolvedValueOnce([
            {
              id: "hidden",
              body: "x",
              createdAt: tNewer,
              deletedAt: null,
              isHidden: true,
              author: {
                username: "u1",
                status: "ACTIVE",
                deletedAt: null,
                isAutomatedAccount: false,
                isSystemAccount: false,
                isPrivateAccount: false,
              },
            },
            {
              ...postRow("new", tNewer),
              deletedAt: null,
              isHidden: false,
              body: "hello",
              author: {
                username: "author_a",
                status: "ACTIVE",
                deletedAt: null,
                isAutomatedAccount: false,
                isSystemAccount: false,
                isPrivateAccount: false,
              },
            },
          ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "user-1",
            username: "human_a",
            lastSeenAt: tNewer,
            createdAt: tOlder,
          },
        ]),
      },
    };

    const planner = new BotActivityPlanner(database as never, {
      targetPolicy: "fresh_public",
    });
    const inspect = await planner.inspectTargetCandidates(10);
    expect(inspect.policy).toBe("fresh_public");
    expect(inspect.eligiblePosts[0]?.id).toBe("new");
    expect(inspect.eligiblePosts[0]?.reasons).toContain("fresh_public_policy");
    expect(inspect.excludedPosts.some((row) => row.reasons.includes("post_hidden"))).toBe(
      true,
    );
    expect(inspect.eligibleUsers[0]?.username).toBe("human_a");
  });

  it("does not invent fixture markers in queries when policy is disabled", async () => {
    const database = {
      botSettings: {
        findUnique: vi.fn().mockResolvedValue({
          killSwitch: false,
          globalPause: false,
          activityLimits: {},
          commentTemplates: [],
        }),
      },
    };
    const planner = new BotActivityPlanner(database as never, {
      targetPolicy: "disabled",
    });
    const result = await planner.planTick();
    expect(result.enqueued).toBe(0);
    expect(BOTS_TEST_FIXTURE_MARKER).toContain("MILLOX_BOTS_TEST_FIXTURE");
  });
});
