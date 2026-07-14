// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  discover: vi.fn(async () => ({ candidates: [], nextCursor: null, hasMore: false, limit: 20 })),
  getStatus: vi.fn(),
}));
vi.mock('@/lib/control-client', () => ({ discoverModels: mocks.discover, getStatus: mocks.getStatus }));

import { DEFAULT_WS_PORT, REPLACED_CODE, WS_PATH } from '@/lib/bridge-protocol';
import { startStatusLink } from '@/lib/client/status-link';
import type { Status } from '@/lib/control-client';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  close(): void { this.closed = true; }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }
  message(data: unknown): void { this.onmessage?.(new MessageEvent('message', { data })); }
  closeEvent(code = 1006): void { this.onclose?.(new CloseEvent('close', { code })); }
}

const seed = (): Status => ({
  configRevision: 0,
  transport: { ready: false, wsPort: DEFAULT_WS_PORT },
  signaling: { connected: false },
  producer: { running: false, registered: false, backends: [] },
  config: { signalUrl: 'wss://signal', autoShare: false, backends: [] },
  connectedProducers: [],
});

describe('status link', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    mocks.getStatus.mockReset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  it('emits the seed immediately, connects locally, and marks transport ready on open', () => {
    const onStatus = vi.fn();
    const handle = startStatusLink(9000, onStatus, seed());
    const socket = FakeWebSocket.instances[0];
    expect(onStatus).toHaveBeenCalledWith(seed());
    expect(socket.url).toBe(`ws://localhost:9000${WS_PATH}`);
    socket.open();
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ transport: { ready: true, wsPort: DEFAULT_WS_PORT } }));
    handle.stop();
    expect(socket.closed).toBe(true);
    expect(socket.onclose).toBeNull();
  });

  it('applies status messages and ignores invalid or unrelated messages', () => {
    const onStatus = vi.fn();
    const handle = startStatusLink(9000, onStatus, seed());
    const socket = FakeWebSocket.instances[0];
    socket.message('{invalid');
    socket.message(JSON.stringify({ t: 'config' }));
    expect(onStatus).toHaveBeenCalledTimes(1);
    socket.message(JSON.stringify({
      t: 'status',
      configRevision: 0,
      producer: { running: true, registered: true, backends: [] },
      connectedProducers: [{ protocol: 'openai', peerId: 'p1' }],
      node: { signaling: { connected: true, peerId: 'node' } },
    }));
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      producer: expect.objectContaining({ running: true }),
      signaling: { connected: true, peerId: 'node' },
      connectedProducers: [{ protocol: 'openai', peerId: 'p1' }],
    }));
    handle.stop();
  });

  it('keeps control API config when a later runtime status push arrives', () => {
    const onStatus = vi.fn();
    const handle = startStatusLink(9000, onStatus, seed());
    const saved = {
      ...seed(),
      config: {
        ...seed().config,
        backends: [{
          id: 'new-backend',
          baseUrl: 'http://localhost:11434',
          protocol: 'ollama',
          models: ['qwen3'],
          apiKey: '',
        }],
      },
    } satisfies Status;

    handle.syncStatus(saved);
    FakeWebSocket.instances[0].message(JSON.stringify({
      t: 'status',
      configRevision: 0,
      producer: { running: true, registered: true, backends: [] },
      connectedProducers: [],
      node: { signaling: { connected: true, peerId: 'node' } },
    }));

    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      config: saved.config,
      producer: expect.objectContaining({ running: true }),
    }));
    handle.stop();
  });

  it('reloads the encrypted config when the Node revision changes', async () => {
    const onStatus = vi.fn();
    const refreshed = {
      ...seed(),
      configRevision: 1,
      signaling: { connected: true, peerId: 'node' },
      config: { ...seed().config, autoShare: true },
    } satisfies Status;
    mocks.getStatus.mockResolvedValue(refreshed);
    const handle = startStatusLink(9000, onStatus, seed());
    FakeWebSocket.instances[0].message(JSON.stringify({
      t: 'status',
      configRevision: 1,
      producer: { running: true, registered: true, backends: [] },
      connectedProducers: [],
      node: { signaling: { connected: true, peerId: 'node' } },
    }));

    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      configRevision: 1,
      config: expect.objectContaining({ autoShare: true }),
      signaling: { connected: true, peerId: 'node' },
    })));
    expect(mocks.getStatus).toHaveBeenCalledOnce();
    handle.stop();
  });

  it('accepts a reset config revision after the Node process restarts', async () => {
    const onStatus = vi.fn();
    const previousProcess = { ...seed(), configRevision: 5 } satisfies Status;
    const restarted = {
      ...seed(),
      configRevision: 0,
      config: { ...seed().config, autoShare: true },
    } satisfies Status;
    mocks.getStatus.mockResolvedValue(restarted);
    const handle = startStatusLink(9000, onStatus, previousProcess);
    FakeWebSocket.instances[0].message(JSON.stringify({
      t: 'status',
      configRevision: 0,
      producer: { running: false, registered: false, backends: [] },
      connectedProducers: [],
      node: { signaling: { connected: false } },
    }));

    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(restarted));
    expect(mocks.getStatus).toHaveBeenCalledOnce();
    handle.stop();
  });

  it('dispatches forced logout events with the server code', () => {
    const listener = vi.fn();
    window.addEventListener('fs:forced-logout', listener);
    const handle = startStatusLink(9000, vi.fn(), seed());
    FakeWebSocket.instances[0].message(JSON.stringify({ t: 'forcedLogout', code: 'DEVICE_LIMIT_EXCEEDED' }));
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe('DEVICE_LIMIT_EXCEEDED');
    handle.stop();
    window.removeEventListener('fs:forced-logout', listener);
  });

  it('delegates discovery arguments to the control client', async () => {
    const handle = startStatusLink(9000, vi.fn(), seed());
    await handle.discover('gpt', 'openai', ['u1'], 'cursor', 5);
    expect(mocks.discover).toHaveBeenCalledWith('gpt', 'openai', ['u1'], 'cursor', 5);
    handle.stop();
  });

  it('reconnects after ordinary closure but yields when replaced', () => {
    vi.useFakeTimers();
    const firstHandle = startStatusLink(9000, vi.fn(), seed());
    FakeWebSocket.instances[0].closeEvent();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    firstHandle.stop();

    FakeWebSocket.instances = [];
    const replacedHandle = startStatusLink(9000, vi.fn(), seed());
    FakeWebSocket.instances[0].closeEvent(REPLACED_CODE);
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    replacedHandle.stop();
    vi.useRealTimers();
  });
});
