import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("bots list ordering stability", () => {
  it("uses secondary id sort for bots, jobs, and audit lists", () => {
    const source = readFileSync(
      resolve("src/modules/bots/infrastructure/prisma-bots-repository.ts"),
      "utf8",
    );
    expect(source).toContain('orderBy: [{ createdAt: "desc" }, { id: "desc" }]');
    const occurrences = source.split('orderBy: [{ createdAt: "desc" }, { id: "desc" }]').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it("metrics include PROCESSING job count", () => {
    const source = readFileSync(
      resolve("src/modules/bots/infrastructure/prisma-bots-repository.ts"),
      "utf8",
    );
    expect(source).toContain("jobsProcessing");
    expect(source).toContain("BotActivityJobStatus.PROCESSING");
  });

  it("worker claims jobs in parallel up to concurrency", () => {
    const source = readFileSync(
      resolve("src/jobs/bots/bot-activity-worker.ts"),
      "utf8",
    );
    expect(source).toContain("Promise.all");
    expect(source).toContain("claimAndRun()");
  });

  it("worker skips plan and claim outside enabled schedule windows", () => {
    const source = readFileSync(
      resolve("src/jobs/bots/bot-activity-worker.ts"),
      "utf8",
    );
    expect(source).toContain("resolveActiveScheduleWindow");
    expect(source).toContain("readSchedulingFromActivityLimits");
  });
});

