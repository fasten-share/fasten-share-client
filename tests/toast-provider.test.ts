// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n/context';
import { ToastProvider, useToast } from '../app/components/ToastProvider';

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  document.body.replaceChildren();
});

describe('ToastProvider', () => {
  it('shows, dismisses, and expires an accessible toast', async () => {
    vi.useFakeTimers();
    let showToast: ReturnType<typeof useToast>['showToast'] | undefined;

    function Probe() {
      showToast = useToast().showToast;
      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(ToastProvider, null, createElement(Probe))),
      );
    });

    await act(async () => showToast?.('Payment successful.', { tone: 'success', duration: 1000 }));
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Payment successful.');
    expect(document.querySelector('button[aria-label="Dismiss notification"]')).not.toBeNull();

    await act(async () => vi.advanceTimersByTime(1000));
    expect(document.querySelector('[role="status"]')).toBeNull();

    await act(async () => root.unmount());
  });
});
