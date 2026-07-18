import { PrismaClient, type InterestTag } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_TAGS: Array<Pick<InterestTag, "slug" | "label">> = [
  { slug: "music", label: "Music" },
  { slug: "travel", label: "Travel" },
  { slug: "fitness", label: "Fitness" },
  { slug: "movies", label: "Movies" },
  { slug: "food", label: "Food" },
  { slug: "gaming", label: "Gaming" },
  { slug: "art", label: "Art" },
  { slug: "books", label: "Books" },
  { slug: "photography", label: "Photography" },
  { slug: "outdoors", label: "Outdoors" },
];

async function main(): Promise<void> {
  for (const tag of DEFAULT_TAGS) {
    await prisma.interestTag.upsert({
      where: { slug: tag.slug },
      create: tag,
      update: { label: tag.label, isActive: true },
    });
  }
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
