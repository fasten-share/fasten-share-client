export const DEFAULT_COST_MULTIPLIER = 1;
export const MIN_COST_MULTIPLIER = 0.000001;
export const MAX_COST_MULTIPLIER = 999999;

export function normalizeCostMultiplier(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_COST_MULTIPLIER;
  if (n === 0) return 0;
  return Math.min(MAX_COST_MULTIPLIER, Math.max(MIN_COST_MULTIPLIER, n));
}
