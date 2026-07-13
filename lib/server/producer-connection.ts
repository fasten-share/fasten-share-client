import { WebSocket, type RawData } from 'ws';
import { Emitter } from '../emitter';
import type { Offering } from './types';
import {
  BinaryFrameType,
  decodeBinaryFrame,
  encodeBinaryFrame,
} from './binary-frame';
import { API_VERSION, PRODUCER_CAPABILITIES, WIRE_VERSION } from './protocol-version';

export interface ProducerEvent {
  type: 'request.start' | 'request.chunk' | 'request.end' | 'request.cancel';
  requestId: string;
  data?: Record<string, unknown>;
  chunk?: Uint8Array;
}

type Events = {
  open: () => void;
  close: () => void;
  registered: (producerId: string) => void;
  request: (event: ProducerEvent) => void;
  error: (error: Error) => void;
  forcedLogout: (code: string) => void;
};

export class ProducerConnection extends Emitter<Events> {
  private ws?: WebSocket;
  private started = false;
  private retry?: ReturnType<typeof setTimeout>;
  private backoff = 1500;

  constructor(private url: string, private readonly deviceId: string) {
    super();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  start(): void {
    this.started = true;
    this.connect();
  }

  stop(): void {
    this.started = false;
    clearTimeout(this.retry);
    this.ws?.close();
  }

  setUrl(url: string): void {
    this.url = url;
    if (this.started) this.connect();
  }

  register(authorization: string, offerings: Offering[]): boolean {
    return this.send({
      type: 'register', apiVersion: API_VERSION, wireVersion: WIRE_VERSION,
      capabilities: PRODUCER_CAPABILITIES, authorization, offerings, deviceId: this.deviceId,
    });
  }

  heartbeat(): void {
    this.send({ type: 'heartbeat', at: Date.now() });
  }

  deregister(reason: string): void {
    this.send({ type: 'deregister', reason });
  }

  respond(value: Record<string, unknown>): boolean {
    return this.send(value);
  }

  respondChunk(requestId: string, chunk: Uint8Array): Promise<boolean> {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1024 * 1024) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      ws.send(encodeBinaryFrame(BinaryFrameType.ResponseChunk, requestId, chunk), {
        binary: true,
      }, (error) => {
        resolve(!error && this.ws === ws && ws.readyState === WebSocket.OPEN);
      });
    });
  }

  private send(value: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    if (this.ws.bufferedAmount > 1024 * 1024) return false;
    this.ws.send(JSON.stringify(value));
    return true;
  }

  private connect(): void {
    clearTimeout(this.retry);
    this.ws?.close();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (error) {
      this.emit('error', error as Error);
      return this.schedule();
    }
    this.ws = ws;
    ws.on('open', () => {
      this.backoff = 1500;
      this.emit('open');
    });
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        const frame = decodeBinaryFrame(this.toBuffer(raw));
        if (!frame || frame.type !== BinaryFrameType.RequestChunk) {
          this.emit('error', new Error('invalid binary producer frame'));
          ws.close(4400, 'invalid binary frame');
          return;
        }
        this.emit('request', {
          type: 'request.chunk',
          requestId: frame.requestId,
          chunk: frame.payload,
        });
        return;
      }
      let message: Record<string, unknown>;
      try { message = JSON.parse(String(raw)) as Record<string, unknown>; } catch { return; }
      if (message.type === 'hello') {
        if (message.apiVersion !== API_VERSION || message.wireVersion !== WIRE_VERSION) {
          this.emit('error', new Error('UNSUPPORTED_WIRE_VERSION'));
          ws.close(4406, 'UNSUPPORTED_WIRE_VERSION');
        }
      } else if (message.type === 'registered') {
        this.emit('registered', String(message.producerId));
      } else if (message.type === 'device.limit.logout') {
        this.started = false;
        this.emit('forcedLogout', String(message.code || 'DEVICE_LIMIT_EXCEEDED'));
        ws.close(4410, 'DEVICE_LIMIT_EXCEEDED');
      } else if (typeof message.type === 'string' && message.type.startsWith('request.')) {
        this.emit('request', message as unknown as ProducerEvent);
      }
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.emit('close');
      this.schedule();
    });
    ws.on('error', (error) => this.emit('error', error));
  }

  private schedule(): void {
    if (!this.started) return;
    this.retry = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 15_000);
  }

  private toBuffer(raw: RawData): Buffer {
    if (Buffer.isBuffer(raw)) return raw;
    if (Array.isArray(raw)) return Buffer.concat(raw);
    return Buffer.from(raw);
  }
}
