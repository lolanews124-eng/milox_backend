#!/usr/bin/env tsx
/**
 * Create or promote a SUPER_ADMIN staff account (production-safe CLI).
 *
 * Create new account:
 *   npm run admin:create-super -- --email you@company.com --username superadmin --password 'YourSecurePass123!'
 *
 * Or use env vars (password avoids shell history):
 *   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_USERNAME=... SUPER_ADMIN_PASSWORD=... npm run admin:create-super
 *
 * Promote an existing user by email:
 *   npm run admin:create-super -- --promote --email existing@user.com
 */
import { AgeRange, Gender, PrismaClient, UserRole, UserStatus } from "@prisma/client";
import argon2 from "argon2";
import "dotenv/config";
import { z } from "zod";

import { normalizeUsername } from "../src/modules/auth/application/services/auth-service.js";
import { AGE_RANGE_VALUES } from "../src/shared/contracts/age-ranges.js";
import { ageRangeSchema, countrySchema } from "../src/shared/contracts/profile-fields.js";

const prisma = new PrismaClient();

const passwordSchema = z.string().min(10).max(128);

const createArgsSchema = z
  .object({
    email: z.string().trim().email().max(255).transform((v) => v.toLowerCase()),
    username: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/),
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(80).optional(),
    country: countrySchema.default("United States"),
    gender: z
      .enum([
        "MALE",
        "FEMALE",
        "NON_BINARY",
        "OTHER",
        "PREFER_NOT_TO_SAY",
      ] as const)
      .default("PREFER_NOT_TO_SAY"),
    ageRange: ageRangeSchema.default("AGE_25_28"),
  })
  .strict();

const promoteArgsSchema = z
  .object({
    email: z.string().trim().email().max(255).transform((v) => v.toLowerCase()),
  })
  .strict();

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

function printHelp(): void {
  console.log(`Milox — create SUPER_ADMIN

Usage:
  npm run admin:create-super -- --email <email> --username <name> --password <pass>
  npm run admin:create-super -- --promote --email <email>

Options:
  --email           Login email (required)
  --username        Unique username, 3–32 chars [a-zA-Z0-9_] (create mode)
  --password        Min 10 chars (create mode; or SUPER_ADMIN_PASSWORD env)
  --display-name    Optional display name
  --country         Country name from app list (default: United States)
  --gender          MALE | FEMALE | NON_BINARY | OTHER | PREFER_NOT_TO_SAY
  --age-range       One of: ${AGE_RANGE_VALUES.join(", ")} (default: AGE_25_28)
  --promote         Promote existing user to SUPER_ADMIN instead of creating
  --help            Show this help

Environment (optional):
  SUPER_ADMIN_EMAIL, SUPER_ADMIN_USERNAME, SUPER_ADMIN_PASSWORD
  DATABASE_URL      Required (from .env)
`);
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseCreateInput(): z.infer<typeof createArgsSchema> {
  const email = readFlag("--email") ?? process.env.SUPER_ADMIN_EMAIL;
  const username = readFlag("--username") ?? process.env.SUPER_ADMIN_USERNAME;
  const password =
    readFlag("--password") ?? process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !username || !password) {
    throw new Error(
      "Create mode requires --email, --username, and --password (or SUPER_ADMIN_* env vars).",
    );
  }

  const genderRaw = readFlag("--gender");
  const ageRangeRaw = readFlag("--age-range");
  const countryRaw = readFlag("--country");
  const displayNameRaw = readFlag("--display-name");

  return createArgsSchema.parse({
    email,
    username,
    password,
    ...(displayNameRaw ? { displayName: displayNameRaw } : {}),
    ...(countryRaw ? { country: countryRaw } : {}),
    ...(genderRaw ? { gender: genderRaw } : {}),
    ...(ageRangeRaw ? { ageRange: ageRangeRaw } : {}),
  });
}

function parsePromoteInput(): z.infer<typeof promoteArgsSchema> {
  const email = readFlag("--email") ?? process.env.SUPER_ADMIN_EMAIL;
  if (!email) {
    throw new Error("Promote mode requires --email (or SUPER_ADMIN_EMAIL).");
  }
  return promoteArgsSchema.parse({ email });
}

async function createSuperAdmin(
  input: z.infer<typeof createArgsSchema>,
): Promise<void> {
  const usernameNormalized = normalizeUsername(input.username);
  const email = input.email;

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { usernameNormalized }],
    },
    select: { id: true, email: true, username: true, role: true },
  });

  if (existing) {
    throw new Error(
      `Account already exists (${existing.email} / @${existing.username}, role=${existing.role}). Use --promote to upgrade an existing user.`,
    );
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      username: input.username,
      usernameNormalized,
      email,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      ageRange: input.ageRange as AgeRange,
      gender: input.gender as Gender,
      country: input.country,
      displayName: input.displayName ?? "Super Admin",
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      emailVerifiedAt: true,
    },
  });

  console.log("Created SUPER_ADMIN:");
  console.log(`  id:       ${user.id}`);
  console.log(`  username: ${user.username}`);
  console.log(`  email:    ${user.email}`);
  console.log(`  role:     ${user.role}`);
  console.log(`  verified: ${user.emailVerifiedAt?.toISOString() ?? "no"}`);
  console.log("\nYou can sign in via the admin panel or POST /api/v1/auth/login.");
}

async function promoteSuperAdmin(
  input: z.infer<typeof promoteArgsSchema>,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      deletedAt: true,
    },
  });

  if (!user || user.deletedAt) {
    throw new Error(`No active user found with email ${input.email}.`);
  }

  if (user.role === UserRole.SUPER_ADMIN) {
    console.log(`User @${user.username} (${user.email}) is already SUPER_ADMIN.`);
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      emailVerifiedAt: true,
    },
  });

  console.log("Promoted to SUPER_ADMIN:");
  console.log(`  id:       ${updated.id}`);
  console.log(`  username: ${updated.username}`);
  console.log(`  email:    ${updated.email}`);
  console.log(`  role:     ${updated.role}`);
}

async function main(): Promise<void> {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Load apps/api/.env on the server.");
  }

  if (hasFlag("--promote")) {
    await promoteSuperAdmin(parsePromoteInput());
    return;
  }

  await createSuperAdmin(parseCreateInput());
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
