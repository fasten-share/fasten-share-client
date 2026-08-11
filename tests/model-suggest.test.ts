import { describe, expect, it } from 'vitest';
import { editDistance, suggestModels } from '../lib/model-suggest';

describe('editDistance', () => {
  it('measures the usual single-character mistakes', () => {
    expect(editDistance('llama3', 'llama3')).toBe(0);
    expect(editDistance('llama3', 'llama4')).toBe(1);
    expect(editDistance('lama3', 'llama3')).toBe(1);
    expect(editDistance('llamma3', 'llama3')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });

  it('handles empty input from either side', () => {
    expect(editDistance('', '')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });

  it('gives up past the budget instead of computing the true distance', () => {
    // The exact value beyond the limit is irrelevant; only "too far" matters.
    expect(editDistance('abc', 'xyzxyzxyz', 2)).toBeGreaterThan(2);
    expect(editDistance('qwen3', 'llama3', 1)).toBeGreaterThan(1);
  });

  it('still returns exact distances inside the budget', () => {
    expect(editDistance('llama3', 'llama4', 3)).toBe(1);
    expect(editDistance('kitten', 'sitting', 3)).toBe(3);
  });
});

describe('suggestModels', () => {
  const catalogue = [
    'qwen3:8b', 'qwen3:14b', 'qwen3-coder-30b', 'llama3:8b', 'mistral:7b', 'phi3:mini',
  ];

  it('suggests nothing without a keyword', () => {
    expect(suggestModels('', catalogue)).toEqual([]);
    expect(suggestModels('   ', catalogue)).toEqual([]);
  });

  it('never suggests the exact name the user already searched', () => {
    // That search returned nothing, so echoing it back would be useless.
    expect(suggestModels('llama3:8b', catalogue)).not.toContain('llama3:8b');
  });

  it('recovers from a one-character typo', () => {
    expect(suggestModels('llama3:8c', catalogue)).toContain('llama3:8b');
    expect(suggestModels('mistrel:7b', catalogue)).toContain('mistral:7b');
  });

  it('ranks prefix matches above substring above fuzzy', () => {
    const hits = suggestModels('qwen3', catalogue);
    expect(hits.slice(0, 3)).toEqual(['qwen3:8b', 'qwen3:14b', 'qwen3-coder-30b']);
  });

  it('prefers the closest name when several are plausible', () => {
    expect(suggestModels('qwen3:9b', catalogue)[0]).toBe('qwen3:8b');
  });

  it('finds a substring that is not a prefix', () => {
    expect(suggestModels('coder', catalogue)).toEqual(['qwen3-coder-30b']);
  });

  it('ignores case', () => {
    expect(suggestModels('QWEN3:8B', catalogue)).not.toContain('qwen3:8b');
    expect(suggestModels('LLaMA3:8c', catalogue)).toContain('llama3:8b');
  });

  it('refuses wild guesses for a short keyword', () => {
    // A tight budget on short names keeps "gpt4" from matching everything.
    expect(suggestModels('gpt4', catalogue)).toEqual([]);
  });

  it('returns nothing when the catalogue is empty', () => {
    expect(suggestModels('llama3', [])).toEqual([]);
  });

  it('de-duplicates names offered by several nodes', () => {
    const repeated = ['llama3:8b', 'llama3:8b', 'llama3:8b'];
    expect(suggestModels('llama3:8c', repeated)).toEqual(['llama3:8b']);
  });

  it('honours the result cap', () => {
    const many = Array.from({ length: 30 }, (_, index) => `qwen3:${index}b`);
    expect(suggestModels('qwen3', many)).toHaveLength(5);
    expect(suggestModels('qwen3', many, 2)).toHaveLength(2);
  });

  it('orders deterministically when rank and distance tie', () => {
    // Same rank and length: fall back to a stable alphabetical order.
    const tied = ['qwen3:zb', 'qwen3:ab', 'qwen3:mb'];
    expect(suggestModels('qwen3:', tied)).toEqual(['qwen3:ab', 'qwen3:mb', 'qwen3:zb']);
  });
});
