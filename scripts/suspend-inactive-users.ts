/**
 * Suspend consumer accounts with no qualifying activity for N days (default 14).
 *
 * Default: dry-run (no writes).
 *   npx tsx scripts/suspend-inactive-users.ts
 *   npm run users:suspend-inactive
 *
 * Apply:
 *   npx tsx scripts/suspend-inactive-users.ts --apply
 *   npm run users:suspend-inactive:apply
 *
 * Options:
 *   --days=14
 *   --batch=100
 *   --max=5000
 *
 * Does not delete accounts or UGC. See inactive-account-policy.ts for signals.
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { DEFAULT_INACTIVE_ACCOUNT_DAYS } from "../src/modules/users/application/inactive-account-policy.js";
import { runInactiveAccountSuspension } from "../src/modules/users/application/inactive-account-suspension.js";

const prisma = new PrismaClient();

function argNumber(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return fallback;
  const value = Number(hit.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const result = await runInactiveAccountSuspension(prisma, {
    apply,
    inactiveDays: argNumber("days", DEFAULT_INACTIVE_ACCOUNT_DAYS),
    batchSize: argNumber("batch", 100),
    maxAccounts: argNumber("max", 5_000),
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.lockAcquired) {
    console.error(
      "Could not acquire advisory lock — another inactivity job may be running.",
    );
    process.exitCode = 2;
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
