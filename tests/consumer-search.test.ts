// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsumerInfo } from '../app/components/ConsumerInfo';
import { ToastProvider } from '../app/components/ToastProvider';
import { I18nProvider } from '../lib/i18n/context';
import { getRecent, recordRecent, resetRecentCache } from '../lib/recent-searches';
import { resetOnboardingCache } from '../lib/onboarding';
import type { Status } from '../lib/control-client';

const social = vi.hoisted(() => ({
  loadFollowingUsers: vi.fn(),
  loadUserSummaries: vi.fn(),
  loadRatingStatuses: vi.fn(),
}));

vi.mock('@/lib/client/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/client/auth')>()),
  ...social,
}));

interface Candidate {
  peerId: string;
  userId: string;
  protocol: string;
  models: string[];
  rttToServer: number;
  onlineMs: number;
}

function candidate(models: string[], peerId = 'p1'): Candidate {
  return { peerId, userId: 'other', protocol: 'openai', models, rttToServer: 10, onlineMs: 1000 };
}

function status(): Status {
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
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  resetRecentCache();
  resetOnboardingCache();
  social.loadFollowingUsers.mockResolvedValue({
    users: [], limit: 500, page: 1, pageSize: 500, total: 0,
  });
  social.loadUserSummaries.mockResolvedValue(new Map());
  social.loadRatingStatuses.mockResolvedValue(new Map());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  window.localStorage.clear();
  resetRecentCache();
  resetOnboardingCache();
  document.body.replaceChildren();
});

/** Renders the panel with a discover stub, after the auto-search settles. */
async function mount(discover: ReturnType<typeof vi.fn>): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, null, createElement(ToastProvider, null,
      createElement(ConsumerInfo, {
        status: status(),
        origin: 'http://localhost/api/v1/inference',
        discover: discover as never,
        currentUserId: 'u1',
        apiKeys: [],
        selectedApiKeyId: '',
        onSelectApiKey: vi.fn(),
        apiKeysLoading: false,
        apiKeysError: '',
      }) as ReactNode)));
  });
}

function empty() {
  return { candidates: [], nextCursor: null, hasMore: false, limit: 20 };
}

function keywordInput(): HTMLInputElement | null {
  return container.querySelector('input');
}

async function type(value: string): Promise<void> {
  const input = keywordInput();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    )?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button'))
    .find((node) => node.textContent?.trim() === text);
}

async function search(): Promise<void> {
  await act(async () => buttonByText('Search')?.click());
}

describe('consumer search assistance', () => {
  it('does not ask for suggestions when the search succeeded', async () => {
    const discover = vi.fn().mockResolvedValue({
      candidates: [candidate(['llama3'])], nextCursor: null, hasMore: false, limit: 20,
    });
    await mount(discover);
    await type('llama3');
    await search();

    // One call for the auto-listing, one for this search. No catalogue scan.
    expect(discover).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('llama3');
    expect(container.textContent).not.toContain('Did you mean');
  });

  it('offers near misses after a search that found nothing', async () => {
    const discover = vi.fn()
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce({
        candidates: [candidate(['llama3:8b', 'qwen3:8b'])],
        nextCursor: null, hasMore: false, limit: 50,
      });
    await mount(discover);
    await type('llama3:8c');
    await search();

    expect(container.textContent).toContain('Did you mean');
    expect(buttonByText('llama3:8b')).toBeTruthy();
    // The catalogue scan runs unfiltered, so a typo cannot hide the real names.
    expect(discover).toHaveBeenLastCalledWith('', '', undefined, undefined, 50);
  });

  it('searches the suggestion when it is clicked', async () => {
    const discover = vi.fn()
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce({
        candidates: [candidate(['llama3:8b'])], nextCursor: null, hasMore: false, limit: 50,
      })
      .mockResolvedValue({
        candidates: [candidate(['llama3:8b'])], nextCursor: null, hasMore: false, limit: 20,
      });
    await mount(discover);
    await type('llama3:8c');
    await search();

    await act(async () => buttonByText('llama3:8b')?.click());
    expect(keywordInput()?.value).toBe('llama3:8b');
    expect(container.textContent).not.toContain('Did you mean');
  });

  it('skips the catalogue scan when browsing everything came back empty', async () => {
    // With no keyword there is nothing to have mistyped.
    const discover = vi.fn().mockResolvedValue(empty());
    await mount(discover);
    await search();

    expect(discover).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('Did you mean');
  });

  it('remembers a search and replays it from a chip', async () => {
    const discover = vi.fn().mockResolvedValue({
      candidates: [candidate(['llama3'])], nextCursor: null, hasMore: false, limit: 20,
    });
    await mount(discover);
    await type('llama3');
    await search();

    expect(getRecent('u1')).toEqual([{ keyword: 'llama3', protocol: '' }]);

    await type('something-else');
    await act(async () => buttonByText('llama3')?.click());
    expect(keywordInput()?.value).toBe('llama3');
  });

  it('does not record the automatic listing on load', async () => {
    const discover = vi.fn().mockResolvedValue(empty());
    await mount(discover);
    expect(getRecent('u1')).toEqual([]);
  });

  it('clears the recent list on request', async () => {
    recordRecent('u1', { keyword: 'llama3', protocol: '' });
    const discover = vi.fn().mockResolvedValue(empty());
    await mount(discover);
    expect(container.textContent).toContain('Recent');

    await act(async () => buttonByText('Clear')?.click());
    expect(getRecent('u1')).toEqual([]);
    expect(container.textContent).not.toContain('Recent');
  });

  it('shows a skeleton instead of stale rows while searching', async () => {
    let release: (value: unknown) => void = () => {};
    const discover = vi.fn()
      .mockResolvedValueOnce({
        candidates: [candidate(['llama3'])], nextCursor: null, hasMore: false, limit: 20,
      })
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      // The emptied search then scans the catalogue for near misses.
      .mockResolvedValue(empty());
    await mount(discover);
    expect(container.textContent).toContain('llama3');

    await type('qwen3');
    await act(async () => { buttonByText('Search')?.click(); });

    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    // The previous result must not read as a current one.
    expect(container.textContent).not.toContain('llama3');

    await act(async () => {
      release(empty());
      await Promise.resolve();
    });
    expect(container.querySelector('[aria-busy="true"]')).toBeFalsy();
  });

  it('explains an empty result and offers a way out', async () => {
    const discover = vi.fn().mockResolvedValue(empty());
    await mount(discover);
    await type('nonexistent-model');
    await search();

    expect(container.textContent).toContain('Check the exact model name');
    expect(buttonByText('Browse all models')).toBeTruthy();
  });
});
