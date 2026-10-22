import { randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../src/config/env.js";
import { CommentService } from "../../src/modules/comments/application/services/comment-service.js";
import { PrismaCommentRepository } from "../../src/modules/comments/infrastructure/prisma-comment-repository.js";
import { FeedCursorCodec } from "../../src/modules/feed/application/services/feed-cursor.js";
import { FollowService } from "../../src/modules/follows/application/services/follow-service.js";
import { PrismaFollowRepository } from "../../src/modules/follows/infrastructure/prisma-follow-repository.js";
import { BotActivityExecutor } from "../../src/modules/bots/application/bot-activity-executor.js";
import {
  BOTS_TEST_FIXTURE_MARKER,
} from "../../src/modules/bots/application/bot-target-policy.js";
import { DEFAULT_BOT_PERMISSIONS } from "../../src/modules/bots/application/bot-username.js";
import { PostService } from "../../src/modules/posts/application/services/post-service.js";
import { PrismaPostRepository } from "../../src/modules/posts/infrastructure/prisma-post-repository.js";

export { BOTS_TEST_FIXTURE_MARKER };

export type E2eFixtures = {
  runId: string;
  botUserId: string;
  botAccountId: string;
  authorUserId: string;
  followTargetUserId: string;
  postId: string;
  botUsername: string;
  followTargetUsername: string;
};

export function createE2eServices(database: PrismaClient) {
  const config = {
    CURSOR_SIGNING_SECRET: "bots-e2e-cursor-signing-secret-32chars",
    JWT_ACCESS_SECRET: "bots-e2e-jwt-access-secret-32chars-xx",
    MILOX_ENV: "test",
    BOTS_TARGET_POLICY: "test_fixtures_only",
    BOTS_WORKER_ENABLED: false,
  } as AppConfig;
  const cursors = new FeedCursorCodec(config.CURSOR_SIGNING_SECRET!);
  const posts = new PostService(
    new PrismaPostRepository(database),
    cursors,
    config,
  );
  const comments = new CommentService(
    new PrismaCommentRepository(database),
    cursors,
    config,
  );
  const follows = new FollowService(
    new PrismaFollowRepository(database),
    cursors,
    config,
  );
  const executor = new BotActivityExecutor({
    database,
    posts,
    comments,
    follows,
    targetPolicy: "test_fixtures_only",
  });
  return { config, posts, comments, follows, executor, cursors };
}

export async function seedE2eFixtures(
  database: PrismaClient,
): Promise<E2eFixtures> {
  const runId = `e2e_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const botUserId = randomUUID();
  const botAccountId = randomUUID();
  const authorUserId = randomUUID();
  const followTargetUserId = randomUUID();
  const postId = randomUUID();
  const botUsername = `${runId}_bot`.slice(0, 32);
  const authorUsername = `${runId}_auth`.slice(0, 32);
  const followTargetUsername = `${runId}_tgt`.slice(0, 32);

  await database.botSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      killSwitch: false,
      globalPause: false,
      maxConcurrency: 2,
      commentTemplates: ["E2E approved comment template."],
      activityLimits: {
        likesEnabled: true,
        commentsEnabled: true,
        followsEnabled: true,
        viewsEnabled: false,
        maxJobsPerTick: 5,
        maxGlobalLikesPerHour: 50,
        maxGlobalCommentsPerHour: 50,
        maxGlobalFollowsPerHour: 50,
        plannerIntervalMs: 15_000,
      },
    },
    update: {
      killSwitch: false,
      globalPause: false,
      commentTemplates: ["E2E approved comment template."],
      activityLimits: {
        likesEnabled: true,
        commentsEnabled: true,
        followsEnabled: true,
        viewsEnabled: false,
        maxJobsPerTick: 5,
        maxGlobalLikesPerHour: 50,
        maxGlobalCommentsPerHour: 50,
        maxGlobalFollowsPerHour: 50,
        plannerIntervalMs: 15_000,
      },
    },
  });

  await database.user.create({
    data: {
      id: authorUserId,
      username: authorUsername,
      usernameNormalized: authorUsername.toLowerCase(),
      email: `${runId}_author@bots-e2e.local`,
      passwordHash: "e2e-not-a-login-hash",
      ageRange: "AGE_25_28",
      gender: "PREFER_NOT_TO_SAY",
      country: "India",
      status: "ACTIVE",
      role: "USER",
      isAutomatedAccount: false,
      isSystemAccount: false,
      isPrivateAccount: false,
      displayName: `E2E Author ${BOTS_TEST_FIXTURE_MARKER}`,
      bio: `Fixture author ${BOTS_TEST_FIXTURE_MARKER}`,
    },
  });

  await database.user.create({
    data: {
      id: followTargetUserId,
      username: followTargetUsername,
      usernameNormalized: followTargetUsername.toLowerCase(),
      email: `${runId}_target@bots-e2e.local`,
      passwordHash: "e2e-not-a-login-hash",
      ageRange: "AGE_25_28",
      gender: "PREFER_NOT_TO_SAY",
      country: "India",
      status: "ACTIVE",
      role: "USER",
      isAutomatedAccount: false,
      isSystemAccount: false,
      isPrivateAccount: false,
      displayName: `E2E Follow Target ${BOTS_TEST_FIXTURE_MARKER}`,
      bio: `Approved follow fixture ${BOTS_TEST_FIXTURE_MARKER}`,
    },
  });

  await database.user.create({
    data: {
      id: botUserId,
      username: botUsername,
      usernameNormalized: botUsername.toLowerCase(),
      email: `${runId}_bot@bots-e2e.local`,
      passwordHash: "e2e-not-a-login-hash",
      ageRange: "AGE_25_28",
      gender: "PREFER_NOT_TO_SAY",
      country: "India",
      status: "ACTIVE",
      role: "USER",
      isAutomatedAccount: true,
      isSystemAccount: false,
      isPrivateAccount: false,
      displayName: "E2E Automated Bot",
      bio: "Automated Milox E2E test account.",
    },
  });

  await database.botAccount.create({
    data: {
      id: botAccountId,
      userId: botUserId,
      status: "ACTIVE",
      permissions: {
        ...DEFAULT_BOT_PERMISSIONS,
        maxLikesPerDay: 5,
        maxCommentsPerDay: 5,
        maxFollowsPerDay: 5,
      },
    },
  });

  await database.post.create({
    data: {
      id: postId,
      authorId: authorUserId,
      body: `E2E isolated test post — not a real user post. ${BOTS_TEST_FIXTURE_MARKER}`,
      likeCount: 0,
      commentCount: 0,
    },
  });

  return {
    runId,
    botUserId,
    botAccountId,
    authorUserId,
    followTargetUserId,
    postId,
    botUsername,
    followTargetUsername,
  };
}

/** Deletes only rows created for this run (cascade via user deletes where possible). */
export async function cleanupE2eFixtures(
  database: PrismaClient,
  fixtures: E2eFixtures,
): Promise<void> {
  await database.botActivityJob.deleteMany({
    where: { botAccountId: fixtures.botAccountId },
  });
  await database.postLike.deleteMany({
    where: {
      OR: [{ userId: fixtures.botUserId }, { postId: fixtures.postId }],
    },
  });
  await database.comment.deleteMany({
    where: {
      OR: [{ authorId: fixtures.botUserId }, { postId: fixtures.postId }],
    },
  });
  await database.follow.deleteMany({
    where: {
      OR: [
        { followerId: fixtures.botUserId },
        { followeeId: fixtures.followTargetUserId },
      ],
    },
  });
  await database.post.deleteMany({ where: { id: fixtures.postId } });
  await database.botAccount.deleteMany({ where: { id: fixtures.botAccountId } });
  await database.user.deleteMany({
    where: {
      id: {
        in: [
          fixtures.botUserId,
          fixtures.authorUserId,
          fixtures.followTargetUserId,
        ],
      },
    },
  });
}

export async function createJob(
  database: PrismaClient,
  input: {
    botAccountId: string;
    activityType: "LIKE_POST" | "COMMENT_POST" | "FOLLOW_USER";
    targetType: string;
    targetId: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  },
) {
  return database.botActivityJob.create({
    data: {
      botAccountId: input.botAccountId,
      activityType: input.activityType,
      targetType: input.targetType,
      targetId: input.targetId,
      status: "PENDING",
      availableAt: new Date(),
      idempotencyKey: input.idempotencyKey,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
