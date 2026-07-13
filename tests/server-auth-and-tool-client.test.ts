import { afterEach, describe, expect, it, vi } from 'vitest';
import { bearerHeaders, proxyServer, readBearerToken, requireValidAccessToken } from '@/lib/server/auth';
import {
  applyToolConfig,
  cleanupTool,
  inspectTool,
  listToolBackups,
  previewToolRestore,
  restoreTool,
  verifyTool,
} from '@/lib/tool-config-client';

describe('server authentication helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['Bearer abc', 'abc'], ['bearer abc', 'abc'], ['BEARER abc', 'abc'],
    ['', null], ['Basic abc', null], ['Bearer', null],
  ])('parses authorization %j', (header, expected) => {
    expect(readBearerToken(new Request('https://local', { headers: header ? { authorization: header } : {} }))).toBe(expected);
  });

  it('creates bearer headers and rejects missing credentials locally', async () => {
    expect(bearerHeaders('abc')).toEqual({ authorization: 'Bearer abc' });
    const response = await requireValidAccessToken(new Request('https://local'));
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: 'Missing bearer token.' });
  });

  it.each([[200, null], [401, 401], [503, 503]] as const)('maps upstream auth status %s', async (status, expectedStatus) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    const response = await requireValidAccessToken(new Request('https://local', { headers: { authorization: 'Bearer token' } }));
    if (expectedStatus === null) expect(response).toBeNull();
    else expect(response?.status).toBe(expectedStatus);
  });

  it('maps auth network failures to 502 without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const response = await requireValidAccessToken(new Request('https://local', { headers: { authorization: 'Bearer token' } }));
    expect(response?.status).toBe(502);
    await expect(response?.json()).resolves.toEqual({ error: 'fasten-share-server unreachable: offline' });
  });

  it('proxies status, body, and content type while forcing no-store', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('created', { status: 201, headers: { 'content-type': 'text/plain' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await proxyServer('/api/v1/items', { method: 'POST', body: 'x' });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('text/plain');
    await expect(response.text()).resolves.toBe('created');
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ cache: 'no-store', method: 'POST' }));
  });
});

describe('tool configuration client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends every supported action with JSON and returns results', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init: RequestInit) => Response.json(JSON.parse(String(init.body))));
    vi.stubGlobal('fetch', fetchMock);
    await expect(inspectTool('codex')).resolves.toMatchObject({ action: 'inspect', tool: 'codex' });
    await expect(cleanupTool('claude')).resolves.toMatchObject({ action: 'cleanup' });
    await expect(verifyTool('opencode')).resolves.toMatchObject({ action: 'verify' });
    await expect(listToolBackups('claw')).resolves.toMatchObject({ action: 'list-backups' });
    await expect(previewToolRestore('hermes', 'backup')).resolves.toMatchObject({ action: 'preview-restore', backupId: 'backup' });
    await expect(restoreTool('codex', 'backup')).resolves.toMatchObject({ action: 'restore', backupId: 'backup' });
    await expect(applyToolConfig({ tool: 'codex', protocol: 'openai-response', model: 'm', peerId: 'p', versionPrefix: '/v1', apiKey: 'k' }))
      .resolves.toMatchObject({ action: 'configure', model: 'm' });
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ 'content-type': 'application/json' }) });
  });

  it('uses server errors and a status fallback', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'cannot configure' }, { status: 400 }))
      .mockResolvedValueOnce(new Response('broken', { status: 500 })));
    await expect(inspectTool('codex')).rejects.toThrow('cannot configure');
    await expect(inspectTool('codex')).rejects.toThrow('Request failed (500)');
  });
});
