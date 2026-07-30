// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n/context';

const mocks = vi.hoisted(() => ({
  loadMe: vi.fn(),
  loadConsumerApiKeys: vi.fn(),
  logout: vi.fn(),
  renewAccessTokenIfNeeded: vi.fn(),
  startAccessTokenRenewal: vi.fn(() => vi.fn()),
  forceDeviceLogout: vi.fn(),
  setAuthNotice: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('../lib/client/auth', () => ({
  loadMe: mocks.loadMe,
  loadConsumerApiKeys: mocks.loadConsumerApiKeys,
  logout: mocks.logout,
  renewAccessTokenIfNeeded: mocks.renewAccessTokenIfNeeded,
  startAccessTokenRenewal: mocks.startAccessTokenRenewal,
  forceDeviceLogout: mocks.forceDeviceLogout,
  setAuthNotice: mocks.setAuthNotice,
}));

import { useHomeSession } from '../app/hooks/useHomeSession';

const user = { id: '42', displayName: 'Test user' } as never;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

function renderSession() {
  let session: ReturnType<typeof useHomeSession> | undefined;
  function Probe() {
    session = useHomeSession();
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return { root, Probe, getSession: () => session! };
}

async function mountSession() {
  mocks.renewAccessTokenIfNeeded.mockResolvedValue(undefined);
  mocks.loadMe.mockResolvedValue(user);
  mocks.loadConsumerApiKeys.mockResolvedValue([]);
  const rendered = renderSession();
  await act(async () => {
    rendered.root.render(createElement(I18nProvider, null, createElement(rendered.Probe)));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
}

describe('useHomeSession refresh policy', () => {
  it('limits manual refreshes to one request per ten seconds', async () => {
    const rendered = await mountSession();
    vi.useFakeTimers();
    const session = rendered.getSession();

    await act(async () => { await session.refreshUser(); });
    const afterFirstRefresh = mocks.loadMe.mock.calls.length;
    expect(rendered.getSession().refreshCooldownSeconds).toBe(15);

    await act(async () => { await session.refreshUser(); });
    expect(mocks.loadMe).toHaveBeenCalledTimes(afterFirstRefresh);

    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(rendered.getSession().refreshCooldownSeconds).toBe(0);
    const beforeSecondRefresh = mocks.loadMe.mock.calls.length;
    await act(async () => { await rendered.getSession().refreshUser(); });
    expect(mocks.loadMe.mock.calls.length).toBeGreaterThan(beforeSecondRefresh);

    await act(async () => { rendered.root.unmount(); });
  });

  it('keeps the cooldown after a failed refresh and prevents concurrent requests', async () => {
    const rendered = await mountSession();
    vi.useFakeTimers();
    let rejectPending!: (error: Error) => void;
    const pending = new Promise<never>((_, reject) => { rejectPending = reject; });
    mocks.loadMe.mockReturnValueOnce(pending);

    let first: Promise<void> | undefined;
    await act(async () => {
      first = rendered.getSession().refreshUser();
      await Promise.resolve();
    });
    expect(rendered.getSession().refreshing).toBe(true);
    const duringPending = mocks.loadMe.mock.calls.length;
    await act(async () => { await rendered.getSession().refreshUser(); });
    expect(mocks.loadMe.mock.calls.length).toBe(duringPending);

    rejectPending(new Error('temporary failure'));
    await act(async () => { await first; });
    expect(rendered.getSession().refreshing).toBe(false);
    expect(rendered.getSession().refreshCooldownSeconds).toBe(15);

    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(rendered.getSession().refreshCooldownSeconds).toBe(0);

    await act(async () => { rendered.root.unmount(); });
  });
});
