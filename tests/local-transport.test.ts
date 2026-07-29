/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BinaryFrameType,
  encodeBinaryFrame,
} from '@/lib/server/binary-frame';
import { API_VERSION, WIRE_VERSION } from '@/lib/server/protocol-version';
import { REPLACED_CODE } from '@/lib/bridge-protocol';

type Handler = (...args: any[]) => void;

const wsState = vi.hoisted(() => ({
  sockets: [] as any[],
  servers: [] as any[],
  Socket: undefined as any,
}));

vi.mock('ws', () => {
  class MockWebSocket {
    static OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;
    handlers = new Map<string, Handler[]>();
    send = vi.fn((_value: unknown, options?: unknown, callback?: (error?: Error) => void) => {
      if (typeof options === 'function') options();
      else callback?.();
    });
    close = vi.fn(() => {
      this.readyState = 3;
    });

    constructor(readonly url?: string) {
      wsState.sockets.push(this);
    }

    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
  }

  class MockWebSocketServer {
    handlers = new Map<string, Handler[]>();
    constructor(readonly options: object) {
      wsState.servers.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
  }

  wsState.Socket = MockWebSocket;
  return { WebSocket: MockWebSocket, WebSocketServer: MockWebSocketServer };
});

import { BrowserLink } from '@/lib/server/browser-link';
import { ProducerConnection } from '@/lib/server/producer-connection';

beforeEach(() => {
  wsState.sockets.length = 0;
  wsState.servers.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('browser status link', () => {
  it('keeps the newest page active and suppresses stale disconnects', () => {
    const link = new BrowserLink();
    const events: string[] = [];
    link.on('connect', () => events.push('connect'));
    link.on('disconnect', () => events.push('disconnect'));
    link.start();
    link.start();
    expect(wsState.servers).toHaveLength(1);

    const server = wsState.servers[0];
    const first = new wsState.Socket();
    const second = new wsState.Socket();
    first.readyState = 1;
    second.readyState = 1;
    server.emit('connection', first);
    expect(link.ready).toBe(true);
    expect(link.send({ t: 'getStatus' })).toBe(true);
    expect(first.send).toHaveBeenCalledWith(JSON.stringify({ t: 'getStatus' }));

    server.emit('connection', second);
    expect(first.close).toHaveBeenCalledWith(REPLACED_CODE, 'replaced');
    first.emit('close');
    expect(events).toEqual(['connect', 'disconnect', 'connect']);

    second.emit('close');
    expect(events).toEqual(['connect', 'disconnect', 'connect', 'disconnect']);
    expect(link.ready).toBe(false);
    expect(link.send({ t: 'getStatus' })).toBe(false);
  });
});

describe('producer signaling connection', () => {
  it('sends registration messages and dispatches protocol events', async () => {
    const connection = new ProducerConnection('ws://server/producer', 'device-1');
    const events = {
      open: vi.fn(),
      registered: vi.fn(),
      request: vi.fn(),
      error: vi.fn(),
      forcedLogout: vi.fn(),
    };
    for (const [name, handler] of Object.entries(events)) {
      connection.on(name as keyof typeof events, handler);
    }
    connection.start();
    const socket = wsState.sockets[0];
    socket.readyState = 1;
    socket.emit('open');
    expect(events.open).toHaveBeenCalledOnce();

    expect(connection.register('Bearer token', [{
      protocol: 'openai',
      models: ['gpt-test'],
    }])).toBe(true);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual(expect.objectContaining({
      type: 'register',
      apiVersion: API_VERSION,
      wireVersion: WIRE_VERSION,
      authorization: 'Bearer token',
      deviceId: 'device-1',
    }));

    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'registered',
      producerId: 'producer-1',
    })), false);
    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'request.start',
      requestId: 'request-1',
    })), false);
    socket.emit('message', encodeBinaryFrame(
      BinaryFrameType.RequestChunk,
      '12345678-1234-1234-1234-123456789012',
      Buffer.from('chunk'),
    ), true);

    expect(events.registered).toHaveBeenCalledWith('producer-1');
    expect(events.request).toHaveBeenCalledWith(expect.objectContaining({
      type: 'request.start',
      requestId: 'request-1',
    }));
    expect(events.request).toHaveBeenCalledWith(expect.objectContaining({
      type: 'request.chunk',
      chunk: Buffer.from('chunk'),
    }));

    await expect(connection.respondChunk(
      '12345678-1234-1234-1234-123456789012',
      Buffer.from('response'),
    )).resolves.toBe(true);
  });

  it('fails closed for version errors, invalid binary frames, forced logout, and backpressure', async () => {
    const connection = new ProducerConnection('ws://server/producer', 'device-1');
    const error = vi.fn();
    const forcedLogout = vi.fn();
    connection.on('error', error);
    connection.on('forcedLogout', forcedLogout);
    connection.start();
    const socket = wsState.sockets[0];
    socket.readyState = 1;

    socket.bufferedAmount = 1024 * 1024 + 1;
    expect(connection.respond({ type: 'response.end' })).toBe(false);
    await expect(connection.respondChunk(
      '12345678-1234-1234-1234-123456789012',
      Buffer.from('response'),
    )).resolves.toBe(false);
    socket.bufferedAmount = 0;

    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'hello',
      apiVersion: 'wrong',
      wireVersion: WIRE_VERSION,
    })), false);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({
      message: 'UNSUPPORTED_WIRE_VERSION',
    }));
    expect(socket.close).toHaveBeenCalledWith(4406, 'UNSUPPORTED_WIRE_VERSION');

    const secondConnection = new ProducerConnection('ws://server/producer', 'device-2');
    secondConnection.on('error', error);
    secondConnection.on('forcedLogout', forcedLogout);
    secondConnection.start();
    const second = wsState.sockets.at(-1);
    second.readyState = 1;
    second.emit('message', Buffer.from([1, 2, 3]), true);
    expect(second.close).toHaveBeenCalledWith(4400, 'invalid binary frame');

    const thirdConnection = new ProducerConnection('ws://server/producer', 'device-3');
    thirdConnection.on('forcedLogout', forcedLogout);
    thirdConnection.start();
    const third = wsState.sockets.at(-1);
    third.readyState = 1;
    third.emit('message', Buffer.from(JSON.stringify({
      type: 'device.limit.logout',
      code: 'DEVICE_LIMIT_EXCEEDED',
    })), false);
    expect(forcedLogout).toHaveBeenCalledWith('DEVICE_LIMIT_EXCEEDED');
    expect(third.close).toHaveBeenCalledWith(4410, 'DEVICE_LIMIT_EXCEEDED');
  });

  it('reconnects with backoff while started and stops retrying after stop', () => {
    vi.useFakeTimers();
    const connection = new ProducerConnection('ws://server/one', 'device-1');
    connection.start();
    const first = wsState.sockets[0];
    first.emit('close');
    expect(wsState.sockets).toHaveLength(1);

    vi.advanceTimersByTime(1_500);
    expect(wsState.sockets).toHaveLength(2);
    connection.setUrl('ws://server/two');
    expect(wsState.sockets.at(-1).url).toBe('ws://server/two');

    const last = wsState.sockets.at(-1);
    connection.stop();
    last.emit('close');
    vi.advanceTimersByTime(20_000);
    expect(wsState.sockets.at(-1)).toBe(last);
  });
});
