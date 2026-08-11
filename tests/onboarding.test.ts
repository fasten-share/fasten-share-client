// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  derivedSteps,
  dismissOnboarding,
  getState,
  hasPositiveCredits,
  markStep,
  markSteps,
  parseState,
  resetOnboardingCache,
  setCollapsed,
  showOnboarding,
  storageKey,
  subscribeToOnboarding,
  type OnboardingSignals,
} from '../lib/onboarding';

function signals(overrides: Partial<OnboardingSignals> = {}): OnboardingSignals {
  return {
    consumerCredits: '0',
    apiKeyCount: 0,
    backendCount: 0,
    anyHealthy: false,
    anyAdvertised: false,
    servedRequests: 0,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetOnboardingCache();
});

afterEach(() => {
  window.localStorage.clear();
  resetOnboardingCache();
});

describe('hasPositiveCredits', () => {
  it('accepts decimal strings that are above zero', () => {
    expect(hasPositiveCredits('1')).toBe(true);
    expect(hasPositiveCredits('0.01')).toBe(true);
    expect(hasPositiveCredits(' 12.50 ')).toBe(true);
  });

  it('rejects zero however it is spelled', () => {
    // Balances arrive as decimal strings, so "0.00" must not read as funded.
    expect(hasPositiveCredits('0')).toBe(false);
    expect(hasPositiveCredits('0.00')).toBe(false);
    expect(hasPositiveCredits('0.000000')).toBe(false);
  });

  it('rejects negatives, blanks, and junk', () => {
    expect(hasPositiveCredits('-5')).toBe(false);
    expect(hasPositiveCredits('')).toBe(false);
    expect(hasPositiveCredits('   ')).toBe(false);
    expect(hasPositiveCredits(null)).toBe(false);
    expect(hasPositiveCredits(undefined)).toBe(false);
    expect(hasPositiveCredits('abc')).toBe(false);
  });

  it('keeps precision a float would lose', () => {
    // Number('0.0000000000000000001') still rounds to a truthy float, but a
    // huge string must not be mangled either.
    expect(hasPositiveCredits('0.0000000000000000001')).toBe(true);
    expect(hasPositiveCredits('99999999999999999999.5')).toBe(true);
  });
});

describe('derivedSteps', () => {
  it('reports nothing for a brand new account', () => {
    expect(derivedSteps(signals())).toEqual([]);
  });

  it('derives each step from its own signal', () => {
    expect(derivedSteps(signals({ consumerCredits: '5' }))).toEqual(['consumerRecharge']);
    expect(derivedSteps(signals({ apiKeyCount: 2 }))).toEqual(['consumerApiKey']);
    expect(derivedSteps(signals({ backendCount: 1 }))).toEqual(['producerBackend']);
    expect(derivedSteps(signals({ anyHealthy: true }))).toEqual(['producerHealthy']);
    expect(derivedSteps(signals({ anyAdvertised: true }))).toEqual(['producerShare']);
    expect(derivedSteps(signals({ servedRequests: 3 }))).toEqual(['producerEarn']);
  });

  it('never derives the steps that have no observable signal', () => {
    // Searching and configuring a tool leave no trace in status; they are
    // latched by the UI at the moment they happen.
    const all = derivedSteps(signals({
      consumerCredits: '5', apiKeyCount: 1, backendCount: 1,
      anyHealthy: true, anyAdvertised: true, servedRequests: 1,
    }));
    expect(all).not.toContain('consumerSearch');
    expect(all).not.toContain('consumerConfigure');
    expect(all).toHaveLength(6);
  });
});

describe('parseState', () => {
  it('starts empty and collapsed for missing storage', () => {
    expect(parseState(null)).toEqual({ done: [], dismissed: false, collapsed: true });
  });

  it('survives corrupt storage instead of throwing', () => {
    expect(parseState('{not json')).toEqual({ done: [], dismissed: false, collapsed: true });
    expect(parseState('"a string"')).toEqual({ done: [], dismissed: false, collapsed: true });
    expect(parseState('null')).toEqual({ done: [], dismissed: false, collapsed: true });
  });

  it('drops unknown step names left by an older build', () => {
    const raw = JSON.stringify({ done: ['consumerApiKey', 'retiredStep'], dismissed: true });
    expect(parseState(raw)).toEqual({
      done: ['consumerApiKey'], dismissed: true, collapsed: true,
    });
  });

  it('keeps an explicit expanded choice and defaults otherwise', () => {
    expect(parseState(JSON.stringify({ done: [], collapsed: false })).collapsed).toBe(false);
    // Older builds without a collapsed field, or junk values, stay collapsed.
    expect(parseState(JSON.stringify({ done: [] })).collapsed).toBe(true);
    expect(parseState(JSON.stringify({ done: [], collapsed: 'yes' })).collapsed).toBe(true);
  });
});

describe('progress latching', () => {
  it('persists a marked step under the user key', () => {
    markStep('u1', 'consumerSearch');
    expect(getState('u1').done).toEqual(['consumerSearch']);
    expect(window.localStorage.getItem(storageKey('u1'))).toContain('consumerSearch');
  });

  it('keeps a step done after its signal disappears', () => {
    // Traffic totals reset when the daemon restarts; earned progress must not.
    markSteps('u1', derivedSteps(signals({ servedRequests: 4 })));
    expect(getState('u1').done).toContain('producerEarn');

    resetOnboardingCache();
    expect(getState('u1').done).toContain('producerEarn');
    expect(derivedSteps(signals())).toEqual([]);
  });

  it('keeps each user separate', () => {
    markStep('u1', 'consumerApiKey');
    expect(getState('u2').done).toEqual([]);
  });

  it('notifies subscribers only when something actually changed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToOnboarding(listener);

    markStep('u1', 'consumerSearch');
    expect(listener).toHaveBeenCalledTimes(1);

    // Re-marking must be inert, or an effect replaying derived progress would
    // notify on every render and spin.
    markStep('u1', 'consumerSearch');
    markSteps('u1', ['consumerSearch']);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    markStep('u1', 'consumerConfigure');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('adds only the new steps in a batch', () => {
    markStep('u1', 'consumerApiKey');
    markSteps('u1', ['consumerApiKey', 'producerBackend']);
    expect(getState('u1').done).toEqual(['consumerApiKey', 'producerBackend']);
  });

  it('records dismissal without losing progress', () => {
    markStep('u1', 'consumerApiKey');
    dismissOnboarding('u1');
    resetOnboardingCache();
    expect(getState('u1')).toEqual({
      done: ['consumerApiKey'], dismissed: true, collapsed: true,
    });
  });

  it('toggles collapsed state and persists the choice', () => {
    expect(getState('u1').collapsed).toBe(true);

    setCollapsed('u1', false);
    expect(getState('u1').collapsed).toBe(false);
    resetOnboardingCache();
    expect(getState('u1').collapsed).toBe(false);

    setCollapsed('u1', true);
    expect(getState('u1').collapsed).toBe(true);
  });

  it('notifies subscribers when the collapse choice changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToOnboarding(listener);

    setCollapsed('u1', false);
    expect(listener).toHaveBeenCalledTimes(1);

    // Re-setting the same value must be inert.
    setCollapsed('u1', false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('re-shows a dismissed checklist and expands it', () => {
    markStep('u1', 'consumerApiKey');
    dismissOnboarding('u1');
    showOnboarding('u1');
    const state = getState('u1');
    expect(state.dismissed).toBe(false);
    expect(state.collapsed).toBe(false);
    expect(state.done).toEqual(['consumerApiKey']);
  });

  it('re-show is inert when the checklist is already visible', () => {
    setCollapsed('u1', false);
    const listener = vi.fn();
    const unsubscribe = subscribeToOnboarding(listener);
    showOnboarding('u1');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('ignores collapse and re-show writes for a signed-out user', () => {
    setCollapsed('', false);
    showOnboarding('');
    expect(window.localStorage.length).toBe(0);
    expect(getState('').collapsed).toBe(true);
  });

  it('ignores writes for a signed-out user', () => {
    markStep('', 'consumerApiKey');
    expect(window.localStorage.length).toBe(0);
    expect(getState('').done).toEqual([]);
  });

  it('returns a stable snapshot so an external store will not loop', () => {
    // useSyncExternalStore compares by identity.
    expect(getState('u1')).toBe(getState('u1'));
    markStep('u1', 'consumerSearch');
    const after = getState('u1');
    expect(after).toBe(getState('u1'));
  });
});
