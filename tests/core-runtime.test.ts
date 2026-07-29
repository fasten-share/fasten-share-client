/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendConfig } from '@/lib/server/types';

type Handler = (...args: any[]) => void;

const state = vi.hoisted(() => {
  const link = {
    port: 8087,
    send: vi.fn(() => true),
    on: vi.fn(),
  };
  const accountStore = {
    accounts: vi.fn(() => []),
    readProfile: vi.fn(),
    saveProfile: vi.fn(),
    saveAccount: vi.fn(),
    updateToken: vi.fn(),
    logout: vi.fn(),
    requireReauth: vi.fn(),
  };
  return {
    link,
    accountStore,
    connections: [] as any[],
    daemons: [] as any[],
    config: {
      all: vi.fn(() => ({
        serverUrl: 'https://server.example/base',
        deviceId: 'device-1',
      })),
      setLastActiveUserId: vi.fn(),
    },
  };
});

vi.mock('@/lib/server/account-store', () => ({
  accountStore: state.accountStore,
}));
vi.mock('@/lib/server/browser-link', () => ({
  getBrowserLink: () => state.link,
}));
vi.mock('@/lib/server/config', () => ({
  config: state.config,
}));
vi.mock('@/lib/server/api-key-crypto', () => ({
  generateApiKeyEncryptionKey: () => 'generated-encryption-key',
}));
vi.mock('@/lib/server/producer-connection', () => ({
  ProducerConnection: class {
    handlers = new Map<string, Handler>();
    connected = false;
    start = vi.fn();
    stop = vi.fn();
    setUrl = vi.fn();
    constructor(readonly url: string, readonly deviceId: string) {
      state.connections.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, handler);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.(...args);
    }
  },
}));
vi.mock('@/lib/server/producer', () => ({
  ProducerDaemon: class {
    handlers = new Map<string, Handler>();
    setAccessToken = vi.fn();
    start = vi.fn();
    stop = vi.fn();
    setBackends = vi.fn();
    addBackend = vi.fn();
    updateBackend = vi.fn();
    removeBackend = vi.fn();
    disableBackend = vi.fn();
    onSignalingOpen = vi.fn();
    constructor(readonly connection: unknown) {
      state.daemons.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, handler);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.(...args);
    }
  },
}));

import {
  AccountRuntime,
  Core,
  tokenUserId,
} from '@/lib/server/core';

function token(sub: unknown, exp?: number): string {
  return `header.${Buffer.from(JSON.stringify({ sub, exp })).toString('base64url')}.signature`;
}

const existingBackend: BackendConfig = {
  id: 'backend-1',
  baseUrl: 'https://upstream.example',
  apiKey: 'preserved-secret',
  protocol: 'openai',
  models: ['gpt-test'],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.connections.length = 0;
  state.daemons.length = 0;
  state.accountStore.accounts.mockReturnValue([]);
  state.accountStore.readProfile.mockReturnValue({
    user: { id: '42', displayName: 'User 42' },
    autoShare: false,
    backends: [existingBackend],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('account runtime token and lifecycle', () => {
  it('accepts only numeric JWT subjects', () => {
    expect(tokenUserId(token('42'))).toBe('42');
    expect(tokenUserId(token('not-numeric'))).toBeNull();
    expect(tokenUserId(token(42))).toBeNull();
    expect(tokenUserId('not-a-token')).toBeNull();
  });

  it('creates and clears encryption sessions for matching users', () => {
    const core = new Core();
    expect(() => core.beginEncryptionSession(token('41'), {
      id: '42',
      displayName: 'User',
    } as any)).toThrow('invalid login token');

    const accessToken = token('42');
    expect(core.beginEncryptionSession(accessToken, {
      id: '42',
      displayName: 'User',
    } as any)).toBe('generated-encryption-key');
    expect(state.accountStore.saveAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: '42' }),
      accessToken,
      'generated-encryption-key',
    );
    expect(state.config.setLastActiveUserId).toHaveBeenCalledWith('42');
    expect(core.encryptionKeyForToken(accessToken)).toBe('generated-encryption-key');

    core.setAccessToken(token('42'));
    expect(state.accountStore.updateToken).toHaveBeenCalledWith('42', token('42'));
    core.clearEncryptionSession(accessToken);
    expect(state.accountStore.logout).toHaveBeenCalledWith('42');
    expect(core.runtimeForToken(accessToken)).toBeNull();
  });

  it('invalidates a runtime when the signaling server forces logout', () => {
    const core = new Core();
    const accessToken = token('42');
    core.beginEncryptionSession(accessToken, {
      id: '42',
      displayName: 'User',
    } as any);
    state.connections[0].emit('forcedLogout', 'DEVICE_LIMIT_EXCEEDED');

    expect(state.accountStore.requireReauth).toHaveBeenCalledWith('42');
    expect(state.link.send).toHaveBeenCalledWith({
      t: 'forcedLogout',
      userId: '42',
      code: 'DEVICE_LIMIT_EXCEEDED',
    });
    expect(core.runtimeForToken(accessToken)).toBeNull();
  });
});

describe('account runtime producer configuration', () => {
  function runtime(accessToken = token('42')) {
    return new AccountRuntime(
      '42',
      accessToken,
      'encryption-key',
      state.link as any,
      vi.fn(),
    );
  }

  it('normalizes updates, preserves a stored API key, and controls the daemon', () => {
    const subject = runtime();
    subject.updateBackend({
      ...existingBackend,
      apiKey: undefined,
      costMultiplier: Number.POSITIVE_INFINITY,
      maxConcurrency: 0,
      supportedTools: ['codex'],
      protocolConversions: ['openai-response', 'unsupported'],
      versionPrefix: 'v1/',
    });

    const saved = state.accountStore.saveProfile.mock.calls.at(-1)?.[0];
    expect(saved.backends[0]).toEqual(expect.objectContaining({
      apiKey: 'preserved-secret',
      costMultiplier: 1,
      maxConcurrency: 5,
      supportedTools: ['codex'],
      protocolConversions: ['openai-response'],
      versionPrefix: '/v1',
    }));
    expect(state.daemons[0].updateBackend).toHaveBeenCalledWith(saved.backends[0]);

    subject.setBackendEnabled('backend-1', false);
    expect(state.daemons[0].disableBackend).toHaveBeenCalledWith('backend-1');
    subject.removeBackend('backend-1');
    expect(state.daemons[0].removeBackend).toHaveBeenCalledWith('backend-1');
    subject.setBackends([]);
    expect(state.daemons[0].stop).toHaveBeenCalledWith('manual');
  });

  it('reports missing configuration and pushes producer status changes', () => {
    state.accountStore.readProfile.mockReturnValueOnce({
      user: { id: '42' },
      autoShare: false,
      backends: [],
    });
    const subject = runtime();
    expect(subject.startProducer()).toEqual({
      ok: false,
      error: 'no backend configured',
    });

    subject.addBackend(existingBackend);
    state.daemons[0].emit('status', {
      running: true,
      registered: true,
      backends: [],
    });
    state.connections[0].connected = true;
    state.connections[0].emit('registered', 'producer-1');
    expect(state.link.send).toHaveBeenCalledWith(expect.objectContaining({
      t: 'status',
      userId: '42',
      producer: expect.objectContaining({ running: true }),
      node: { signaling: { connected: true, peerId: 'producer-1' } },
    }));
  });
});

describe('account runtime discovery and renewal', () => {
  it('builds discovery queries and maps defaults and HTTP failures', async () => {
    const subject = new AccountRuntime(
      '42',
      token('42'),
      'key',
      state.link as any,
      vi.fn(),
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ peerId: 'peer-1' }],
      hasMore: true,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(subject.discoverModels(
      'gpt',
      'openai',
      ['7', '8'],
      'cursor',
      10,
    )).resolves.toEqual({
      candidates: [{ peerId: 'peer-1' }],
      nextCursor: null,
      hasMore: true,
      limit: 10,
    });
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      keyword: 'gpt',
      protocol: 'openai',
      publisherUserIds: '7,8',
      cursor: 'cursor',
      limit: '10',
    });

    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(subject.discoverModels('', 'openai')).rejects.toMatchObject({
      message: 'producer discovery failed (503)',
      status: 503,
    });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(subject.discoverModels('', 'openai')).rejects.toMatchObject({
      message: 'fasten-share-server unreachable: offline',
      status: 502,
    });
  });

  it('refreshes expiring tokens and invalidates rejected sessions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T00:00:00Z'));
    const onInvalid = vi.fn();
    const subject = new AccountRuntime(
      '42',
      token('42', Math.floor(Date.now() / 1000) + 1),
      'key',
      state.link as any,
      onInvalid,
    );
    const refreshed = token('42', Math.floor(Date.now() / 1000) + 100_000);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accessToken: refreshed,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.accountStore.updateToken).toHaveBeenCalledWith('42', refreshed);
    expect(subject.token()).toBe(refreshed);

    await (subject as any).renew();
    expect(onInvalid).toHaveBeenCalledWith('42');
  });
});
