/** Shared feed ranking constants — keep worker SQL and docs aligned. */
export const FEED_TRENDING_WINDOW_DAYS = 60;
export const FEED_LATEST_WINDOW_DAYS = 90;
export const FEED_SUGGESTED_NEW_AUTHOR_DAYS = 30;
/** Fresh posts always eligible for trending even before engagement lands. */
export const FEED_TRENDING_FRESH_HOURS = 48;

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
