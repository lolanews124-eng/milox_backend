/**
 * Safety gate for post-view PostgreSQL concurrency tests.
 * Refuses production hosts, milox_live_copy, and any DB other than milox_post_view_e2e.
 */

const ALLOWED_DB_NAMES = new Set(["milox_post_view_e2e"]);

const BLOCKED_HOST_FRAGMENTS = [
  "amazonaws.com",
  "neon.tech",
  "supabase.co",
  "railway.app",
  "render.com",
  "milox.in",
  "azure.com",
  "digitalocean.com",
];

const BLOCKED_DB_NAMES = new Set([
  "milox",
  "milox_live_copy",
  "milox_bots_e2e",
  "milox_admin_stats_e2e",
  "milox_production",
  "milox_prod",
  "production",
  "postgres",
]);

export type SafePostViewDatabase = {
  url: string;
  hostname: string;
  database: string;
};

export function assertSafePostViewDatabaseUrl(
  url: string | undefined,
): SafePostViewDatabase {
  if (!url || url.trim().length === 0) {
    throw new Error(
      "POST_VIEW_DATABASE_URL is required. Use dedicated local DB milox_post_view_e2e only.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("POST_VIEW_DATABASE_URL is not a valid URL");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `POST_VIEW_DATABASE_URL host "${hostname}" is not a local loopback address`,
    );
  }

  if (BLOCKED_HOST_FRAGMENTS.some((fragment) => hostname.includes(fragment))) {
    throw new Error(
      `POST_VIEW_DATABASE_URL host "${hostname}" looks remote/production; refused`,
    );
  }

  const database = parsed.pathname.replace(/^\//, "").split("?")[0] ?? "";
  if (!ALLOWED_DB_NAMES.has(database)) {
    throw new Error(
      `POST_VIEW_DATABASE_URL database must be exactly "milox_post_view_e2e" (got "${database}"). Refusing milox_live_copy and other shared DBs.`,
    );
  }

  if (BLOCKED_DB_NAMES.has(database)) {
    throw new Error(`Database "${database}" is blocked for post-view PG tests`);
  }

  return { url, hostname, database };
}

export function assertPostViewPgEnabled(): void {
  if (process.env.POST_VIEW_PG !== "1") {
    throw new Error(
      'Set POST_VIEW_PG=1 to run post-view concurrency tests against milox_post_view_e2e only.',
    );
  }
}
