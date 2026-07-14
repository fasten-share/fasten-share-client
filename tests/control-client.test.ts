import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  encrypt: vi.fn(async (value: string, id: string) => ({ version: 1 as const, iv: `iv-${id}`, ciphertext: value })),
  decrypt: vi.fn(async (value: { ciphertext: string }, id: string) => `${value.ciphertext}-${id}`),
  clearAuthentication: vi.fn(),
}));

vi.mock('@/lib/client/auth', () => ({ authHeaders: () => ({ authorization: 'Bearer token' }) }));
vi.mock('@/lib/client/api-key-crypto', () => ({
  encryptApiKeyForNode: mocks.encrypt,
  decryptApiKeyFromNode: mocks.decrypt,
}));
vi.mock('@/lib/client/auth-session', () => ({ clearAuthentication: mocks.clearAuthentication }));

import { control, discoverModels, getStatus, newBackendId } from '@/lib/control-client';

const status = (encrypted = true) => ({
  configRevision: 0,
  transport: { ready: true, wsPort: 8087 }, signaling: { connected: true },
  producer: { running: true, registered: true, backends: [] }, connectedProducers: [],
  config: {
    signalUrl: 'wss://signal', autoShare: true,
    backends: [{ id: 'b1', baseUrl: 'https://api', protocol: 'openai', models: ['m'], ...(encrypted ? { encryptedApiKey: { version: 1, iv: 'iv', ciphertext: 'secret' } } : {}) }],
  },
});

describe('control client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gets and decrypts status while attaching authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(status()));
    vi.stubGlobal('fetch', fetchMock);
    const result = await getStatus();
    expect(result.config.backends[0].apiKey).toBe('secret-b1');
    expect(fetchMock).toHaveBeenCalledWith('/api/control', { cache: 'no-store', headers: { authorization: 'Bearer token' } });
  });

  it('represents an absent encrypted API key as an empty string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(status(false))));
    expect((await getStatus()).config.backends[0].apiKey).toBe('');
  });

  it('encrypts API keys for update and setBackends actions', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(status(false)));
    vi.stubGlobal('fetch', fetchMock);
    await control({ action: 'updateBackend', backend: { id: 'b1', baseUrl: 'x', protocol: 'openai', models: ['m'], apiKey: 'sk' } });
    await control({ action: 'setBackends', configRevision: 3, backends: [
      { id: 'b2', baseUrl: 'y', protocol: 'openai', models: ['n'], apiKey: 'key2' },
      { baseUrl: 'z', protocol: 'openai', models: [], apiKey: 'not-sent-without-id' },
    ] });
    expect(mocks.encrypt).toHaveBeenCalledWith('sk', 'b1');
    expect(mocks.encrypt).toHaveBeenCalledWith('key2', 'b2');
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.backend).not.toHaveProperty('apiKey');
    expect(firstBody.backend.encryptedApiKey).toEqual({ version: 1, iv: 'iv-b1', ciphertext: 'sk' });
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.configRevision).toBe(3);
    expect(secondBody.backends[1].encryptedApiKey).toBeUndefined();
  });

  it('passes actions without backends through unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(status(false)));
    vi.stubGlobal('fetch', fetchMock);
    await control({ action: 'setAutoShare', autoShare: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'setAutoShare', autoShare: false });
  });

  it('discovers models and supplies safe response defaults', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ candidates: [{ peerId: 'p' }], nextCursor: 'next', hasMore: true, limit: 3 }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(discoverModels('gpt', 'openai', ['u'], 'cursor', 3)).resolves.toMatchObject({ nextCursor: 'next', hasMore: true, limit: 3 });
    await expect(discoverModels('', 'openai')).resolves.toEqual({ candidates: [], nextCursor: null, hasMore: false, limit: 20 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'discover', keyword: 'gpt', protocol: 'openai', publisherUserIds: ['u'], cursor: 'cursor', limit: 3 });
  });

  it('turns JSON and non-JSON failures into status-bearing errors', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ message: 'bad request' }, { status: 400 }))
      .mockResolvedValueOnce(new Response('broken', { status: 502 })));
    await expect(getStatus()).rejects.toMatchObject({ message: 'bad request', status: 400 });
    await expect(getStatus()).rejects.toMatchObject({ message: 'Request failed (502)', status: 502 });
  });

  it('generates recognizable locally unique backend ids', () => {
    const first = newBackendId();
    const second = newBackendId();
    expect(first).toMatch(/^b-[a-z0-9]+-[a-z0-9]+$/);
    expect(first).not.toBe(second);
  });
});
