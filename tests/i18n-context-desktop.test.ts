// @vitest-environment jsdom

import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Lang } from '../lib/i18n/dictionary';

type DesktopWindow = Window & { fastenShareDesktop?: unknown };

afterEach(() => {
  delete (window as DesktopWindow).fastenShareDesktop;
  window.localStorage.clear();
});

describe('i18n provider desktop synchronization', () => {
  it('adopts the desktop language, then sends user changes back', async () => {
    const setLanguage = vi.fn(async (language: Lang) => language);
    Object.defineProperty(window, 'fastenShareDesktop', {
      configurable: true,
      value: {
        getLanguage: vi.fn(async () => 'zh'),
        setLanguage,
        onLanguageChanged: vi.fn(() => () => undefined),
      },
    });

    const { I18nProvider, useI18n } = await import('../lib/i18n/context');
    let renderedLanguage: Lang | undefined;
    let changeLanguage: ((language: Lang) => void) | undefined;
    function Probe() {
      const i18n = useI18n();
      renderedLanguage = i18n.lang;
      changeLanguage = i18n.setLang;
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(I18nProvider, null, createElement(Probe)));
    });
    expect(renderedLanguage).toBe('zh');
    expect(document.documentElement.lang).toBe('zh');
    expect(window.localStorage.getItem('fs-lang')).toBe('zh');

    await act(async () => changeLanguage?.('en'));
    expect(renderedLanguage).toBe('en');
    expect(setLanguage).toHaveBeenCalledWith('en');

    await act(async () => root.unmount());
  });
});
