import { describe, expect, it } from "vitest";

import {
  CHAT_OUTBOX_IDLE_CAP_MS,
  nextOutboxPollDelay,
} from "../src/jobs/outbox-poll.js";

describe("nextOutboxPollDelay", () => {
  it("keeps the busy interval until the queue goes empty", () => {
    expect(nextOutboxPollDelay(100, 0, CHAT_OUTBOX_IDLE_CAP_MS)).toBe(100);
  });

  it("backs off while idle and stops at the cap", () => {
    expect(nextOutboxPollDelay(100, 1, CHAT_OUTBOX_IDLE_CAP_MS)).toBe(200);
    expect(nextOutboxPollDelay(100, 2, CHAT_OUTBOX_IDLE_CAP_MS)).toBe(400);
    expect(nextOutboxPollDelay(100, 8, CHAT_OUTBOX_IDLE_CAP_MS)).toBe(
      CHAT_OUTBOX_IDLE_CAP_MS,
    );
  });
});
