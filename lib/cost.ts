export const DEFAULT_COST_MULTIPLIER = 1;
export const MIN_COST_MULTIPLIER = 0.001;
export const MAX_COST_MULTIPLIER = 999;

export function normalizeCostMultiplier(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_COST_MULTIPLIER;
  return Math.min(MAX_COST_MULTIPLIER, Math.max(MIN_COST_MULTIPLIER, n));
}
