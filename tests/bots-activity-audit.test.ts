import { describe, expect, it, vi } from "vitest";

import { writeBotJobProcessedAudit } from "../src/modules/bots/application/bot-activity-audit.js";

describe("writeBotJobProcessedAudit", () => {
  const job = {
    id: "job-1",
    botAccountId: "bot-1",
    activityType: "LIKE_POST",
    targetType: "post",
    targetId: "post-1",
  };

  it("writes bots.jobs.processed once for a successful activity", async () => {
    const database = {
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "audit-1" }),
      },
      botAccount: {
        findUnique: vi.fn().mockResolvedValue({ userId: "bot-user-1" }),
      },
    };

    await writeBotJobProcessedAudit(database as never, job, "liked");

    expect(database.auditLog.create).toHaveBeenCalledTimes(1);
    expect(database.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: "SYSTEM",
        actorUserId: "bot-user-1",
        action: "bots.jobs.processed",
        resourceType: "bot_activity_job",
        resourceId: "job-1",
        metadata: {
          activityType: "LIKE_POST",
          botAccountId: "bot-1",
          targetType: "post",
          targetId: "post-1",
          detail: "liked",
        },
      },
    });
  });

  it("does not duplicate when the job was already audited", async () => {
    const database = {
      auditLog: {
        findFirst: vi.fn().mockResolvedValue({ id: "existing" }),
        create: vi.fn(),
      },
      botAccount: {
        findUnique: vi.fn(),
      },
    };

    await writeBotJobProcessedAudit(database as never, job, "liked");

    expect(database.botAccount.findUnique).not.toHaveBeenCalled();
    expect(database.auditLog.create).not.toHaveBeenCalled();
  });
});
