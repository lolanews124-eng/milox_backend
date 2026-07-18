import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { ModerationRepository } from "../src/modules/moderation/application/ports/moderation-repository.js";
import {
  BlockConflictError,
  CannotBlockSelfError,
  ReportConflictError,
} from "../src/modules/moderation/application/ports/moderation-repository.js";
import { ModerationService } from "../src/modules/moderation/application/services/moderation-service.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "moderation-service-secret-32bytes!!",
} as AppConfig;
const blockerId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const targetId = "fca0622f-cba7-4398-bfe7-11842c026990";

describe("ModerationService", () => {
  it("normalizes usernames when blocking", async () => {
    const repository = createRepository();
    vi.mocked(repository.block).mockResolvedValue(true);

    await createService(repository).block(" NightBoy ", blockerId);

    expect(repository.block).toHaveBeenCalledWith("nightboy", blockerId);
  });

  it("maps self-block and duplicate block conflicts", async () => {
    const repository = createRepository();
    vi.mocked(repository.block)
      .mockRejectedValueOnce(new CannotBlockSelfError())
      .mockRejectedValueOnce(new BlockConflictError("already_blocked"));
    const service = createService(repository);

    await expect(service.block("me", blockerId)).rejects.toMatchObject({
      code: "CANNOT_BLOCK_SELF",
    });
    await expect(service.block("them", blockerId)).rejects.toMatchObject({
      code: "ALREADY_BLOCKED",
    });
  });

  it("rejects mismatched report target IDs before persistence", async () => {
    const repository = createRepository();
    await expect(
      createService(repository).createReport(blockerId, {
        targetType: "USER",
        reportedUserId: targetId,
        postId: "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e",
        reasonCode: "SPAM",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(repository.createReport).not.toHaveBeenCalled();
  });

  it("maps duplicate open reports", async () => {
    const repository = createRepository();
    vi.mocked(repository.createReport).mockRejectedValue(
      new ReportConflictError("already_reported"),
    );

    await expect(
      createService(repository).createReport(blockerId, {
        targetType: "USER",
        reportedUserId: targetId,
        reasonCode: "HARASSMENT",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_REPORTED" });
  });
});

function createService(repository: ModerationRepository) {
  return new ModerationService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
}

function createRepository(): ModerationRepository {
  return {
    block: vi.fn(),
    unblock: vi.fn(),
    listBlocks: vi.fn(),
    createReport: vi.fn(),
  };
}
