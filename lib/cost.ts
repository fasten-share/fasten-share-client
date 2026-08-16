export const DEFAULT_COST_MULTIPLIER = 1;
export const MIN_COST_MULTIPLIER = 0.000001;
export const MAX_COST_MULTIPLIER = 999999;
export const MAX_FREE_CREDITS = 1_000_000_000_000;

export function normalizeCostMultiplier(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_COST_MULTIPLIER;
  if (n === 0) return 0;
  return Math.min(MAX_COST_MULTIPLIER, Math.max(MIN_COST_MULTIPLIER, n));
}

/** Free credit quota per backend: a non-negative integer; anything invalid falls back to 0 (off). */
export function normalizeFreeCredits(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  return Math.min(MAX_FREE_CREDITS, Math.floor(n));
}
