/**
 * Recent-window score. The Reels tab ranks every approved reel in that
 * window, then continues into older reels. REEL_RANK_POOL is not a feed cap.
 */

export const REEL_RANK_POOL = 200;
export const REEL_RANK_WINDOW_DAYS = 14;
export const REEL_HASHTAG_WINDOW_DAYS = 60;
export const REEL_FRESH_HOURS = 6;
export const REEL_FRESH_FLOOR = 25;
export const REEL_DECAY_AFTER_HOURS = 72;
export const REEL_RATE_MIN_VIEWS = 8;
export const REEL_FOLLOWER_BOOST_REF = 1_000;
export const REEL_LONG_WATCH_RATIO = 0.5;

export interface ReelScoreInput {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount: number;
  durationMs: number;
  avgWatchedMs: number;
  /** Views that actually stored a watch length. Old rows with 0 do not count. */
  measuredWatchCount: number;
  followerCount: number;
  createdAt: Date;
  matched: boolean;
  interestPending: boolean;
  following: boolean;
  sharedProfileInterest: boolean;
  sameCountry: boolean;
  hashtags: readonly string[];
  viewerInterestHashtags: readonly string[];
  engagedHashtags: readonly string[];
  seen: boolean;
  own: boolean;
  now?: Date;
}

export function isLongReelWatch(watchedMs: number, durationMs: number): boolean {
  if (watchedMs <= 0) return false;
  if (durationMs > 0) return watchedMs >= durationMs * REEL_LONG_WATCH_RATIO;
  return watchedMs >= 8_000;
}

/** Higher is better. Rounded so the ranked cursor stays stable. */
export function scoreReel(input: ReelScoreInput): number {
  const now = input.now ?? new Date();
  const total = qualityScore(input, now) + personalScore(input);
  return Math.round(total * 1000) / 1000;
}

export function spreadReelPages<T>(
  sorted: readonly T[],
  getAuthorId: (item: T) => string,
  pageSize: number,
): T[] {
  const size = Math.max(1, pageSize);
  const pending = [...sorted];
  const ordered: T[] = [];
  while (pending.length > 0) {
    const used = new Set<string>();
    const page: T[] = [];
    const deferred: T[] = [];
    for (const item of pending) {
      if (page.length >= size) {
        deferred.push(item);
        continue;
      }
      const authorId = getAuthorId(item);
      if (used.has(authorId)) {
        deferred.push(item);
        continue;
      }
      page.push(item);
      used.add(authorId);
    }
    if (page.length < size) {
      const rest: T[] = [];
      for (const item of deferred) {
        if (page.length < size) page.push(item);
        else rest.push(item);
      }
      ordered.push(...page);
      if (rest.length === 0) break;
      pending.splice(0, pending.length, ...rest);
      continue;
    }
    ordered.push(...page);
    pending.splice(0, pending.length, ...deferred);
  }
  return ordered;
}

export function sliceRankedPage<
  T extends { id: string; score: number; createdAt: Date },
>(
  ordered: readonly T[],
  cursor: { id: string; score: number; createdAt: string } | null,
  limit: number,
): T[] {
  const take = Math.max(0, limit) + 1;
  if (!cursor) return ordered.slice(0, take);
  const index = ordered.findIndex((item) => item.id === cursor.id);
  if (index >= 0) return ordered.slice(index + 1, index + 1 + take);
  const cursorTime = new Date(cursor.createdAt).getTime();
  const after = ordered.filter((item) => {
    if (item.score < cursor.score) return true;
    if (item.score > cursor.score) return false;
    const created = item.createdAt.getTime();
    if (created < cursorTime) return true;
    if (created > cursorTime) return false;
    return item.id < cursor.id;
  });
  return after.slice(0, take);
}

function qualityScore(input: ReelScoreInput, now: Date): number {
  const denom = Math.max(input.viewCount, REEL_RATE_MIN_VIEWS);
  const rate = (count: number) => Math.min(Math.max(count, 0) / denom, 1);
  let completion = 0;
  if (
    input.durationMs > 0 &&
    input.measuredWatchCount > 0 &&
    input.avgWatchedMs > 0
  ) {
    completion = Math.min(input.avgWatchedMs / input.durationMs, 1);
    if (input.measuredWatchCount < REEL_RATE_MIN_VIEWS) {
      completion *= input.measuredWatchCount / REEL_RATE_MIN_VIEWS;
    }
  }
  const followerBoost = Math.min(
    Math.log(Math.max(input.followerCount, 0) + 1) /
      Math.log(REEL_FOLLOWER_BOOST_REF + 1),
    1,
  );
  let quality =
    completion * 40 +
    rate(input.shareCount) * 18 +
    rate(input.saveCount) * 14 +
    rate(input.commentCount) * 12 +
    rate(input.likeCount) * 8 +
    followerBoost * 8;

  const hours = Math.max(
    0,
    (now.getTime() - input.createdAt.getTime()) / (1000 * 60 * 60),
  );
  if (hours < REEL_FRESH_HOURS) quality = Math.max(quality, REEL_FRESH_FLOOR);
  if (hours > REEL_DECAY_AFTER_HOURS) {
    quality *= Math.pow(
      0.5,
      (hours - REEL_DECAY_AFTER_HOURS) / REEL_DECAY_AFTER_HOURS,
    );
  }
  return quality;
}

function personalScore(input: ReelScoreInput): number {
  let score = 0;
  if (input.matched) score += 28;
  if (input.interestPending) score += 18;
  if (input.following) score += 14;
  if (input.sharedProfileInterest) score += 8;
  if (input.sameCountry) score += 6;
  score += hashtagPoints(
    input.hashtags,
    input.viewerInterestHashtags,
    input.engagedHashtags,
  );
  if (input.seen) score -= 20;
  if (input.own) score -= 8;
  return score;
}

function hashtagPoints(
  tags: readonly string[],
  interestTags: readonly string[],
  engagedTags: readonly string[],
): number {
  const interest = new Set(interestTags.map((tag) => tag.toLowerCase()));
  const engaged = new Set(engagedTags.map((tag) => tag.toLowerCase()));
  const seen = new Set<string>();
  let engagedHits = 0;
  let interestHits = 0;
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    if (engaged.has(tag)) engagedHits += 1;
    else if (interest.has(tag)) interestHits += 1;
  }
  return Math.min(engagedHits, 3) * 6 + Math.min(interestHits, 3) * 4;
}
