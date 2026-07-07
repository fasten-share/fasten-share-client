export const DEFAULT_MAX_CONCURRENCY = 5;

/** Producer concurrency must be a positive integer; invalid legacy/input values use the default. */
export function normalizeMaxConcurrency(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_CONCURRENCY;
  return Math.floor(parsed);
}
