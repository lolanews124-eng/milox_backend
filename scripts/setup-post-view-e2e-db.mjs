/**
 * Creates dedicated local database `milox_post_view_e2e` and applies Prisma migrations.
 * Never targets milox_live_copy or remote hosts.
 *
 * Usage (PowerShell, from milox_backend):
 *   node scripts/setup-post-view-e2e-db.mjs
 *
 * Credentials are taken from DATABASE_URL in .env (local postgres only).
 */
import "dotenv/config";
import { execFileSync, execSync } from "node:child_process";

const TARGET_DB = "milox_post_view_e2e";

function parseLocalDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in .env for local admin connection.");
  }
  const url = new URL(databaseUrl);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`Refusing non-local host: ${url.hostname}`);
  }
  const database = url.pathname.replace(/^\//, "").split("?")[0] ?? "";
  if (database === "milox_live_copy") {
    console.warn(
      "Note: .env DATABASE_URL points at milox_live_copy; post-view E2E DB will still be milox_post_view_e2e only.",
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
    "-v",
    "ON_ERROR_STOP=1",
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname='${TARGET_DB}'`,
  ],
  { env, encoding: "utf8" },
).trim();

if (exists !== "1") {
  console.log(`Creating database ${TARGET_DB}…`);
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
    { env, encoding: "utf8", stdio: "inherit" },
  );
} else {
  console.log(`Database ${TARGET_DB} already exists.`);
}

console.log("Applying Prisma migrations…");
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: e2eUrl },
});

console.log("Done.");
console.log(`POST_VIEW_DATABASE_URL=${e2eUrl}`);
console.log('Set POST_VIEW_PG=1 and run: npx vitest run tests/post-view-pg/');
