/**
 * Controlled FOLLOW_USER verification against milox_live_copy only.
 *
 * Reuses existing mlc_verify_* bot + author fixtures when present.
 * Does not re-run like/comment creation. Worker stays disabled.
 *
 *   node scripts/verify-live-copy-bot-follow.mjs
 */
import "dotenv/config";

import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);

function assertLiveCopy() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const db = parsed.pathname.replace(/^\//, "").split("?")[0];
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refuse non-local host: ${host}`);
  }
  if (db !== "milox_live_copy") {
    throw new Error(`Refuse database "${db}" — expected milox_live_copy`);
  }
  if (process.env.BOTS_WORKER_ENABLED === "true") {
    throw new Error("Refuse: BOTS_WORKER_ENABLED must stay false in .env");
  }
  return { url, host, db };
}

async function loadExecutor(database) {
  const distRoot = resolve(process.cwd(), "dist");
  const { FeedCursorCodec } = await import(
    pathToFileURL(
      resolve(distRoot, "modules/feed/application/services/feed-cursor.js"),
    ).href
  );
  const { PostService } = await import(
    pathToFileURL(
      resolve(distRoot, "modules/posts/application/services/post-service.js"),
    ).href
  );
  const { PrismaPostRepository } = await import(
    pathToFileURL(
      resolve(distRoot, "modules/posts/infrastructure/prisma-post-repository.js"),
    ).href
  );
  const { CommentService } = await import(
    pathToFileURL(
      resolve(
        distRoot,
        "modules/comments/application/services/comment-service.js",
      ),
    ).href
  );
  const { PrismaCommentRepository } = await import(
    pathToFileURL(
      resolve(
        distRoot,
        "modules/comments/infrastructure/prisma-comment-repository.js",
      ),
    ).href
  );
  const { FollowService } = await import(
    pathToFileURL(
      resolve(
        distRoot,
        "modules/follows/application/services/follow-service.js",
      ),
    ).href
  );
  const { PrismaFollowRepository } = await import(
    pathToFileURL(
      resolve(
        distRoot,
        "modules/follows/infrastructure/prisma-follow-repository.js",
      ),
    ).href
  );
  const { BotActivityExecutor } = await import(
    pathToFileURL(
      resolve(distRoot, "modules/bots/application/bot-activity-executor.js"),
    ).href
  );
  const claimMod = await import(
    pathToFileURL(resolve(distRoot, "shared/claim-bot-activity-job.js")).href
  );

  const config = {
    CURSOR_SIGNING_SECRET:
      process.env.CURSOR_SIGNING_SECRET ||
      "local-dev-cursor-signing-secret-32c",
    JWT_ACCESS_SECRET:
      process.env.JWT_ACCESS_SECRET ||
      "local-dev-jwt-access-secret-32chars-min",
  };
  const cursors = new FeedCursorCodec(config.CURSOR_SIGNING_SECRET);
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
  return {
    executor: new BotActivityExecutor({ database, posts, comments, follows }),
    claimNextBotActivityJob: claimMod.claimNextBotActivityJob,
    finishBotActivityJob: claimMod.finishBotActivityJob,
  };
}

async function main() {
  const target = assertLiveCopy();
  console.log("[follow-verify] database", target);

  const { PrismaClient } = await import("@prisma/client");
  const database = new PrismaClient();
  await database.$connect();

  let bot = await database.botAccount.findFirst({
    where: {
      status: "ACTIVE",
      user: {
        isAutomatedAccount: true,
        username: { startsWith: "mlc_verify_" },
      },
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          isAutomatedAccount: true,
          followingCount: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  let followTarget = bot
    ? await database.user.findFirst({
        where: {
          username: { startsWith: "mlc_verify_" },
          isAutomatedAccount: false,
          isSystemAccount: false,
          role: "USER",
          status: "ACTIVE",
          deletedAt: null,
          NOT: { id: bot.userId },
        },
        select: {
          id: true,
          username: true,
          followerCount: true,
          followingCount: true,
          isAutomatedAccount: true,
          isPrivateAccount: true,
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const marker = `mlc_follow_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let createdTarget = false;

  if (!bot) {
    throw new Error(
      "No mlc_verify_* ACTIVE bot found. Run verify-live-copy-bot-activity.mjs first, or create a marked bot.",
    );
  }

  if (!followTarget) {
    // Minimum isolated target only.
    const id = randomUUID();
    const username = `${marker}_tgt`.slice(0, 32);
    followTarget = await database.user.create({
      data: {
        id,
        username,
        usernameNormalized: username.toLowerCase(),
        email: `${marker}_tgt@milox-live-verify.local`,
        passwordHash: "mlc-verify-not-a-login",
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        status: "ACTIVE",
        role: "USER",
        isAutomatedAccount: false,
        isSystemAccount: false,
        isPrivateAccount: false,
        displayName: `MLC_VERIFY Follow Target ${marker}`,
        bio: "Dedicated local follow-verification fixture — not a real member.",
        followerCount: 0,
        followingCount: 0,
      },
      select: {
        id: true,
        username: true,
        followerCount: true,
        followingCount: true,
        isAutomatedAccount: true,
        isPrivateAccount: true,
      },
    });
    createdTarget = true;
    console.log("[follow-verify] created dedicated follow target", followTarget);
  }

  const existing = await database.follow.findFirst({
    where: { followerId: bot.userId, followeeId: followTarget.id },
  });
  if (existing) {
    throw new Error(
      `Bot already follows target (${existing.id} / ${existing.status}). Pick another fixture.`,
    );
  }

  // Narrow permission enablement for this bot only (was followsEnabled:false).
  const perms =
    bot.permissions &&
    typeof bot.permissions === "object" &&
    !Array.isArray(bot.permissions)
      ? { ...bot.permissions }
      : {};
  await database.botAccount.update({
    where: { id: bot.id },
    data: {
      permissions: {
        ...perms,
        followsEnabled: true,
        maxFollowsPerDay: 2,
      },
    },
  });

  const beforeBot = await database.user.findUniqueOrThrow({
    where: { id: bot.userId },
    select: { followingCount: true },
  });
  const beforeTarget = await database.user.findUniqueOrThrow({
    where: { id: followTarget.id },
    select: { followerCount: true },
  });

  console.log("[follow-verify] before counters", {
    botFollowing: beforeBot.followingCount,
    targetFollowers: beforeTarget.followerCount,
  });

  const { executor, claimNextBotActivityJob, finishBotActivityJob } =
    await loadExecutor(database);

  // Cancel other PENDING for this bot so claim is deterministic.
  await database.botActivityJob.updateMany({
    where: { botAccountId: bot.id, status: "PENDING" },
    data: { status: "CANCELLED", lastError: "mlc_follow_isolate" },
  });

  const followJob = await database.botActivityJob.create({
    data: {
      botAccountId: bot.id,
      activityType: "FOLLOW_USER",
      targetType: "user",
      targetId: followTarget.id,
      status: "PENDING",
      availableAt: new Date(),
      idempotencyKey: `${marker}:follow:1`,
      metadata: { marker, purpose: "mlc_follow_verify" },
    },
  });

  console.log("[follow-verify] claiming + executing FOLLOW_USER…");
  const claimed = await claimNextBotActivityJob(database, {
    botAccountId: bot.id,
  });
  if (!claimed || claimed.id !== followJob.id) {
    throw new Error(
      `Expected claim ${followJob.id}, got ${claimed?.id ?? "null"}`,
    );
  }
  const result = await executor.execute(claimed);
  if (result.outcome !== "processed") {
    throw new Error(`Follow failed: ${JSON.stringify(result)}`);
  }
  await finishBotActivityJob(database, claimed.id, "PROCESSED", undefined, {
    detail: result.detail ?? "followed",
    marker,
  });

  const relationship = await database.follow.findFirst({
    where: {
      followerId: bot.userId,
      followeeId: followTarget.id,
    },
  });
  if (!relationship || relationship.status !== "ACTIVE") {
    throw new Error(`Follow row missing or not ACTIVE: ${JSON.stringify(relationship)}`);
  }

  const afterBot = await database.user.findUniqueOrThrow({
    where: { id: bot.userId },
    select: { followingCount: true },
  });
  const afterTarget = await database.user.findUniqueOrThrow({
    where: { id: followTarget.id },
    select: { followerCount: true },
  });

  // Duplicate retry
  const dupJob = await database.botActivityJob.create({
    data: {
      botAccountId: bot.id,
      activityType: "FOLLOW_USER",
      targetType: "user",
      targetId: followTarget.id,
      status: "PENDING",
      availableAt: new Date(),
      idempotencyKey: `${marker}:follow:2`,
      metadata: { marker, purpose: "mlc_follow_dup" },
    },
  });
  const claimedDup = await claimNextBotActivityJob(database, {
    botAccountId: bot.id,
  });
  const dupResult = await executor.execute(claimedDup);
  await finishBotActivityJob(
    database,
    claimedDup.id,
    dupResult.outcome === "processed" ? "PROCESSED" : "SKIPPED",
    dupResult.outcome === "skipped" ? dupResult.reason : undefined,
    { marker, dup: true },
  );

  const followCount = await database.follow.count({
    where: {
      followerId: bot.userId,
      followeeId: followTarget.id,
      status: "ACTIVE",
    },
  });

  if (followCount !== 1) {
    throw new Error(`Expected exactly 1 ACTIVE follow, got ${followCount}`);
  }
  if (afterBot.followingCount !== beforeBot.followingCount) {
    throw new Error(
      `Bot followingCount changed ${beforeBot.followingCount} → ${afterBot.followingCount}`,
    );
  }
  if (afterTarget.followerCount !== beforeTarget.followerCount) {
    throw new Error(
      `Target followerCount changed ${beforeTarget.followerCount} → ${afterTarget.followerCount}`,
    );
  }

  // API check via temp admin (do not reuse passwords from prior runs).
  const argon2 = require("argon2");
  const adminUserId = randomUUID();
  const adminPassword = `Verify-${randomBytes(12).toString("base64url")}`;
  const adminEmail = `${marker}_admin@milox-live-verify.local`;
  const adminUsername = `mlcf_${adminUserId.replace(/-/g, "").slice(0, 8)}`;
  await database.user.create({
    data: {
      id: adminUserId,
      username: adminUsername,
      usernameNormalized: adminUsername.toLowerCase(),
      email: adminEmail,
      passwordHash: await argon2.hash(adminPassword, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      }),
      ageRange: "AGE_25_28",
      gender: "PREFER_NOT_TO_SAY",
      country: "India",
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      isAutomatedAccount: false,
      isSystemAccount: false,
      displayName: `MLC_VERIFY Follow Admin ${marker}`,
    },
  });

  const loginRes = await fetch("http://localhost:3001/api/v1/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Platform": "admin",
    },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const loginBody = await loginRes.json();
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginBody)}`);
  }
  const token = loginBody.data.accessToken;

  const jobsRes = await fetch(
    `http://localhost:3001/api/v1/admin/bots/jobs?limit=50&botAccountId=${bot.id}&activityType=FOLLOW_USER`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Client-Platform": "admin",
      },
    },
  );
  const jobsBody = await jobsRes.json();
  if (!jobsRes.ok) {
    throw new Error(`Jobs API failed: ${jobsRes.status} ${JSON.stringify(jobsBody)}`);
  }
  const followApi = (jobsBody.data?.items ?? []).find((j) => j.id === followJob.id);
  if (!followApi || followApi.status !== "PROCESSED") {
    throw new Error(`Jobs API missing PROCESSED follow job: ${JSON.stringify(followApi)}`);
  }

  const jobRow = await database.botActivityJob.findUniqueOrThrow({
    where: { id: followJob.id },
  });

  const evidence = {
    database: target.db,
    host: target.host,
    marker,
    reusedBot: true,
    createdFollowTarget: createdTarget,
    botAccountId: bot.id,
    botUserId: bot.userId,
    botUsername: bot.user.username,
    followTargetUserId: followTarget.id,
    followTargetUsername: followTarget.username,
    followJobId: followJob.id,
    followJobStatus: jobRow.status,
    followRelationshipId: relationship.id,
    followRelationshipStatus: relationship.status,
    countersBefore: {
      botFollowingCount: beforeBot.followingCount,
      targetFollowerCount: beforeTarget.followerCount,
    },
    countersAfter: {
      botFollowingCount: afterBot.followingCount,
      targetFollowerCount: afterTarget.followerCount,
    },
    organicCountersUnchanged: true,
    duplicateRetry: dupResult,
    activeFollowCount: followCount,
    jobsApiReturnedFollow: true,
    jobsApiSample: followApi,
    browserUiVerified: false,
    workerRemainsDisabled: true,
    killSwitchUntouched: true,
    dashboardHint:
      "Refresh http://localhost:3003/jobs — expect FOLLOW_USER PROCESSED for @" +
      bot.user.username,
  };

  writeFileSync(
    resolve("tests/bots-e2e/last-live-copy-follow-evidence.json"),
    JSON.stringify(evidence, null, 2),
    "utf8",
  );

  console.log("\n=== FOLLOW EVIDENCE ===");
  console.log(JSON.stringify(evidence, null, 2));
  console.log(
    "[follow-verify] Refresh http://localhost:3003/jobs and look for FOLLOW_USER / @" +
      bot.user.username,
  );

  await database.$disconnect();
}

main().catch((err) => {
  console.error("[follow-verify] FAILED", err);
  process.exitCode = 1;
});
