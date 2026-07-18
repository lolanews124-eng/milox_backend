import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const fix = process.argv.includes("--fix");
  const users = await prisma.user.findMany({
    where: { email: { not: { endsWith: "@demo.milox" } } },
    select: {
      id: true,
      username: true,
      followerCount: true,
      followingCount: true,
      postCount: true,
    },
  });
  for (const user of users) {
    const [following, followers, posts] = await Promise.all([
      prisma.follow.count({
        where: { followerId: user.id, status: "ACTIVE" },
      }),
      prisma.follow.count({
        where: { followeeId: user.id, status: "ACTIVE" },
      }),
      prisma.post.count({ where: { authorId: user.id, deletedAt: null } }),
    ]);
    const drifted =
      user.followingCount !== following ||
      user.followerCount !== followers ||
      user.postCount !== posts;
    console.log(
      `${user.username}: stored following=${user.followingCount} actual=${following} | stored followers=${user.followerCount} actual=${followers} | stored posts=${user.postCount} actual=${posts}${drifted ? " [DRIFTED]" : ""}`,
    );
    if (fix && drifted) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          followingCount: following,
          followerCount: followers,
          postCount: posts,
        },
      });
      console.log(`${user.username}: counters fixed.`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
