import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapterFor, adapters, DEFAULT_AZURE_API_VERSION } from '@/lib/server/protocols';
import { buildAdvertisedOfferings, joinUrl, probeHealth } from '@/lib/server/producer-health';
import type { BackendConfig } from '@/lib/server/types';

const backend = (overrides: Partial<BackendConfig> = {}): BackendConfig => ({
  id: 'b1', baseUrl: 'https://api.example/', protocol: 'openai', models: ['model/a'],
  apiKey: 'secret', enabled: true, costMultiplier: 1, maxConcurrency: 5,
  supportedTools: ['curl'], versionPrefix: '/v1', ...overrides,
});

describe('protocol adapters', () => {
  it('falls back to OpenAI and conditionally injects bearer credentials', () => {
    expect(adapterFor('future')).toBe(adapters.openai);
    expect(adapters.openai.authHeaders(backend())).toEqual({ authorization: 'Bearer secret' });
    expect(adapters.openai.authHeaders(backend({ apiKey: '' }))).toEqual({});
  });

  it.each([
    ['openai', '/chat/completions', 'authorization'],
    ['openai-response', '/responses', 'authorization'],
    ['ollama', '/chat/completions', 'authorization'],
    ['anthropic', '/messages', 'x-api-key'],
    ['gemini', '/models/model%2Fa:generateContent', 'x-goog-api-key'],
  ])('builds the %s health request', (protocol, path, authHeader) => {
    const request = adapters[protocol].health(backend({ protocol }));
    expect(request.path).toBe(path);
    expect(request.headers).toHaveProperty(authHeader);
    expect(JSON.parse(request.body)).toBeTypeOf('object');
  });

  it('builds Azure deployment paths with configured and default API versions', () => {
    expect(adapters['azure-openai'].health(backend({ protocol: 'azure-openai', apiVersion: 'custom' })).path)
      .toBe('/deployments/model%2Fa/chat/completions?api-version=custom');
    expect(adapters['azure-openai'].health(backend({ protocol: 'azure-openai', apiVersion: undefined })).path)
      .toContain(encodeURIComponent(DEFAULT_AZURE_API_VERSION));
  });
});

describe('producer health', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('joins URLs consistently', () => {
    expect(joinUrl('https://api///', 'v1/models')).toBe('https://api/v1/models');
    expect(joinUrl('https://api', '/v1')).toBe('https://api/v1');
  });

  it.each([
    [200, { ok: true }], [401, { ok: false, reason: 'AUTH' }], [403, { ok: false, reason: 'AUTH' }],
    [402, { ok: false, reason: 'QUOTA' }], [429, { ok: false, reason: 'QUOTA' }],
    [500, { ok: false, reason: 'HTTP' }],
  ])('maps HTTP %s to health result', async (status, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeHealth(backend())).resolves.toEqual(expected);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example/v1/chat/completions', expect.objectContaining({ method: 'POST' }));
  });

  it('maps fetch failures to NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(probeHealth(backend())).resolves.toEqual({ ok: false, reason: 'NETWORK' });
  });

  it('aggregates advertised offerings and preserves first backend defaults', () => {
    const backends = [
      backend({ id: 'first', models: ['shared', 'a'], costMultiplier: 2, maxConcurrency: 7, supportedTools: ['curl', 'opencode'], versionPrefix: '/custom' }),
      backend({ id: 'second', models: ['shared', 'b'], costMultiplier: 3, maxConcurrency: 9, supportedTools: ['hermes'], versionPrefix: '/v2' }),
      backend({ id: 'disabled', models: ['hidden'], enabled: false }),
      backend({ id: 'unhealthy', models: ['hidden2'] }),
    ];
    const result = buildAdvertisedOfferings(backends, new Map([['first', true], ['second', true], ['disabled', true]]));
    expect(result).toEqual([{
      protocol: 'openai', models: ['shared', 'a', 'b'],
      costMultipliers: { shared: 2, a: 2, b: 3 },
      supportedTools: { shared: ['curl', 'opencode', 'hermes'], a: ['curl', 'opencode'], b: ['hermes'] },
      versionPrefixes: { shared: '/custom', a: '/custom', b: '/v2' },
      maxConcurrency: { shared: 7, a: 7, b: 9 },
    }]);
  });
});
