import type { PrismaClient } from "@prisma/client";

export const DEFAULT_INTEREST_TAGS = [
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
] as const;

export async function ensureDefaultInterestTags(
  database: Pick<PrismaClient, "interestTag">,
): Promise<void> {
  for (const tag of DEFAULT_INTEREST_TAGS) {
    await database.interestTag.upsert({
      where: { slug: tag.slug },
      create: tag,
      update: { label: tag.label, isActive: true },
    });
  }
}
