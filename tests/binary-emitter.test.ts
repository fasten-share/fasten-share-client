import { describe, expect, it, vi } from 'vitest';
import { BinaryFrameType, decodeBinaryFrame, encodeBinaryFrame } from '@/lib/server/binary-frame';
import { Emitter } from '@/lib/emitter';
import { sanitizeHeaders } from '@/lib/server/headers';

describe('binary frames', () => {
  const id = '00112233-4455-6677-8899-aabbccddeeff';

  it.each([BinaryFrameType.RequestChunk, BinaryFrameType.ResponseChunk])('round trips frame type %s', (type) => {
    const payload = Uint8Array.from([0, 1, 127, 128, 255]);
    const decoded = decodeBinaryFrame(encodeBinaryFrame(type, id, payload));
    expect(decoded).toEqual({ type, requestId: id, payload: Buffer.from(payload) });
  });

  it('accepts UUIDs without dashes and normalizes decoded ids', () => {
    const decoded = decodeBinaryFrame(encodeBinaryFrame(1, id.replaceAll('-', ''), Uint8Array.of(1)));
    expect(decoded?.requestId).toBe(id);
  });

  it.each(['bad', '00112233-4455-6677-8899-aabbccddeezz', ''])('rejects invalid request id %j', (requestId) => {
    expect(() => encodeBinaryFrame(1, requestId, Uint8Array.of(1))).toThrow('invalid binary frame requestId');
  });

  it('rejects empty payloads and corrupt headers', () => {
    const valid = encodeBinaryFrame(1, id, Uint8Array.of(1));
    expect(decodeBinaryFrame(valid.subarray(0, 20))).toBeUndefined();
    for (const [index, value] of [[0, 0], [1, 0], [2, 255], [3, 255]] as const) {
      const corrupted = Buffer.from(valid);
      corrupted[index] = value;
      expect(decodeBinaryFrame(corrupted)).toBeUndefined();
    }
  });

  it('respects a Uint8Array view offset', () => {
    const source = Uint8Array.from([9, 8, 1, 2, 3, 7]);
    expect(decodeBinaryFrame(encodeBinaryFrame(1, id, source.subarray(2, 5)))?.payload)
      .toEqual(Buffer.from([1, 2, 3]));
  });
});

describe('Emitter', () => {
  type Events = { value: (value: number) => void; empty: () => void };

  it('subscribes, emits arguments, and unsubscribes', () => {
    const emitter = new Emitter<Events>();
    const listener = vi.fn();
    expect(emitter.on('value', listener)).toBe(emitter);
    emitter.emit('value', 42);
    emitter.off('value', listener);
    emitter.emit('value', 7);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(42);
  });

  it('deduplicates listeners and permits removal during emit', () => {
    const emitter = new Emitter<Events>();
    const second = vi.fn();
    const first = vi.fn(() => emitter.off('value', second));
    emitter.on('value', first).on('value', first).on('value', second);
    emitter.emit('value', 1);
    emitter.emit('value', 2);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('sanitizeHeaders', () => {
  it('removes hop-by-hop and transport-owned headers case-insensitively', () => {
    expect(sanitizeHeaders({
      Connection: 'keep-alive', HOST: 'example', 'Content-Length': '5',
      'content-encoding': 'gzip', Authorization: 'Bearer x', 'x-custom': 'ok',
    })).toEqual({ Authorization: 'Bearer x', 'x-custom': 'ok' });
  });
});
