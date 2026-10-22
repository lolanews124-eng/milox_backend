/**
 * Creates dedicated local database `milox_bots_e2e` and applies Prisma migrations.
 * Never targets milox_live_copy or remote hosts.
 *
 * Usage (PowerShell, from milox_backend):
 *   node scripts/setup-bots-e2e-db.mjs
 *
 * Credentials are taken from DATABASE_URL in .env (local postgres only).
 */
import "dotenv/config";
import { execFileSync, execSync } from "node:child_process";

const TARGET_DB = "milox_bots_e2e";

function parseLocalDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in .env for local admin connection.");
  }
  const url = new URL(databaseUrl);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`Refusing non-local host: ${url.hostname}`);
  }
  const database = url.pathname.replace(/^\//, "").split("?")[0] ?? "";
  if (database === TARGET_DB) {
    // Already pointing at e2e DB — still OK for migrate, but CREATE uses postgres.
  }
  if (database === "milox_live_copy") {
    console.warn(
      "Note: .env DATABASE_URL points at milox_live_copy; E2E DB will still be milox_bots_e2e only.",
    );
  }
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

const creds = parseLocalDatabaseUrl(process.env.DATABASE_URL);
const e2eUrl = `postgresql://${encodeURIComponent(creds.user)}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${TARGET_DB}?schema=public`;

const env = {
  ...process.env,
  PGPASSWORD: creds.password,
};

console.log(`Ensuring database "${TARGET_DB}" exists on ${creds.host}:${creds.port}…`);

try {
  execFileSync(
    "psql",
    [
      "-h",
      creds.host,
      "-p",
      creds.port,
      "-U",
      creds.user,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname='${TARGET_DB}'`,
    ],
    { env, encoding: "utf8" },
  );
} catch (error) {
  console.error("psql is required. Install PostgreSQL client tools.", error);
  process.exit(1);
}

const exists = execFileSync(
  "psql",
  [
    "-h",
    creds.host,
    "-p",
    creds.port,
    "-U",
    creds.user,
    "-d",
    "postgres",
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname='${TARGET_DB}'`,
  ],
  { env, encoding: "utf8" },
).trim();

if (exists !== "1") {
  execFileSync(
    "psql",
    [
      "-h",
      creds.host,
      "-p",
      creds.port,
      "-U",
      creds.user,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `CREATE DATABASE "${TARGET_DB}"`,
    ],
    { env, stdio: "inherit" },
  );
  console.log(`Created ${TARGET_DB}.`);
} else {
  console.log(`${TARGET_DB} already exists.`);
}

console.log("Applying Prisma migrations…");
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: e2eUrl },
});

console.log("");
console.log("Setup complete. Run actual execution E2E:");
console.log(`  $env:BOTS_E2E="1"`);
console.log(`  $env:BOTS_E2E_DATABASE_URL="${e2eUrl}"`);
console.log(
  "  npx vitest run tests/bots-e2e/bots-activity-execution.e2e.test.ts",
);
console.log("");
console.log("Do not point BOTS_E2E_DATABASE_URL at milox_live_copy or production.");
console.log("Do not set BOTS_WORKER_ENABLED=true in the main .env for this test.");
