/**
 * Onboarding checklist model.
 *
 * Steps are proven by real signals (a balance, a passing health check, a served
 * request) rather than self-reported clicks, so the list cannot claim progress
 * the user has not actually made.
 *
 * Progress is monotonic: once a step is observed complete it is latched into
 * storage and stays done. Several signals are transient — the traffic log
 * resets when the daemon restarts, and sharing can be stopped deliberately —
 * and un-ticking a box the user already earned reads as a bug, not a status.
 */

export const CONSUMER_STEPS = [
  'consumerRecharge',
  'consumerApiKey',
  'consumerSearch',
  'consumerConfigure',
] as const;

export const PRODUCER_STEPS = [
  'producerBackend',
  'producerHealthy',
  'producerShare',
  'producerEarn',
] as const;

export type ConsumerStep = (typeof CONSUMER_STEPS)[number];
export type ProducerStep = (typeof PRODUCER_STEPS)[number];
export type OnboardingStep = ConsumerStep | ProducerStep;

const ALL_STEPS: readonly OnboardingStep[] = [...CONSUMER_STEPS, ...PRODUCER_STEPS];

export interface OnboardingState {
  done: OnboardingStep[];
  dismissed: boolean;
}

/** Signals that can be read straight from live state. */
export interface OnboardingSignals {
  /** Decimal credit string from the user DTO. */
  consumerCredits: string;
  apiKeyCount: number;
  backendCount: number;
  anyHealthy: boolean;
  anyAdvertised: boolean;
  servedRequests: number;
}

export const STORAGE_PREFIX = 'fs.onboarding.v1';

export function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}.${userId}`;
}

/** True when a decimal credit string is greater than zero. */
export function hasPositiveCredits(value: string | null | undefined): boolean {
  const raw = value?.trim();
  if (!raw) return false;
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return false;
  const [, sign, integer, fraction = ''] = match;
  if (sign === '-') return false;
  return /[1-9]/.test(integer) || /[1-9]/.test(fraction);
}

/** Steps provable from the current snapshot alone. */
export function derivedSteps(signals: OnboardingSignals): OnboardingStep[] {
  const done: OnboardingStep[] = [];
  if (hasPositiveCredits(signals.consumerCredits)) done.push('consumerRecharge');
  if (signals.apiKeyCount > 0) done.push('consumerApiKey');
  if (signals.backendCount > 0) done.push('producerBackend');
  if (signals.anyHealthy) done.push('producerHealthy');
  if (signals.anyAdvertised) done.push('producerShare');
  if (signals.servedRequests > 0) done.push('producerEarn');
  return done;
}

function isStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ALL_STEPS as readonly string[]).includes(value);
}

export function parseState(raw: string | null): OnboardingState {
  if (!raw) return { done: [], dismissed: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { done: [], dismissed: false };
    const { done, dismissed } = parsed as { done?: unknown; dismissed?: unknown };
    return {
      done: Array.isArray(done) ? done.filter(isStep) : [],
      dismissed: dismissed === true,
    };
  } catch {
    // Corrupt storage must not break the page; start the checklist over.
    return { done: [], dismissed: false };
  }
}

// A cached snapshot per user keeps useSyncExternalStore stable: returning a
// fresh object on every read would spin the render loop.
const cache = new Map<string, OnboardingState>();
const listeners = new Set<() => void>();

export const EMPTY_STATE: OnboardingState = Object.freeze({ done: [], dismissed: false });

export function getState(userId: string): OnboardingState {
  if (!userId || typeof window === 'undefined') return EMPTY_STATE;
  const cached = cache.get(userId);
  if (cached) return cached;
  const state = parseState(window.localStorage.getItem(storageKey(userId)));
  cache.set(userId, state);
  return state;
}

function commit(userId: string, state: OnboardingState): void {
  cache.set(userId, state);
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // Private-mode storage failures only cost persistence, not the session.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Latch a completed step. Already-done steps return without notifying, so an
 * effect that replays derived progress on every render settles immediately.
 */
export function markStep(userId: string, step: OnboardingStep): void {
  if (!userId || typeof window === 'undefined') return;
  const current = getState(userId);
  if (current.done.includes(step)) return;
  commit(userId, { ...current, done: [...current.done, step] });
}

export function markSteps(userId: string, steps: readonly OnboardingStep[]): void {
  if (!userId || typeof window === 'undefined') return;
  const current = getState(userId);
  const added = steps.filter((step) => !current.done.includes(step));
  if (added.length === 0) return;
  commit(userId, { ...current, done: [...current.done, ...added] });
}

export function dismissOnboarding(userId: string): void {
  if (!userId || typeof window === 'undefined') return;
  const current = getState(userId);
  if (current.dismissed) return;
  commit(userId, { ...current, dismissed: true });
}

export function subscribeToOnboarding(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: drops the in-memory snapshot cache. */
export function resetOnboardingCache(): void {
  cache.clear();
}
