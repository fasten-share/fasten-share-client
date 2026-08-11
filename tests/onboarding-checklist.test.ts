// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingChecklist } from '../app/components/OnboardingChecklist';
import { I18nProvider } from '../lib/i18n/context';
import { getState, markStep, resetOnboardingCache, storageKey } from '../lib/onboarding';
import type { Status } from '../lib/control-client';
import type { UserDto } from '../lib/client/auth-types';
import type { ConsumerApiKeyDto } from '../lib/client/auth';

function user(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u1', displayName: 'Ada', avatarUrl: null, tier: 'basic',
    consumerBalance: '0', consumerPendingDelta: '0', consumerAvailable: '0',
    producerBalance: '0', producerPendingDelta: '0', producerAvailable: '0',
    withdrawableProducerBalance: '0', escrow: '0', stake: '0', reputation: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function status(overrides: Partial<Status> = {}): Status {
  return {
    userId: 'u1',
    configRevision: 1,
    transport: { ready: true, wsPort: 8087 },
    signaling: { connected: true },
    producer: {
      running: false, registered: false, backends: [],
      traffic: { recent: [], buckets: [], totals: { success: 0, failure: 0, bytes: 0, since: 0 } },
    },
    config: { signalUrl: '', autoShare: true, backends: [] },
    connectedProducers: [],
    ...overrides,
  };
}

function apiKey(id: string): ConsumerApiKeyDto {
  return {
    id, name: id, key: `sk-${id}`, frozen: false, freezeReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  resetOnboardingCache();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  window.localStorage.clear();
  resetOnboardingCache();
  document.body.replaceChildren();
});

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, null, node));
  });
}

function stepTitles(): string[] {
  return Array.from(container.querySelectorAll('li')).map((li) => li.textContent ?? '');
}

function goButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('li button'));
}

async function clickButton(text: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === text);
  await act(async () => button?.click());
}

/** Open the collapsed-by-default checklist so the steps are visible. */
async function expand(): Promise<void> {
  await clickButton('Expand');
}

describe('OnboardingChecklist', () => {
  it('starts collapsed, hides the steps, and remembers the choice', async () => {
    const props = { user: user(), apiKeys: [], status: status(), onNavigate: vi.fn() };
    await render(createElement(OnboardingChecklist, props));

    // Collapsed by default: header and progress only, no guidance steps.
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(container.textContent).toContain('0 of 8 done');
    expect(container.textContent).toContain('Expand');
    expect(container.textContent).not.toContain('Add credits to your account');

    await expand();
    expect(stepTitles()).toHaveLength(8);
    expect(container.textContent).toContain('Collapse');

    await clickButton('Collapse');
    expect(container.querySelectorAll('li')).toHaveLength(0);

    // An explicit expanded choice survives a remount.
    await expand();
    await render(createElement(OnboardingChecklist, props));
    expect(stepTitles()).toHaveLength(8);
  });

  it('lists every step for a fresh account', async () => {
    await render(createElement(OnboardingChecklist, {
      user: user(), apiKeys: [], status: status(), onNavigate: vi.fn(),
    }));
    await expand();

    expect(stepTitles()).toHaveLength(8);
    expect(container.textContent).toContain('0 of 8 done');
    expect(container.textContent).toContain('Add credits to your account');
    expect(container.textContent).toContain('Serve your first request');
  });

  it('renders nothing when signed out', async () => {
    await render(createElement(OnboardingChecklist, {
      user: null, apiKeys: [], status: status(), onNavigate: vi.fn(),
    }));
    expect(container.textContent).toBe('');
  });

  it('ticks the steps proven by live state', async () => {
    await render(createElement(OnboardingChecklist, {
      user: user({ consumerAvailable: '10.00' }),
      apiKeys: [apiKey('k1')],
      status: status({
        config: { signalUrl: '', autoShare: true, backends: [
          { id: 'b1', baseUrl: 'x', protocol: 'openai', models: ['m'], apiKey: '', enabled: true },
        ] },
        producer: {
          running: true, registered: true,
          backends: [{
            id: 'b1', protocol: 'openai', models: ['m'], enabled: true,
            advertised: true, checking: false, lastHealth: { ok: true, at: 1 },
          }],
          traffic: { recent: [], buckets: [], totals: { success: 2, failure: 0, bytes: 0, since: 0 } },
        },
      }),
      onNavigate: vi.fn(),
    }));

    // Six of eight are observable; search and configure are not.
    await expand();
    expect(container.textContent).toContain('6 of 8 done');
    expect(goButtons()).toHaveLength(2);
  });

  it('treats a zero balance as unfunded', async () => {
    await render(createElement(OnboardingChecklist, {
      user: user({ consumerAvailable: '0.00' }), apiKeys: [], status: status(), onNavigate: vi.fn(),
    }));
    expect(container.textContent).toContain('0 of 8 done');
  });

  it('keeps a step ticked after its signal goes away', async () => {
    const shared = () => ({ user: user(), apiKeys: [], onNavigate: vi.fn() });
    await render(createElement(OnboardingChecklist, {
      ...shared(),
      status: status({
        producer: {
          running: true, registered: true, backends: [],
          traffic: { recent: [], buckets: [], totals: { success: 5, failure: 0, bytes: 0, since: 0 } },
        },
      }),
    }));
    expect(container.textContent).toContain('1 of 8 done');

    // The daemon restarted and the traffic log is empty again.
    await render(createElement(OnboardingChecklist, { ...shared(), status: status() }));
    expect(container.textContent).toContain('1 of 8 done');
  });

  it('persists latched progress across a remount', async () => {
    await render(createElement(OnboardingChecklist, {
      user: user(), apiKeys: [apiKey('k1')], status: status(), onNavigate: vi.fn(),
    }));
    expect(window.localStorage.getItem(storageKey('u1'))).toContain('consumerApiKey');
    expect(getState('u1').done).toContain('consumerApiKey');
  });

  it('reacts to a step latched from elsewhere in the app', async () => {
    await render(createElement(OnboardingChecklist, {
      user: user(), apiKeys: [], status: status(), onNavigate: vi.fn(),
    }));
    expect(container.textContent).toContain('0 of 8 done');

    // A search elsewhere in the tree publishes through the store.
    await act(async () => markStep('u1', 'consumerSearch'));
    expect(container.textContent).toContain('1 of 8 done');
  });

  it('routes each unfinished step to the right destination', async () => {
    const onNavigate = vi.fn();
    await render(createElement(OnboardingChecklist, {
      user: user(), apiKeys: [], status: status(), onNavigate,
    }));
    await expand();

    await act(async () => goButtons()[0]?.click());
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'recharge' });

    await act(async () => goButtons()[1]?.click());
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'apiKeys' });

    await act(async () => goButtons()[4]?.click());
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'tab', tab: 'producer' });
  });

  it('disappears once dismissed and stays gone', async () => {
    const props = { user: user(), apiKeys: [], status: status(), onNavigate: vi.fn() };
    await render(createElement(OnboardingChecklist, props));

    const dismiss = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Dismiss');
    await act(async () => dismiss?.click());
    expect(container.textContent).toBe('');

    await render(createElement(OnboardingChecklist, props));
    expect(container.textContent).toBe('');
  });

  it('disappears when every step is complete', async () => {
    markStep('u1', 'consumerSearch');
    markStep('u1', 'consumerConfigure');
    await render(createElement(OnboardingChecklist, {
      user: user({ consumerAvailable: '10' }),
      apiKeys: [apiKey('k1')],
      status: status({
        config: { signalUrl: '', autoShare: true, backends: [
          { id: 'b1', baseUrl: 'x', protocol: 'openai', models: ['m'], apiKey: '', enabled: true },
        ] },
        producer: {
          running: true, registered: true,
          backends: [{
            id: 'b1', protocol: 'openai', models: ['m'], enabled: true,
            advertised: true, checking: false, lastHealth: { ok: true, at: 1 },
          }],
          traffic: { recent: [], buckets: [], totals: { success: 1, failure: 0, bytes: 0, since: 0 } },
        },
      }),
      onNavigate: vi.fn(),
    }));

    expect(container.textContent).toBe('');
  });

  it('keeps progress separate per account', async () => {
    await render(createElement(OnboardingChecklist, {
      user: user(), apiKeys: [apiKey('k1')], status: status(), onNavigate: vi.fn(),
    }));
    expect(container.textContent).toContain('1 of 8 done');

    await render(createElement(OnboardingChecklist, {
      user: user({ id: 'u2' }), apiKeys: [], status: status(), onNavigate: vi.fn(),
    }));
    expect(container.textContent).toContain('0 of 8 done');
  });

  it('reports progress to assistive technology', async () => {
    await render(createElement(OnboardingChecklist, {
      user: user(), apiKeys: [apiKey('k1')], status: status(), onNavigate: vi.fn(),
    }));
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('1');
    expect(bar?.getAttribute('aria-valuemax')).toBe('8');
  });
});
