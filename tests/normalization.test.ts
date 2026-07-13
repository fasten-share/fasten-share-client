import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_CONCURRENCY, normalizeMaxConcurrency } from '@/lib/concurrency';
import { MAX_COST_MULTIPLIER, MIN_COST_MULTIPLIER, normalizeCostMultiplier } from '@/lib/cost';
import { defaultVersionPrefix, normalizeVersionPrefix, versionPrefixOrDefault } from '@/lib/version-prefix';
import { TOOL_IDS, isToolId, normalizeSupportedTools, toolsForProtocol } from '@/lib/tool-support';

describe('numeric configuration normalization', () => {
  it.each([[5, 5], ['7', 7], [2.9, 2], ['1.9', 1]])('normalizes concurrency %j to %j', (input, expected) => {
    expect(normalizeMaxConcurrency(input)).toBe(expected);
  });

  it.each([0, -1, NaN, Infinity, -Infinity, 'nope', undefined, null])('falls back for invalid concurrency %j', (input) => {
    expect(normalizeMaxConcurrency(input)).toBe(DEFAULT_MAX_CONCURRENCY);
  });

  it('clamps cost multipliers and accepts numeric strings', () => {
    expect(normalizeCostMultiplier('2.5')).toBe(2.5);
    expect(normalizeCostMultiplier(0)).toBe(MIN_COST_MULTIPLIER);
    expect(normalizeCostMultiplier(-100)).toBe(MIN_COST_MULTIPLIER);
    expect(normalizeCostMultiplier(1000)).toBe(MAX_COST_MULTIPLIER);
    expect(normalizeCostMultiplier('invalid')).toBe(1);
  });
});

describe('version prefixes', () => {
  it.each([['v1', '/v1'], ['/v1/', '/v1'], [' /v1/models/// ', '/v1/models'], ['/', '/'], ['/a:b@c;d,e', '/a:b@c;d,e']])('normalizes %j', (input, expected) => {
    expect(normalizeVersionPrefix(input)).toBe(expected);
  });

  it.each(['', '   ', '/a//b', '/.', '/..', '/v1?x=1', '/v1#x', '\\v1', {}, 42])('rejects unsafe or malformed prefix %j', (input) => {
    expect(normalizeVersionPrefix(input)).toBeUndefined();
  });

  it('provides protocol defaults and a generic fallback', () => {
    expect(defaultVersionPrefix('openai')).toBe('/v1');
    expect(defaultVersionPrefix('gemini')).toBe('/v1beta');
    expect(defaultVersionPrefix('future-protocol')).toBe('/');
    expect(versionPrefixOrDefault('', 'anthropic')).toBe('/v1');
    expect(versionPrefixOrDefault('/custom', 'openai')).toBe('/custom');
  });
});

describe('tool support', () => {
  it('recognizes only known tool ids', () => {
    for (const tool of TOOL_IDS) expect(isToolId(tool)).toBe(true);
    expect(isToolId('unknown')).toBe(false);
    expect(isToolId(null)).toBe(false);
  });

  it('filters tools by protocol', () => {
    expect(toolsForProtocol('anthropic')).toContain('claude');
    expect(toolsForProtocol('anthropic')).not.toContain('codex');
    expect(toolsForProtocol('openai-response')).toEqual(expect.arrayContaining(['codex', 'opencode']));
    expect(toolsForProtocol('gemini')).not.toEqual(expect.arrayContaining(['claude', 'codex', 'opencode']));
  });

  it('deduplicates, orders, filters, and always falls back to curl', () => {
    expect(normalizeSupportedTools(['hermes', 'curl', 'hermes', 'bad'])).toEqual(['curl', 'hermes']);
    expect(normalizeSupportedTools(['codex'], 'anthropic')).toEqual(['curl']);
    expect(normalizeSupportedTools(undefined)).toEqual(['curl']);
  });
});
