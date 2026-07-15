'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { dictionaries, type Lang, type MessageKey } from './dictionary';
import {
  getDesktopLanguage,
  setDesktopLanguage,
  subscribeToDesktopLanguage,
} from './desktop-language';

const STORAGE_KEY = 'fs-lang';
const DEFAULT_LANG: Lang = 'en';

type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nValue | null>(null);

// Module-level store so `lang` survives across renders and `useSyncExternalStore`
// can read a stable snapshot. SSR renders DEFAULT_LANG; the client snapshot is
// detected from localStorage / navigator, and useSyncExternalStore reconciles
// the two without a hydration-mismatch warning.
let cachedLang: Lang | null = null;
const listeners = new Set<() => void>();

/** Persisted choice, falling back to the browser language. */
function readLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'zh') return stored;
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function readStoredLang(): Lang | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'zh' ? stored : null;
}

function getSnapshot(): Lang {
  if (cachedLang === null) cachedLang = readLang();
  return cachedLang;
}

function getServerSnapshot(): Lang {
  return DEFAULT_LANG;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setLangGlobal(next: Lang): void {
  const changed = cachedLang !== next;
  cachedLang = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, next);
  }
  if (changed) listeners.forEach((l) => l());
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Keep the <html lang> attribute in sync with the active language.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    let active = true;
    const storedLanguage = readStoredLang();
    const initialLanguage = getSnapshot();

    if (storedLanguage) {
      void setDesktopLanguage(storedLanguage);
    } else {
      void getDesktopLanguage().then((desktopLanguage) => {
        if (active && desktopLanguage && getSnapshot() === initialLanguage) {
          setLangGlobal(desktopLanguage);
        }
      });
    }

    const unsubscribe = subscribeToDesktopLanguage((desktopLanguage) => {
      if (active) setLangGlobal(desktopLanguage);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangGlobal(next);
    void setDesktopLanguage(next);
  }, []);

  const t = useCallback<TFunction>(
    (key, vars) => {
      const value = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
      return interpolate(value, vars);
    },
    [lang],
  );

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
