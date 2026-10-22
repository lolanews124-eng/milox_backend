/**
 * Safety gate for bot activity E2E tests.
 * Refuses production hosts and shared live-copy databases.
 */

const ALLOWED_DB_NAMES = new Set(["milox_bots_e2e"]);

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
  "milox_live_copy",
  "milox_production",
  "milox_prod",
  "production",
  "postgres",
]);

export type SafeE2eDatabase = {
  url: string;
  hostname: string;
  database: string;
};

export function assertSafeBotsE2eDatabaseUrl(
  url: string | undefined,
): SafeE2eDatabase {
  if (!url || url.trim().length === 0) {
    throw new Error(
      "BOTS_E2E_DATABASE_URL is required. Create dedicated DB milox_bots_e2e (see scripts/setup-bots-e2e-db.mjs).",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("BOTS_E2E_DATABASE_URL is not a valid URL");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `BOTS_E2E_DATABASE_URL host "${hostname}" is not a local loopback address`,
    );
  }

  if (BLOCKED_HOST_FRAGMENTS.some((fragment) => hostname.includes(fragment))) {
    throw new Error(
      `BOTS_E2E_DATABASE_URL host "${hostname}" looks remote/production; refused`,
    );
  }

  const database = parsed.pathname.replace(/^\//, "").split("?")[0] ?? "";
  if (!ALLOWED_DB_NAMES.has(database)) {
    throw new Error(
      `BOTS_E2E_DATABASE_URL database must be exactly "milox_bots_e2e" (got "${database}"). Refusing milox_live_copy and other shared DBs.`,
    );
  }

  if (BLOCKED_DB_NAMES.has(database)) {
    throw new Error(`Database "${database}" is blocked for bots E2E`);
  }

  return { url, hostname, database };
}

export function assertBotsE2eEnabled(): void {
  if (process.env.BOTS_E2E !== "1") {
    throw new Error(
      'Set BOTS_E2E=1 to run actual activity execution tests against milox_bots_e2e only.',
    );
  }
}
