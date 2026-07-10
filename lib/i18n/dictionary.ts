import { en } from './dictionary.en';
import { zh } from './dictionary.zh';

export type Lang = 'en' | 'zh';

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'zh', label: '中文' },
];

export const dictionaries: Record<Lang, Record<string, string>> = { en, zh };

export type MessageKey = keyof typeof en;
