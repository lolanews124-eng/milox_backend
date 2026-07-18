import { PrismaClient } from "@prisma/client";

import { ensureDefaultInterestTags } from "../src/infrastructure/interest-tags.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await ensureDefaultInterestTags(prisma);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
