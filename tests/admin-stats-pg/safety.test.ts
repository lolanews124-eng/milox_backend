import { describe, expect, it } from "vitest";

import { assertSafeAdminStatsDatabaseUrl } from "./safety.js";

describe("assertSafeAdminStatsDatabaseUrl", () => {
  it("requires a URL", () => {
    expect(() => assertSafeAdminStatsDatabaseUrl(undefined)).toThrow(
      /ADMIN_STATS_DATABASE_URL/,
    );
  });

  it("blocks remote hosts", () => {
    expect(() =>
      assertSafeAdminStatsDatabaseUrl(
        "postgresql://u:p@db.milox.in:5432/milox_admin_stats_e2e",
      ),
    ).toThrow(/loopback|remote|production/i);
  });

  it("blocks milox_bots_e2e", () => {
    expect(() =>
      assertSafeAdminStatsDatabaseUrl(
        "postgresql://u:p@127.0.0.1:5432/milox_bots_e2e",
      ),
    ).toThrow(/milox_admin_stats_e2e/);
  });
});
