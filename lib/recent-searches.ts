/**
 * Recent model searches, per account.
 *
 * Model names are long and exact ("qwen3-coder-30b-a3b-instruct"), and retyping
 * one is both tedious and the main source of zero-result searches. Keeping the
 * last few lets the common case become a single click.
 */

export interface RecentSearch {
  keyword: string;
  protocol: string;
}

export const RECENT_LIMIT = 8;
export const STORAGE_PREFIX = 'fs.recentSearches.v1';

export function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}.${userId}`;
}

export function sameSearch(left: RecentSearch, right: RecentSearch): boolean {
  return left.keyword.toLowerCase() === right.keyword.toLowerCase()
    && left.protocol === right.protocol;
}

export function parseRecent(raw: string | null): RecentSearch[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: RecentSearch[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const { keyword, protocol } = item as { keyword?: unknown; protocol?: unknown };
      if (typeof keyword !== 'string' || !keyword.trim()) continue;
      entries.push({
        keyword: keyword.trim(),
        protocol: typeof protocol === 'string' ? protocol : '',
      });
      if (entries.length >= RECENT_LIMIT) break;
    }
    return entries;
  } catch {
    return [];
  }
}

/** Newest first, de-duplicated case-insensitively, capped. */
export function addRecent(
  current: readonly RecentSearch[],
  entry: RecentSearch,
): RecentSearch[] {
  const keyword = entry.keyword.trim();
  // Browsing everything is not a search worth remembering.
  if (!keyword) return [...current];
  const next: RecentSearch = { keyword, protocol: entry.protocol };
  return [next, ...current.filter((item) => !sameSearch(item, next))].slice(0, RECENT_LIMIT);
}

const cache = new Map<string, readonly RecentSearch[]>();
const listeners = new Set<() => void>();

export const EMPTY_RECENT: readonly RecentSearch[] = Object.freeze([]);

export function getRecent(userId: string): readonly RecentSearch[] {
  if (!userId || typeof window === 'undefined') return EMPTY_RECENT;
  const cached = cache.get(userId);
  if (cached) return cached;
  const parsed = parseRecent(window.localStorage.getItem(storageKey(userId)));
  cache.set(userId, parsed);
  return parsed;
}

function commit(userId: string, entries: readonly RecentSearch[]): void {
  cache.set(userId, entries);
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(entries));
  } catch {
    // Losing persistence is acceptable; losing the search is not.
  }
  listeners.forEach((listener) => listener());
}

export function recordRecent(userId: string, entry: RecentSearch): void {
  if (!userId || typeof window === 'undefined') return;
  const current = getRecent(userId);
  const next = addRecent(current, entry);
  // Re-searching the newest entry changes nothing; skip the re-render.
  if (next.length === current.length && next.every((item, index) => sameSearch(item, current[index]))) return;
  commit(userId, next);
}

export function removeRecent(userId: string, entry: RecentSearch): void {
  if (!userId || typeof window === 'undefined') return;
  const current = getRecent(userId);
  const next = current.filter((item) => !sameSearch(item, entry));
  if (next.length === current.length) return;
  commit(userId, next);
}

export function clearRecent(userId: string): void {
  if (!userId || typeof window === 'undefined') return;
  if (getRecent(userId).length === 0) return;
  commit(userId, []);
}

export function subscribeToRecent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: drops the in-memory snapshot cache. */
export function resetRecentCache(): void {
  cache.clear();
}
