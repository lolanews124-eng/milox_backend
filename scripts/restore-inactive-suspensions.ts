/**
 * Restore accounts suspended by the inactivity automation only.
 *
 * Identification requires AuditLog `system.user.inactive_suspended` plus a
 * matching inactivity banReason. Status alone is never enough.
 *
 * Default: dry-run (no writes).
 *   npm run users:restore-inactive-suspensions
 *   npx tsx scripts/restore-inactive-suspensions.ts
 *
 * Apply (requires explicit confirmation phrase):
 *   npm run users:restore-inactive-suspensions:apply
 *   npx tsx scripts/restore-inactive-suspensions.ts --apply --confirm=RESTORE_INACTIVE_SUSPENSIONS
 *
 * Options:
 *   --batch=100
 *   --max=50000
 *
 * Does not delete users or UGC. Does not revive revoked refresh tokens.
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import {
  describeDatabaseTarget,
  runInactiveAccountRestore,
} from "../src/modules/users/application/inactive-account-restore.js";

const CONFIRM_PHRASE = "RESTORE_INACTIVE_SUSPENSIONS";

const prisma = new PrismaClient();

function argNumber(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return fallback;
  const value = Number(hit.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const confirm = argValue("confirm");
  const target = describeDatabaseTarget(process.env.DATABASE_URL);

  console.log(`Database target: ${target}`);
  console.log(
    `Mode: ${apply ? "APPLY (writes)" : "DRY-RUN (no writes)"}`,
  );

  if (apply && confirm !== CONFIRM_PHRASE) {
    console.error(
      [
        "Refusing to apply: missing or incorrect confirmation phrase.",
        `Pass --confirm=${CONFIRM_PHRASE}`,
        "Dry-run first: npm run users:restore-inactive-suspensions",
      ].join("\n"),
    );
    process.exitCode = 2;
    return;
  }

  const result = await runInactiveAccountRestore(prisma, {
    apply,
    batchSize: argNumber("batch", 100),
    maxAccounts: argNumber("max", 50_000),
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.lockAcquired) {
    console.error(
      "Could not acquire advisory lock — another restore job may be running.",
    );
    process.exitCode = 2;
    return;
  }

  if (!apply) {
    console.log(
      `\nEligible for restoration: ${result.eligible}. Re-run with --apply --confirm=${CONFIRM_PHRASE} to apply.`,
    );
  } else {
    console.log(
      `\nRestored: ${result.restored}. Skipped: ${JSON.stringify(result.skipped)}.`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
