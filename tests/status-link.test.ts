// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const discoverMock = vi.hoisted(() => vi.fn(async () => ({ candidates: [], page: 1, pageSize: 20, total: 0 })));
vi.mock('@/lib/control-client', () => ({ discoverModels: discoverMock }));

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
  transport: { ready: false, wsPort: DEFAULT_WS_PORT },
  signaling: { connected: false },
  producer: { running: false, registered: false, backends: [] },
  config: { signalUrl: 'wss://signal', autoShare: false, backends: [] },
  connectedProducers: [],
});

describe('status link', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
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
    await handle.discover('gpt', 'openai', ['u1'], 2, 5);
    expect(discoverMock).toHaveBeenCalledWith('gpt', 'openai', ['u1'], 2, 5);
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
