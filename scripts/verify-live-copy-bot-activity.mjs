/**
 * Controlled like+comment verification against milox_live_copy only.
 *
 * - Does not change .env
 * - Does not enable BOTS_WORKER_ENABLED
 * - Creates marked fixture rows only (no real-user posts)
 * - Executes via real PostService / CommentService / BotActivityExecutor
 * - Confirms jobs via running API on :3001 (same path as dashboard)
 *
 * Run from milox_backend:
 *   node scripts/verify-live-copy-bot-activity.mjs
 */
import "dotenv/config";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

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

async function main() {
  const target = assertLiveCopy();
  console.log("[verify] database", target);

  // Prefer compiled dist if present; otherwise use tsx-less dynamic via vitest path.
  // Load Prisma from generated client.
  const { PrismaClient } = await import("@prisma/client");
  const database = new PrismaClient();
  await database.$connect();

  const marker = `mlc_verify_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const authorUserId = randomUUID();
  const botUserId = randomUUID();
  const botAccountId = randomUUID();
  const postId = randomUUID();
  const adminUserId = randomUUID();
  const botUsername = `${marker}_bot`.slice(0, 32);
  const authorUsername = `${marker}_auth`.slice(0, 32);
  const adminUsername = `mlcv_${adminUserId.replace(/-/g, "").slice(0, 8)}`;
  const adminEmail = `${marker}_admin@milox-live-verify.local`;
  const adminPassword = `Verify-${randomBytes(12).toString("base64url")}`;

  // Hash password the same way as CryptoService (argon2id).
  const argon2 = require("argon2");
  const passwordHash = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  console.log("[verify] creating marked fixtures only…");

  await database.user.create({
    data: {
      id: authorUserId,
      username: authorUsername,
      usernameNormalized: authorUsername.toLowerCase(),
      email: `${marker}_author@milox-live-verify.local`,
      passwordHash: "mlc-verify-not-a-login",
      ageRange: "AGE_25_28",
      gender: "PREFER_NOT_TO_SAY",
      country: "India",
      status: "ACTIVE",
      role: "USER",
      isAutomatedAccount: false,
      isSystemAccount: false,
      displayName: `MLC_VERIFY Author ${marker}`,
      bio: "Dedicated local verification fixture — not a real member post owner.",
    },
  });

  await database.user.create({
    data: {
      id: botUserId,
      username: botUsername,
      usernameNormalized: botUsername.toLowerCase(),
      email: `${marker}_bot@milox-live-verify.local`,
      passwordHash: "mlc-verify-not-a-login",
      ageRange: "AGE_25_28",
      gender: "PREFER_NOT_TO_SAY",
      country: "India",
      status: "ACTIVE",
      role: "USER",
      isAutomatedAccount: true,
      isSystemAccount: false,
      displayName: `MLC_VERIFY Bot ${marker}`,
      bio: "Automated Milox local verification account.",
      emailVerifiedAt: new Date(),
    },
  });

  await database.botAccount.create({
    data: {
      id: botAccountId,
      userId: botUserId,
      status: "ACTIVE",
      permissions: {
        likesEnabled: true,
        commentsEnabled: true,
        followsEnabled: false,
        viewsEnabled: false,
        maxLikesPerDay: 2,
        maxCommentsPerDay: 2,
        maxFollowsPerDay: 0,
      },
    },
  });

  await database.post.create({
    data: {
      id: postId,
      authorId: authorUserId,
      body: `MLC_VERIFY fixture post ${marker} — do not treat as a real user post.`,
      likeCount: 0,
      commentCount: 0,
    },
  });

  await database.user.create({
    data: {
      id: adminUserId,
      username: adminUsername,
      usernameNormalized: adminUsername.toLowerCase(),
      email: adminEmail,
      passwordHash,
      ageRange: "AGE_25_28",
      gender: "PREFER_NOT_TO_SAY",
      country: "India",
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      isAutomatedAccount: false,
      isSystemAccount: false,
      displayName: `MLC_VERIFY Admin ${marker}`,
    },
  });

  // Load domain services from compiled JS (tsx not required).
  const distRoot = resolve(process.cwd(), "dist");
  let posts;
  let comments;
  let executor;
  let claimNextBotActivityJob;
  let finishBotActivityJob;

  try {
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
        resolve(
          distRoot,
          "modules/posts/infrastructure/prisma-post-repository.js",
        ),
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
        resolve(
          distRoot,
          "modules/bots/application/bot-activity-executor.js",
        ),
      ).href
    );
    ({ claimNextBotActivityJob, finishBotActivityJob } = await import(
      pathToFileURL(resolve(distRoot, "shared/claim-bot-activity-job.js")).href
    ));

    const config = {
      CURSOR_SIGNING_SECRET:
        process.env.CURSOR_SIGNING_SECRET ||
        "local-dev-cursor-signing-secret-32c",
      JWT_ACCESS_SECRET:
        process.env.JWT_ACCESS_SECRET || "local-dev-jwt-access-secret-32chars-min",
    };
    const cursors = new FeedCursorCodec(config.CURSOR_SIGNING_SECRET);
    posts = new PostService(
      new PrismaPostRepository(database),
      cursors,
      config,
    );
    comments = new CommentService(
      new PrismaCommentRepository(database),
      cursors,
      config,
    );
    const follows = new FollowService(
      new PrismaFollowRepository(database),
      cursors,
      config,
    );
    executor = new BotActivityExecutor({
      database,
      posts,
      comments,
      follows,
    });
  } catch (err) {
    console.error(
      "[verify] Could not load dist/ domain modules. Building is required once, OR use the vitest harness.",
      err instanceof Error ? err.message : err,
    );
    await cleanupPartial(database, {
      adminUserId,
      botAccountId,
      botUserId,
      authorUserId,
      postId,
    });
    await database.$disconnect();
    process.exit(1);
  }

  const likeJob = await database.botActivityJob.create({
    data: {
      botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      status: "PENDING",
      availableAt: new Date(),
      idempotencyKey: `${marker}:like:1`,
      metadata: { marker, purpose: "mlc_verify" },
    },
  });
  const commentJob = await database.botActivityJob.create({
    data: {
      botAccountId,
      activityType: "COMMENT_POST",
      targetType: "post",
      targetId: postId,
      status: "PENDING",
      availableAt: new Date(),
      idempotencyKey: `${marker}:comment:1`,
      metadata: {
        marker,
        purpose: "mlc_verify",
        body: "MLC_VERIFY approved neutral comment.",
      },
    },
  });

  console.log("[verify] executing like via claim + BotActivityExecutor…");
  const claimedLike = await claimNextBotActivityJob(database, {
    botAccountId,
  });
  if (!claimedLike || claimedLike.id !== likeJob.id) {
    throw new Error(
      `Expected to claim like job ${likeJob.id}, got ${claimedLike?.id}`,
    );
  }
  const likeResult = await executor.execute(claimedLike);
  if (likeResult.outcome !== "processed") {
    throw new Error(`Like failed: ${JSON.stringify(likeResult)}`);
  }
  await finishBotActivityJob(database, claimedLike.id, "PROCESSED", undefined, {
    detail: likeResult.detail ?? "liked",
    marker,
  });

  console.log("[verify] executing comment via claim + BotActivityExecutor…");
  const claimedComment = await claimNextBotActivityJob(database, {
    botAccountId,
  });
  if (!claimedComment || claimedComment.id !== commentJob.id) {
    throw new Error(
      `Expected to claim comment job ${commentJob.id}, got ${claimedComment?.id}`,
    );
  }
  const commentResult = await executor.execute(claimedComment);
  if (commentResult.outcome !== "processed") {
    throw new Error(`Comment failed: ${JSON.stringify(commentResult)}`);
  }
  await finishBotActivityJob(
    database,
    claimedComment.id,
    "PROCESSED",
    undefined,
    { detail: commentResult.detail ?? "commented", marker },
  );

  // Duplicate like prevention
  const likeAgain = await database.botActivityJob.create({
    data: {
      botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      status: "PENDING",
      availableAt: new Date(),
      idempotencyKey: `${marker}:like:2`,
      metadata: { marker, purpose: "mlc_verify_dup" },
    },
  });
  const claimedDup = await claimNextBotActivityJob(database, { botAccountId });
  const dupResult = await executor.execute(claimedDup);
  await finishBotActivityJob(
    database,
    claimedDup.id,
    dupResult.outcome === "processed" ? "PROCESSED" : "SKIPPED",
    dupResult.outcome === "skipped" ? dupResult.reason : undefined,
    { marker, dup: true },
  );

  const likes = await database.postLike.count({
    where: { postId, userId: botUserId },
  });
  const commentsRows = await database.comment.findMany({
    where: { postId, authorId: botUserId, deletedAt: null },
    select: { id: true, body: true },
  });
  const post = await database.post.findUniqueOrThrow({
    where: { id: postId },
    select: { likeCount: true, commentCount: true },
  });
  const jobs = await database.botActivityJob.findMany({
    where: { id: { in: [likeJob.id, commentJob.id, likeAgain.id] } },
    select: {
      id: true,
      activityType: true,
      status: true,
      attempts: true,
      processedAt: true,
      targetId: true,
    },
  });

  console.log("[verify] domain persistence", {
    likes,
    comments: commentsRows,
    organic: post,
    jobs,
    dupResult,
  });

  if (likes !== 1) throw new Error(`Expected 1 like, got ${likes}`);
  if (commentsRows.length !== 1) {
    throw new Error(`Expected 1 comment, got ${commentsRows.length}`);
  }
  if (post.likeCount !== 0 || post.commentCount !== 0) {
    throw new Error("Organic counters were incremented — unexpected");
  }

  // Hit the running API (dashboard data path).
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
    console.error("[verify] login against :3001 failed", loginRes.status, loginBody);
    throw new Error("Could not login to running API — is milox_backend on :3001?");
  }
  const token = loginBody.data.accessToken;

  const jobsRes = await fetch(
    `http://localhost:3001/api/v1/admin/bots/jobs?limit=50&botAccountId=${botAccountId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Client-Platform": "admin",
      },
    },
  );
  const jobsBody = await jobsRes.json();
  if (!jobsRes.ok) {
    console.error("[verify] jobs API failed", jobsRes.status, jobsBody);
    throw new Error("Jobs API failed");
  }

  const items = jobsBody.data?.items ?? [];
  const likeApi = items.find((j) => j.id === likeJob.id);
  const commentApi = items.find((j) => j.id === commentJob.id);

  const evidence = {
    database: target.db,
    host: target.host,
    marker,
    botAccountId,
    botUserId,
    botUsername,
    authorUserId,
    postId,
    likeJobId: likeJob.id,
    commentJobId: commentJob.id,
    likeStatus: likeApi?.status ?? null,
    commentStatus: commentApi?.status ?? null,
    likes,
    commentBody: commentsRows[0]?.body,
    organicLikeCount: post.likeCount,
    organicCommentCount: post.commentCount,
    jobsApiTotalForBot: jobsBody.data?.total,
    jobsApiSample: [likeApi, commentApi],
    dashboardHint:
      "Refresh http://localhost:3003/jobs (API http://localhost:3001). Filter or search for bot username.",
    adminEmailForApiCheckOnly: adminEmail,
    note: "Admin password printed once below — local verify only. Worker remains false. killSwitch/globalPause left unchanged.",
  };

  console.log("\n=== EVIDENCE ===");
  console.log(JSON.stringify(evidence, null, 2));
  console.log("[verify] temp admin password (local only):", adminPassword);
  console.log(
    "[verify] Open Activity Jobs at http://localhost:3003/jobs — look for bot",
    botUsername,
  );

  // Fingerprint so we never invent success without DB rows
  const fingerprint = createHash("sha256")
    .update(`${likeJob.id}:${commentJob.id}:${likes}:${commentsRows.length}`)
    .digest("hex")
    .slice(0, 16);
  console.log("[verify] ok fingerprint", fingerprint);

  await database.$disconnect();
}

async function cleanupPartial(database, ids) {
  try {
    await database.botActivityJob.deleteMany({
      where: { botAccountId: ids.botAccountId },
    });
    await database.postLike.deleteMany({
      where: { OR: [{ userId: ids.botUserId }, { postId: ids.postId }] },
    });
    await database.comment.deleteMany({
      where: { OR: [{ authorId: ids.botUserId }, { postId: ids.postId }] },
    });
    await database.post.deleteMany({ where: { id: ids.postId } });
    await database.botAccount.deleteMany({ where: { id: ids.botAccountId } });
    await database.user.deleteMany({
      where: {
        id: { in: [ids.botUserId, ids.authorUserId, ids.adminUserId] },
      },
    });
  } catch {
    /* best-effort */
  }
}

main().catch(async (err) => {
  console.error("[verify] FAILED", err);
  process.exitCode = 1;
});
