import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, "..", ".data", "postgres");
const port = Number(process.env.LOCAL_PG_PORT ?? 5432);
const user = process.env.LOCAL_PG_USER ?? "milox";
const password = process.env.LOCAL_PG_PASSWORD ?? "milox_local";
const database = process.env.LOCAL_PG_DATABASE ?? "milox";

mkdirSync(dataDir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

const alreadyInitialized = existsSync(path.join(dataDir, "PG_VERSION"));

if (!alreadyInitialized) {
  console.log("Initializing embedded PostgreSQL cluster…");
  await pg.initialise();
}

console.log(`Starting PostgreSQL on port ${port}…`);
await pg.start();

try {
  await pg.createDatabase(database);
  console.log(`Created database "${database}".`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/already exists/i.test(message)) {
    console.warn(`createDatabase note: ${message}`);
  }
}

console.log("");
console.log("Embedded PostgreSQL is ready.");
console.log(
  `DATABASE_URL=postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`,
);
console.log("Keep this process running while you develop.");
console.log("Press Ctrl+C to stop.");

const keepAlive = setInterval(() => undefined, 60_000);

async function shutdown() {
  clearInterval(keepAlive);
  console.log("\nStopping PostgreSQL…");
  try {
    await pg.stop();
  } catch {
    // ignore shutdown races
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
