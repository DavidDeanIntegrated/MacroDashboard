// Simple in-memory cache with TTL for serverless functions
// Macro and fundamentals data changes slowly, so aggressive caching is appropriate

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T, ttlSeconds: number): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export function invalidatePrefix(prefix: string): number {
  let count = 0;
  const keys = Array.from(cache.keys());
  for (const key of keys) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      count++;
    }
  }
  return count;
}

export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== null) return cached;
  const data = await fetcher();
  setCache(key, data, ttlSeconds);
  return data;
}

// TTL presets (in seconds)
export const TTL = {
  MACRO: 3600,        // 1 hour — macro data updates monthly/weekly
  FUNDAMENTALS: 3600, // 1 hour — SEC filings update quarterly
  QUOTES: 30,         // 30 seconds — live-ish quotes
  NEWS: 300,          // 5 minutes
  PORTFOLIO: 60,      // 1 minute
  FILINGS: 3600,      // 1 hour
} as const;
