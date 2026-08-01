import { describe, expect, it } from "vitest";

import { visibleUserCardWhere } from "../src/modules/posts/infrastructure/post-query-policy.js";

describe("visibleUserCardWhere", () => {
  it("excludes staff and system accounts from public discovery", () => {
    expect(visibleUserCardWhere()).toMatchObject({
      status: "ACTIVE",
      deletedAt: null,
      role: "USER",
      isSystemAccount: false,
    });
  });
});
