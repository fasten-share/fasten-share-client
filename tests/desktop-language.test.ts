// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDesktopLanguage,
  setDesktopLanguage,
  subscribeToDesktopLanguage,
} from '../lib/i18n/desktop-language';

type DesktopWindow = Window & { fastenShareDesktop?: unknown };

function installBridge(bridge: unknown): void {
  Object.defineProperty(window, 'fastenShareDesktop', {
    value: bridge,
    configurable: true,
  });
}

afterEach(() => {
  delete (window as DesktopWindow).fastenShareDesktop;
});

describe('optional desktop language bridge', () => {
  it('silently falls back when running as a regular website', async () => {
    await expect(getDesktopLanguage()).resolves.toBeNull();
    await expect(setDesktopLanguage('zh')).resolves.toBeUndefined();
    expect(() => subscribeToDesktopLanguage(vi.fn())()).not.toThrow();
  });

  it('reads and writes supported desktop languages', async () => {
    const setLanguage = vi.fn(async () => 'zh');
    installBridge({
      getLanguage: vi.fn(async () => 'zh'),
      setLanguage,
    });

    await expect(getDesktopLanguage()).resolves.toBe('zh');
    await setDesktopLanguage('en');
    expect(setLanguage).toHaveBeenCalledWith('en');
  });

  it('rejects invalid responses and ignores bridge failures', async () => {
    installBridge({
      getLanguage: vi.fn(async () => 'fr'),
      setLanguage: vi.fn(async () => { throw new Error('unavailable'); }),
    });
    await expect(getDesktopLanguage()).resolves.toBeNull();
    await expect(setDesktopLanguage('zh')).resolves.toBeUndefined();
  });

  it('subscribes to valid desktop language changes', () => {
    let desktopListener: ((language: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    installBridge({
      getLanguage: vi.fn(),
      setLanguage: vi.fn(),
      onLanguageChanged: vi.fn((listener) => {
        desktopListener = listener;
        return unsubscribe;
      }),
    });
    const listener = vi.fn();
    const stop = subscribeToDesktopLanguage(listener);
    desktopListener?.('fr');
    desktopListener?.('zh');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('zh');
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
