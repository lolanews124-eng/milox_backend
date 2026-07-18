const HASHTAG_PATTERN = /#([\p{L}\p{N}_]{2,30})/gu;
const MAX_TAGS_PER_POST = 10;

/** Extracts unique, normalized (lowercase, no '#') hashtags from a post body. */
export function extractHashtags(body: string | null | undefined): string[] {
  if (!body) return [];
  const tags = new Set<string>();
  for (const match of body.matchAll(HASHTAG_PATTERN)) {
    const tag = match[1]?.toLowerCase();
    if (tag) tags.add(tag);
    if (tags.size >= MAX_TAGS_PER_POST) break;
  }
  return [...tags];
}
