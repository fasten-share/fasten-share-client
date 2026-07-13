// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authHeaders,
  cancelWechatLogin,
  clearAccessToken,
  consumeAuthNotice,
  createWechatLoginSession,
  exchangeWechatLogin,
  getAccessToken,
  loadMe,
  logout,
  renewAccessTokenIfNeeded,
  replaceDevice,
  setAccessToken,
  setAuthNotice,
  toAuthError,
} from '@/lib/client/auth-session';
import { getApiKeyEncryptionKey } from '@/lib/client/api-key-crypto';

function jwt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expSeconds })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${payload}.signature`;
}

describe('authentication session', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stores access tokens, returns headers, and clears encryption state with the token', () => {
    expect(getAccessToken()).toBeNull();
    expect(authHeaders()).toEqual({});
    setAccessToken('token');
    localStorage.setItem('fs.apiKeyEncryptionKey', 'encryption-key');
    expect(authHeaders()).toEqual({ authorization: 'Bearer token' });
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
    expect(getApiKeyEncryptionKey()).toBeNull();
  });

  it('consumes notices exactly once', () => {
    setAuthNotice('signed out');
    expect(consumeAuthNotice()).toBe('signed out');
    expect(consumeAuthNotice()).toBe('');
  });

  it('does not refresh absent, malformed, or long-lived tokens', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(renewAccessTokenIfNeeded()).resolves.toBe(false);
    setAccessToken('malformed');
    await expect(renewAccessTokenIfNeeded()).resolves.toBe(false);
    setAccessToken(jwt(Math.floor(Date.now() / 1000) + 48 * 60 * 60));
    await expect(renewAccessTokenIfNeeded()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes an expiring token and stores the replacement', async () => {
    setAccessToken(jwt(Math.floor(Date.now() / 1000) + 60));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ accessToken: 'renewed' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(renewAccessTokenIfNeeded()).resolves.toBe(true);
    expect(getAccessToken()).toBe('renewed');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', expect.objectContaining({ method: 'POST' }));
  });

  it('clears authentication when refresh is unauthorized', async () => {
    setAccessToken(jwt(Math.floor(Date.now() / 1000) + 60));
    localStorage.setItem('fs.apiKeyEncryptionKey', 'key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: 'expired' }, { status: 401 })));
    await expect(renewAccessTokenIfNeeded()).rejects.toEqual(expect.objectContaining({ status: 401, message: 'expired' }));
    expect(getAccessToken()).toBeNull();
    expect(getApiKeyEncryptionKey()).toBeNull();
  });

  it('loads the current user and handles unauthorized responses', async () => {
    await expect(loadMe()).resolves.toBeNull();
    setAccessToken('token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ user: { id: 'u1' } }))
      .mockResolvedValueOnce(Response.json({}, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadMe()).resolves.toEqual({ id: 'u1' });
    await expect(loadMe()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('creates login sessions with the exact request body', async () => {
    const session = { sessionId: 's1' };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(session));
    vi.stubGlobal('fetch', fetchMock);
    const body = { agreementAccepted: true as const, inviteCode: 'i', next: '/', lang: 'cn' as const };
    await expect(createWechatLoginSession(body)).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/wechat/sessions', expect.objectContaining({ body: JSON.stringify(body) }));
  });

  it('handles pending, device-limit, consumed, and successful exchanges', async () => {
    const result = { accessToken: 'access', encryptionKey: 'encrypt', user: { id: 'u' } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ code: 'DEVICE_LIMIT_EXCEEDED', devices: [] }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ code: 'ALREADY_USED' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json(result));
    vi.stubGlobal('fetch', fetchMock);
    await expect(exchangeWechatLogin('s/id', 'client')).resolves.toBeNull();
    await expect(exchangeWechatLogin('s', 'client')).resolves.toMatchObject({ code: 'DEVICE_LIMIT_EXCEEDED' });
    await expect(exchangeWechatLogin('s', 'client')).rejects.toMatchObject({ status: 409 });
    await expect(exchangeWechatLogin('s', 'client')).resolves.toEqual(result);
    expect(getAccessToken()).toBe('access');
    expect(getApiKeyEncryptionKey()).toBe('encrypt');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/wechat/sessions/s%2Fid/exchange');
  });

  it('rejects a successful login response without an encryption key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ accessToken: 'access' })));
    await expect(exchangeWechatLogin('s', 'c')).rejects.toMatchObject({ status: 502 });
    expect(getAccessToken()).toBeNull();
  });

  it('replaces devices and tolerates an absent optional encryption key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ accessToken: 'new-token' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(replaceDevice('replacement', 'device')).resolves.toMatchObject({ accessToken: 'new-token' });
    expect(getAccessToken()).toBe('new-token');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/devices/replace', expect.objectContaining({
      body: JSON.stringify({ replacementToken: 'replacement', targetDeviceId: 'device' }),
    }));
  });

  it('treats a missing cancelled session as success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(cancelWechatLogin('s/id', 'client')).resolves.toBeUndefined();
  });

  it('always clears local authentication during logout, including network failure', async () => {
    setAccessToken('token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(logout()).rejects.toThrow('offline');
    expect(getAccessToken()).toBeNull();
  });
});

describe('toAuthError', () => {
  it('prefers message, supports arrays, error fallback, and invalid JSON', async () => {
    await expect(toAuthError(Response.json({ message: ['a', 'b'] }, { status: 400 })))
      .resolves.toEqual({ message: 'a, b', status: 400, blockedUntil: undefined });
    await expect(toAuthError(Response.json({ error: 'fallback' }, { status: 500 })))
      .resolves.toMatchObject({ message: 'fallback', status: 500 });
    await expect(toAuthError(new Response('not-json', { status: 502 })))
      .resolves.toMatchObject({ message: 'Request failed (502)', status: 502 });
  });

  it('renders a valid account block timestamp for 403', async () => {
    const blockedUntil = '2030-01-02T03:04:05.000Z';
    const error = await toAuthError(Response.json({ message: 'blocked', blockedUntil }, { status: 403 }));
    expect(error.blockedUntil).toBe(blockedUntil);
    expect(error.message).toContain('账号已被封禁');
  });
});
