/** Shared feed ranking constants — keep worker SQL and docs aligned. */
export const FEED_TRENDING_WINDOW_DAYS = 60;
export const FEED_LATEST_WINDOW_DAYS = 90;
export const FEED_SUGGESTED_NEW_AUTHOR_DAYS = 30;
/** Fresh posts always eligible for trending even before engagement lands. */
export const FEED_TRENDING_FRESH_HOURS = 48;
/** Following tab: prefer hot posts, still include older follows chronologically via score decay. */
export const FEED_FOLLOWING_HOT_DAYS = 21;
/** Max posts from the same author in one feed page (diversity). */
export const FEED_MAX_POSTS_PER_AUTHOR_PER_PAGE = 2;
/** Candidate pool multiplier when re-ranking / diversifying. */
export const FEED_RANK_POOL_MULTIPLIER = 6;
export const FEED_RANK_POOL_MIN = 36;
export const FEED_RANK_POOL_MAX = 120;

/**
 * Max multiplicative lift from author followerCount in trendingScore.
 * At REF followers → about +CAP (e.g. 0.55 → up to 1.55× engagement).
 */
export const FEED_FOLLOWER_BOOST_CAP = 0.55;
/** Follower count where boost reaches the cap (log curve). */
export const FEED_FOLLOWER_BOOST_REF = 10_000;

export function suggestedNewAuthorCutoff(now = new Date()): Date {
  return new Date(
    now.getTime() - FEED_SUGGESTED_NEW_AUTHOR_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function latestFeedCutoff(now = new Date()): Date {
  return new Date(
    now.getTime() - FEED_LATEST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function trendingFreshCutoff(now = new Date()): Date {
  return new Date(
    now.getTime() - FEED_TRENDING_FRESH_HOURS * 60 * 60 * 1000,
  );
}

export function followingHotCutoff(now = new Date()): Date {
  return new Date(
    now.getTime() - FEED_FOLLOWING_HOT_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function feedRankPoolSize(limit: number): number {
  return Math.min(
    FEED_RANK_POOL_MAX,
    Math.max(FEED_RANK_POOL_MIN, limit * FEED_RANK_POOL_MULTIPLIER),
  );
}

/** Smaller pool for Discover people — light re-rank only. */
export const DISCOVER_RANK_POOL_MULTIPLIER = 4;
export const DISCOVER_RANK_POOL_MIN = 24;
export const DISCOVER_RANK_POOL_MAX = 72;

export function discoverRankPoolSize(limit: number): number {
  return Math.min(
    DISCOVER_RANK_POOL_MAX,
    Math.max(DISCOVER_RANK_POOL_MIN, limit * DISCOVER_RANK_POOL_MULTIPLIER),
  );
}

export interface DiscoverPeopleScoreInput {
  discoverBoost: number;
  sameCountry: boolean;
  sharedInterestCount: number;
  followerCount: number;
  createdAt: Date;
  now?: Date;
}

/**
 * Light Discover ranking on top of premium discoverBoost.
 * Keep weights modest so filters + boost still dominate the feel.
 */
export function computeDiscoverPeopleScore(
  input: DiscoverPeopleScoreInput,
): number {
  const now = input.now ?? new Date();
  const daysAge = Math.max(
    0,
    (now.getTime() - input.createdAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  let score = Math.max(0, input.discoverBoost) * 4;
  if (input.sameCountry) score += 6;
  score += Math.min(Math.max(input.sharedInterestCount, 0), 3) * 4;
  score +=
    Math.min(
      Math.log(Math.max(input.followerCount, 0) + 1) / Math.log(5_000 + 1),
      1,
    ) * 3;
  if (daysAge < 14) score += 2;
  return score;
}

export interface SuggestedScoreInput {
  trendingScore: number;
  sameCountry: boolean;
  sharedInterestAuthor: boolean;
  hashtagInterestOverlap: number;
  affinityAuthor: boolean;
  seenByViewer: boolean;
  followerCount: number;
  createdAt: Date;
  now?: Date;
}

/** Viewer-specific For You score (on top of global trendingScore). */
export function computeSuggestedFeedScore(input: SuggestedScoreInput): number {
  const now = input.now ?? new Date();
  const hoursAge = Math.max(
    0,
    (now.getTime() - input.createdAt.getTime()) / (1000 * 60 * 60),
  );

  let score = input.trendingScore * 0.45;
  if (input.sameCountry) score += 18;
  if (input.sharedInterestAuthor) score += 22;
  score += Math.min(Math.max(input.hashtagInterestOverlap, 0), 5) * 4;
  if (input.affinityAuthor) score += 14;
  score += input.seenByViewer ? -14 : 10;
  score +=
    Math.min(
      Math.log(Math.max(input.followerCount, 0) + 1) /
        Math.log(FEED_FOLLOWER_BOOST_REF + 1),
      1,
    ) * 8;
  if (hoursAge < 24) score += 6;
  else if (hoursAge < 72) score += 3;
  return score;
}

export function diversifyByAuthor<T>(
  items: T[],
  getAuthorId: (item: T) => string,
  options: { limit: number; maxPerAuthor?: number },
): T[] {
  const maxPerAuthor =
    options.maxPerAuthor ?? FEED_MAX_POSTS_PER_AUTHOR_PER_PAGE;
  const counts = new Map<string, number>();
  const selected: T[] = [];
  const deferred: T[] = [];

  for (const item of items) {
    const authorId = getAuthorId(item);
    const used = counts.get(authorId) ?? 0;
    if (used < maxPerAuthor) {
      selected.push(item);
      counts.set(authorId, used + 1);
      if (selected.length >= options.limit) return selected;
    } else {
      deferred.push(item);
    }
  }

  for (const item of deferred) {
    if (selected.length >= options.limit) break;
    selected.push(item);
  }
  return selected;
}

export function rankedAfterCursor<T>(
  items: Array<{ item: T; score: number; createdAt: Date; id: string }>,
  cursor:
    | { score: number; createdAt: string; id: string }
    | null
    | undefined,
): Array<{ item: T; score: number; createdAt: Date; id: string }> {
  if (!cursor) return items;
  const cursorTime = new Date(cursor.createdAt).getTime();
  return items.filter((entry) => {
    if (entry.score < cursor.score) return true;
    if (entry.score > cursor.score) return false;
    const created = entry.createdAt.getTime();
    if (created < cursorTime) return true;
    if (created > cursorTime) return false;
    return entry.id < cursor.id;
  });
}
