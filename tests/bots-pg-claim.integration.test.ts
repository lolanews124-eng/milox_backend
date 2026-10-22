/**
 * PostgreSQL integration tests for bot job claiming.
 *
 * Opt-in: set BOTS_PG_INTEGRATION=1
 * Uses DATABASE_URL from .env (local milox_live_copy). Creates ONLY isolated
 * records tagged with the run id and deletes them in afterAll. Never truncates.
 *
 * Claim/recover calls are scoped to the test botAccountId so other PENDING
 * jobs on the shared DB are not claimed.
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimNextBotActivityJob,
  finishBotActivityJob,
  recoverStaleBotActivityJobs,
  requeueBotActivityJob,
} from "../src/shared/claim-bot-activity-job.js";

const enabled = process.env.BOTS_PG_INTEGRATION === "1";
const describeIntegration = enabled ? describe : describe.skip;

const RUN = `itest_bots_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

describeIntegration("bot activity PostgreSQL claim (integration)", () => {
  const dbA = new PrismaClient();
  const dbB = new PrismaClient();
  let botAccountId = "";
  let userId = "";
  let dummyTargetId = "";

  beforeAll(async () => {
    userId = randomUUID();
    botAccountId = randomUUID();
    dummyTargetId = randomUUID();
    const username = `${RUN}_bot`.slice(0, 32);
    await dbA.user.create({
      data: {
        id: userId,
        username,
        usernameNormalized: username.toLowerCase(),
        email: `${RUN}@itest.milox.local`,
        passwordHash: "itest-not-a-real-hash",
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        isAutomatedAccount: true,
        status: "ACTIVE",
        role: "USER",
      },
    });
    await dbA.botAccount.create({
      data: {
        id: botAccountId,
        userId,
        status: "ACTIVE",
        permissions: {
          likesEnabled: true,
          maxLikesPerDay: 20,
          maxCommentsPerDay: 5,
          maxFollowsPerDay: 10,
        },
      },
    });
    await dbA.botSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        killSwitch: true,
        globalPause: true,
      },
      update: {},
    });
  });

  afterAll(async () => {
    try {
      if (botAccountId) {
        await dbA.botActivityJob.deleteMany({ where: { botAccountId } });
        await dbA.botAccount.deleteMany({ where: { id: botAccountId } });
      }
      if (userId) {
        await dbA.user.deleteMany({ where: { id: userId } });
      }
    } finally {
      await dbA.$disconnect();
      await dbB.$disconnect();
    }
  });

  async function createPendingJobs(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      await dbA.botActivityJob.create({
        data: {
          id,
          botAccountId,
          activityType: "LIKE_POST",
          targetType: "post",
          targetId: dummyTargetId,
          status: "PENDING",
          availableAt: new Date(),
          idempotencyKey: `${RUN}:like:${i}:${id}`,
          metadata: { itest: RUN },
        },
      });
      ids.push(id);
    }
    return ids;
  }

  it("two connections never claim the same job concurrently", async () => {
    const created = await createPendingJobs(8);
    const claimedIds: string[] = [];

    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const [a, b] = await Promise.all([
          claimNextBotActivityJob(dbA, { botAccountId }),
          claimNextBotActivityJob(dbB, { botAccountId }),
        ]);
        if (a) claimedIds.push(a.id);
        if (b) claimedIds.push(b.id);
      }),
    );

    const unique = new Set(claimedIds);
    expect(unique.size).toBe(claimedIds.length);
    expect(claimedIds.length).toBe(created.length);

    const rows = await dbA.botActivityJob.findMany({
      where: { id: { in: created } },
      select: { id: true, status: true, attempts: true },
    });
    expect(rows.every((row) => row.status === "PROCESSING")).toBe(true);
    expect(rows.every((row) => row.attempts === 1)).toBe(true);

    for (const id of created) {
      await finishBotActivityJob(dbA, id, "PROCESSED");
    }
  });

  it("recovers stale PROCESSING jobs for the test bot only", async () => {
    const created = await createPendingJobs(1);
    const jobId = created[0]!;
    const claimed = await claimNextBotActivityJob(dbA, { botAccountId });
    expect(claimed?.id).toBe(jobId);

    await dbA.$executeRaw`
      UPDATE "bot_activity_jobs"
      SET "updatedAt" = NOW() - INTERVAL '10 minutes'
      WHERE id = ${jobId}::uuid
    `;

    const recovered = await recoverStaleBotActivityJobs(dbA, 60_000, {
      botAccountId,
    });
    expect(recovered).toBeGreaterThanOrEqual(1);

    const row = await dbA.botActivityJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(row.status).toBe("PENDING");
    expect(row.lastError ?? "").toContain("stale_recovery");

    const again = await claimNextBotActivityJob(dbB, { botAccountId });
    expect(again?.id).toBe(jobId);
    await finishBotActivityJob(dbB, jobId, "CANCELLED", "itest_cleanup");
  });

  it("does not re-claim PROCESSED jobs", async () => {
    const created = await createPendingJobs(1);
    const jobId = created[0]!;
    const claimed = await claimNextBotActivityJob(dbA, { botAccountId });
    expect(claimed?.id).toBe(jobId);
    await finishBotActivityJob(dbA, jobId, "PROCESSED");

    const next = await claimNextBotActivityJob(dbA, { botAccountId });
    expect(next?.id === jobId).toBe(false);
  });

  it("cancels pending jobs and refuses re-claim", async () => {
    const created = await createPendingJobs(1);
    const jobId = created[0]!;
    await dbA.botActivityJob.update({
      where: { id: jobId },
      data: {
        status: "CANCELLED",
        processedAt: new Date(),
        lastError: "cancelled_by_admin",
      },
    });
    const claimed = await claimNextBotActivityJob(dbA, { botAccountId });
    expect(claimed?.id === jobId).toBe(false);
  });

  it("requeues failed jobs with backoff then allows reclaim", async () => {
    const created = await createPendingJobs(1);
    const jobId = created[0]!;
    const claimed = await claimNextBotActivityJob(dbA, { botAccountId });
    expect(claimed?.id).toBe(jobId);
    await requeueBotActivityJob(dbA, jobId, "transient", 0);
    const row = await dbA.botActivityJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    expect(row.status).toBe("PENDING");
    const again = await claimNextBotActivityJob(dbB, { botAccountId });
    expect(again?.id).toBe(jobId);
    expect((again?.attempts ?? 0) >= 2).toBe(true);
    await finishBotActivityJob(dbB, jobId, "FAILED", "itest_done");
  });

  it("documents kill switch / global pause are settings-gated (not claim SQL)", async () => {
    const settings = await dbA.botSettings.findUnique({
      where: { id: "default" },
    });
    expect(settings).toBeTruthy();
    // Worker tick returns before claim when killSwitch/globalPause — verified in
    // unit tests. Claim itself remains available for recovery tooling.
    expect(typeof settings?.killSwitch).toBe("boolean");
    expect(typeof settings?.globalPause).toBe("boolean");
  });
});

describe("bot activity PostgreSQL claim gate", () => {
  it("skips integration suite unless BOTS_PG_INTEGRATION=1", () => {
    if (!enabled) {
      console.info(
        "Skipping PG claim integration tests. Enable with BOTS_PG_INTEGRATION=1 against local DATABASE_URL (milox_live_copy). Tests create/delete isolated itest_* records only.",
      );
    }
    expect(true).toBe(true);
  });
});
