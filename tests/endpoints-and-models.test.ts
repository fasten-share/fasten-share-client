import { describe, expect, it } from 'vitest';
import { toolBaseUrlIncludesVersionPrefix, toolEndpoint } from '@/lib/tool-endpoint';
import { emptyDraft, parseModels, toCard, toInput, type Card } from '@/app/components/producer-form-model';
import { buildCurl, buildToolEndpoint, formatMultiplier, rowKey, targetKey } from '@/app/components/consumer-utils';

describe('tool endpoints', () => {
  it.each([
    ['claude', 'anthropic', false], ['claw', 'anthropic', false], ['hermes', 'anthropic', false],
    ['codex', 'openai-response', true], ['opencode', 'openai', true],
  ] as const)('%s with %s includes prefix: %s', (tool, protocol, expected) => {
    expect(toolBaseUrlIncludesVersionPrefix(tool, protocol)).toBe(expected);
  });

  it('joins a prefix without duplicate trailing slashes', () => {
    expect(toolEndpoint('http://local/route///', '/v1', 'codex', 'openai-response')).toBe('http://local/route/v1');
    expect(toolEndpoint('http://local/route', '/', 'codex', 'openai-response')).toBe('http://local/route');
  });
});

describe('producer form model', () => {
  it('creates an independent default draft', () => {
    const first = emptyDraft();
    first.supportedTools.push('hermes');
    expect(emptyDraft()).toMatchObject({ baseUrl: 'http://localhost:11434', protocol: 'openai', supportedTools: ['curl'], versionPrefix: '/v1' });
  });

  it('parses comma/newline separated models and removes blanks', () => {
    expect(parseModels(' gpt-4o,\nclaude-3 ,, gemini ')).toEqual(['gpt-4o', 'claude-3', 'gemini']);
  });

  it('normalizes persisted backend values into a card', () => {
    expect(toCard({ id: 'b1', baseUrl: 'https://api', protocol: 'openai', models: ['a', 'b'], apiKey: '', costMultiplier: 0, maxConcurrency: 0, supportedTools: ['codex'], enabled: undefined })).toMatchObject({
      id: 'b1', modelsText: 'a, b', costMultiplier: 0.001, maxConcurrency: 5, supportedTools: ['curl'], enabled: true, versionPrefix: '/v1',
    });
  });

  it('trims and converts an Azure card into backend input', () => {
    const card: Card = {
      id: ' b-1 ', baseUrl: ' https://azure.example/// ', protocol: 'azure-openai', apiVersion: ' 2025-01-01 ',
      modelsText: 'one, two\none', costMultiplier: 2000, maxConcurrency: 3.8, apiKey: '',
      supportedTools: ['curl', 'hermes'], versionPrefix: ' openai/ ', enabled: false,
    };
    expect(toInput(card)).toEqual({
      id: ' b-1 ', baseUrl: 'https://azure.example', protocol: 'azure-openai', models: ['one', 'two', 'one'],
      costMultiplier: 999, maxConcurrency: 3, apiKey: undefined, apiVersion: '2025-01-01', enabled: false,
      supportedTools: ['curl', 'hermes'], versionPrefix: '/openai',
    });
  });

  it('drops apiVersion for non-Azure protocols', () => {
    const card = { ...toCard({ id: 'x', baseUrl: 'x', protocol: 'openai', models: [], apiKey: '' }), apiVersion: 'x' };
    expect(toInput(card).apiVersion).toBeUndefined();
  });
});

describe('consumer command helpers', () => {
  const target = { model: '模型/a', protocol: 'openai', peerId: 'peer-1', versionPrefix: '/v1' };

  it('builds stable keys and formats multipliers', () => {
    expect(rowKey(target)).toBe('openai 模型/a');
    expect(targetKey(target)).toBe('openai\0模型/a\0peer-1');
    expect(formatMultiplier(1)).toBe('1x');
    expect(formatMultiplier(1.25)).toBe('1.25x');
  });

  it('base64url-encodes model names in curl routes', () => {
    const command = buildCurl('https://share', target, 'secret');
    expect(command).toContain('https://share/openai/5qih5Z6LL2E/peer-1/v1/chat/completions');
    expect(command).toContain('Authorization: Bearer secret');
    expect(command).toContain('"model":"模型/a"');
  });

  it.each([
    ['anthropic', '/messages', 'anthropic-version'], ['openai-response', '/responses', '"input"'],
    ['gemini', ':generateContent', '"contents"'], ['azure-openai', 'chat/completions?api-version=', '"messages"'],
  ])('builds a protocol-specific %s command', (protocol, path, bodyMarker) => {
    const command = buildCurl('https://share', { ...target, protocol }, 'key');
    expect(command).toContain(path);
    expect(command).toContain(bodyMarker);
  });

  it('builds tool endpoints with per-tool prefix rules', () => {
    expect(buildToolEndpoint('https://share', target, 'opencode')).toMatch(/\/peer-1\/v1$/);
    expect(buildToolEndpoint('https://share', { ...target, protocol: 'anthropic' }, 'claude')).toMatch(/\/peer-1$/);
  });
});
