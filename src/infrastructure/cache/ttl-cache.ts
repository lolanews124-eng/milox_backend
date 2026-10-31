type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const store = new Map<string, CacheEntry>();

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
  const value = await loader();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/** Test / deploy hook — clears all entries. */
export function ttlCacheClear(): void {
  store.clear();
}
