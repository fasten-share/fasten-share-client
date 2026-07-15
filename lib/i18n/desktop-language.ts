import type { Lang } from './dictionary';

interface DesktopLanguageBridge {
  getLanguage: () => Promise<unknown>;
  setLanguage: (language: Lang) => Promise<unknown>;
  onLanguageChanged?: (listener: (language: unknown) => void) => () => void;
}

type DesktopWindow = Window & {
  fastenShareDesktop?: DesktopLanguageBridge;
};

function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'zh';
}

function getBridge(): DesktopLanguageBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as DesktopWindow).fastenShareDesktop;
}

export async function getDesktopLanguage(): Promise<Lang | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  try {
    const language = await bridge.getLanguage();
    return isLang(language) ? language : null;
  } catch {
    return null;
  }
}

export async function setDesktopLanguage(language: Lang): Promise<void> {
  try {
    await getBridge()?.setLanguage(language);
  } catch {
    // The same client bundle also runs in browsers, so desktop sync is best-effort.
  }
}

export function subscribeToDesktopLanguage(listener: (language: Lang) => void): () => void {
  const subscribe = getBridge()?.onLanguageChanged;
  if (!subscribe) return () => undefined;
  try {
    return subscribe((language) => {
      if (isLang(language)) listener(language);
    });
  } catch {
    return () => undefined;
  }
}
