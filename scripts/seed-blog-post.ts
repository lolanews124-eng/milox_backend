/**
 * Upsert the launch blog post so it appears in Admin → Blog and the public API.
 *
 * Usage (from apps/api, with DATABASE_URL set — local or production):
 *   npx tsx scripts/seed-blog-post.ts
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { ensureLaunchBlogPost } from "../src/infrastructure/launch-blog-post.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Run from apps/api with .env loaded.");
  }

  const prisma = new PrismaClient();
  try {
    const result = await ensureLaunchBlogPost(prisma);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
