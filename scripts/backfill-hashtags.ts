import { PrismaClient } from "@prisma/client";

import { extractHashtags } from "../src/shared/hashtags.js";

const prisma = new PrismaClient();

/** Rebuilds hashtag index from scratch for all visible posts. */
async function main(): Promise<void> {
  await prisma.postHashtag.deleteMany({});
  await prisma.hashtag.deleteMany({});

  const posts = await prisma.post.findMany({
    where: { deletedAt: null, isHidden: false, body: { not: null } },
    select: { id: true, body: true },
  });

  const counts = new Map<string, number>();
  const links: { postId: string; tag: string }[] = [];
  for (const post of posts) {
    for (const tag of extractHashtags(post.body)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
      links.push({ postId: post.id, tag });
    }
  }

  const idByTag = new Map<string, string>();
  for (const [tag, postCount] of counts) {
    const hashtag = await prisma.hashtag.create({
      data: { tag, postCount },
      select: { id: true },
    });
    idByTag.set(tag, hashtag.id);
  }

  await prisma.postHashtag.createMany({
    data: links.map((link) => ({
      postId: link.postId,
      hashtagId: idByTag.get(link.tag)!,
    })),
    skipDuplicates: true,
  });

  console.log(
    `Indexed ${counts.size} hashtags across ${posts.length} posts (${links.length} links).`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
