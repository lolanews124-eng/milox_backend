const MENTION_PATTERN = /@([a-zA-Z0-9_]{3,32})\b/g;
const MAX_MENTIONS_PER_POST = 10;

/** Extracts unique usernames from @mentions in a post body (lowercase, no @). */
export function extractMentions(body: string | null | undefined): string[] {
  if (!body) return [];
  const usernames = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const username = match[1]?.toLowerCase();
    if (username) usernames.add(username);
    if (usernames.size >= MAX_MENTIONS_PER_POST) break;
  }
  return [...usernames];
}
