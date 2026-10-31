type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const store = new Map<string, CacheEntry>();
/** Coalesce concurrent cold misses so N admin tabs don't stampede the DB. */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Process-local TTL cache for hot admin KPI responses.
 * Not shared across replicas — fine for short TTLs that cut DB load.
 */
export async function ttlGetOrSet<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }

  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const loadPromise = (async () => {
    try {
      const value = await loader();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, loadPromise);
  return loadPromise as Promise<T>;
}

/** Test / deploy hook — clears all entries. */
export function ttlCacheClear(): void {
  store.clear();
  inflight.clear();
}
