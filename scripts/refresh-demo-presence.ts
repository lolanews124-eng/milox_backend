import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Staggers demo accounts' lastSeenAt so a few show as online. */
async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@demo.milox" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true },
  });
  const now = Date.now();
  for (const [index, user] of users.entries()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date(now - index * 2 * 60_000) },
    });
  }
  console.log(`Refreshed presence for ${users.length} demo users.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
