import { PrismaClient } from "@prisma/client";

import { ensureDefaultInterestTags } from "../src/infrastructure/interest-tags.js";
import { ensureLaunchBlogPost } from "../src/infrastructure/launch-blog-post.js";
import { ensureMiloxOfficialUser } from "../src/infrastructure/milox-official-user.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await ensureDefaultInterestTags(prisma);
  await ensureMiloxOfficialUser(prisma);
  const blog = await ensureLaunchBlogPost(prisma);
  console.log(`Launch blog: ${blog.slug} (${blog.created ? "created" : "updated"})`);
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
