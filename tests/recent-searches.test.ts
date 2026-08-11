// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RECENT_LIMIT, addRecent, clearRecent, getRecent, parseRecent, recordRecent,
  removeRecent, resetRecentCache, storageKey, subscribeToRecent,
} from '../lib/recent-searches';

beforeEach(() => {
  window.localStorage.clear();
  resetRecentCache();
});

afterEach(() => {
  window.localStorage.clear();
  resetRecentCache();
});

describe('addRecent', () => {
  it('puts the newest search first', () => {
    const one = addRecent([], { keyword: 'llama3', protocol: '' });
    const two = addRecent(one, { keyword: 'qwen3', protocol: 'openai' });
    expect(two.map((entry) => entry.keyword)).toEqual(['qwen3', 'llama3']);
  });

  it('moves a repeated search up rather than duplicating it', () => {
    let list = addRecent([], { keyword: 'llama3', protocol: '' });
    list = addRecent(list, { keyword: 'qwen3', protocol: '' });
    list = addRecent(list, { keyword: 'llama3', protocol: '' });
    expect(list.map((entry) => entry.keyword)).toEqual(['llama3', 'qwen3']);
  });

  it('treats a different protocol as a different search', () => {
    let list = addRecent([], { keyword: 'llama3', protocol: 'openai' });
    list = addRecent(list, { keyword: 'llama3', protocol: 'ollama' });
    expect(list).toHaveLength(2);
  });

  it('de-duplicates case-insensitively', () => {
    let list = addRecent([], { keyword: 'Llama3', protocol: '' });
    list = addRecent(list, { keyword: 'llama3', protocol: '' });
    expect(list).toHaveLength(1);
    // The newest spelling is the one kept.
    expect(list[0].keyword).toBe('llama3');
  });

  it('does not remember browsing everything', () => {
    // An empty keyword is the "show me all" button, not a search term.
    expect(addRecent([], { keyword: '', protocol: '' })).toEqual([]);
    expect(addRecent([], { keyword: '   ', protocol: 'openai' })).toEqual([]);
  });

  it('trims the stored term', () => {
    expect(addRecent([], { keyword: '  llama3  ', protocol: '' })[0].keyword).toBe('llama3');
  });

  it('drops the oldest past the cap', () => {
    let list: ReturnType<typeof addRecent> = [];
    for (let index = 0; index < RECENT_LIMIT + 3; index += 1) {
      list = addRecent(list, { keyword: `model-${index}`, protocol: '' });
    }
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].keyword).toBe(`model-${RECENT_LIMIT + 2}`);
    expect(list.some((entry) => entry.keyword === 'model-0')).toBe(false);
  });

  it('leaves the input untouched', () => {
    const original = addRecent([], { keyword: 'llama3', protocol: '' });
    addRecent(original, { keyword: 'qwen3', protocol: '' });
    expect(original).toHaveLength(1);
  });
});

describe('parseRecent', () => {
  it('starts empty for missing or broken storage', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{oops')).toEqual([]);
    expect(parseRecent('{"not":"an array"}')).toEqual([]);
  });

  it('skips malformed entries instead of failing', () => {
    const raw = JSON.stringify([
      { keyword: 'llama3', protocol: '' },
      { protocol: 'openai' },
      null,
      'nope',
      { keyword: '   ', protocol: '' },
      { keyword: 'qwen3', protocol: 42 },
    ]);
    expect(parseRecent(raw)).toEqual([
      { keyword: 'llama3', protocol: '' },
      { keyword: 'qwen3', protocol: '' },
    ]);
  });

  it('caps an oversized stored list', () => {
    const raw = JSON.stringify(
      Array.from({ length: 50 }, (_, index) => ({ keyword: `m${index}`, protocol: '' })),
    );
    expect(parseRecent(raw)).toHaveLength(RECENT_LIMIT);
  });
});

describe('recent search store', () => {
  it('persists per user', () => {
    recordRecent('u1', { keyword: 'llama3', protocol: '' });
    expect(window.localStorage.getItem(storageKey('u1'))).toContain('llama3');
    expect(getRecent('u2')).toEqual([]);
  });

  it('reloads what was stored', () => {
    recordRecent('u1', { keyword: 'llama3', protocol: 'openai' });
    resetRecentCache();
    expect(getRecent('u1')).toEqual([{ keyword: 'llama3', protocol: 'openai' }]);
  });

  it('ignores a signed-out user', () => {
    recordRecent('', { keyword: 'llama3', protocol: '' });
    expect(window.localStorage.length).toBe(0);
  });

  it('notifies subscribers when the list changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRecent(listener);

    recordRecent('u1', { keyword: 'llama3', protocol: '' });
    expect(listener).toHaveBeenCalledTimes(1);

    // Re-running the newest search leaves the list identical.
    recordRecent('u1', { keyword: 'llama3', protocol: '' });
    expect(listener).toHaveBeenCalledTimes(1);

    // An empty keyword is never recorded, so nothing changes.
    recordRecent('u1', { keyword: '', protocol: '' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    recordRecent('u1', { keyword: 'qwen3', protocol: '' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('still notifies when a repeat search reorders the list', () => {
    recordRecent('u1', { keyword: 'llama3', protocol: '' });
    recordRecent('u1', { keyword: 'qwen3', protocol: '' });
    const listener = vi.fn();
    subscribeToRecent(listener);

    recordRecent('u1', { keyword: 'llama3', protocol: '' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getRecent('u1')[0].keyword).toBe('llama3');
  });

  it('removes a single entry', () => {
    recordRecent('u1', { keyword: 'llama3', protocol: '' });
    recordRecent('u1', { keyword: 'qwen3', protocol: '' });
    removeRecent('u1', { keyword: 'llama3', protocol: '' });
    expect(getRecent('u1').map((entry) => entry.keyword)).toEqual(['qwen3']);
  });

  it('does nothing when removing something absent', () => {
    const listener = vi.fn();
    subscribeToRecent(listener);
    recordRecent('u1', { keyword: 'llama3', protocol: '' });
    removeRecent('u1', { keyword: 'nope', protocol: '' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears everything for one user only', () => {
    recordRecent('u1', { keyword: 'llama3', protocol: '' });
    recordRecent('u2', { keyword: 'qwen3', protocol: '' });
    clearRecent('u1');
    expect(getRecent('u1')).toEqual([]);
    expect(getRecent('u2')).toHaveLength(1);
  });

  it('returns a stable snapshot for an external store', () => {
    expect(getRecent('u1')).toBe(getRecent('u1'));
    recordRecent('u1', { keyword: 'llama3', protocol: '' });
    expect(getRecent('u1')).toBe(getRecent('u1'));
  });
});
