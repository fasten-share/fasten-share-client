import { describe, expect, it, vi } from 'vitest';
import {
  BUCKET_WINDOW_MINUTES,
  MAX_SAMPLES,
  TrafficLog,
  emptyTraffic,
} from '@/lib/server/producer-traffic';
import type { RequestSample } from '@/lib/server/types';

const MINUTE_MS = 60_000;

function sample(overrides: Partial<RequestSample> = {}): RequestSample {
  return {
    requestId: 'r1',
    backendId: 'backend-a',
    protocol: 'openai',
    model: 'model-a',
    at: 1_700_000_000_000,
    durationMs: 120,
    bytes: 512,
    ok: true,
    ...overrides,
  };
}

describe('producer traffic log', () => {
  it('keeps newest samples first and caps the feed', () => {
    const log = new TrafficLog();
    for (let index = 0; index < MAX_SAMPLES + 20; index += 1) {
      log.record(sample({ requestId: `r${index}` }));
    }
    const { recent } = log.snapshot();
    expect(recent).toHaveLength(MAX_SAMPLES);
    expect(recent[0].requestId).toBe(`r${MAX_SAMPLES + 19}`);
  });

  it('aggregates totals and per-minute buckets', () => {
    const log = new TrafficLog();
    const base = 1_700_000_000_000;
    log.record(sample({ at: base, bytes: 100, ok: true }));
    log.record(sample({ at: base + 1_000, bytes: 50, ok: false, reason: 'HTTP', status: 500 }));
    log.record(sample({ at: base + MINUTE_MS, bytes: 25, ok: true }));

    const { totals, buckets } = log.snapshot();
    expect(totals).toMatchObject({ success: 2, failure: 1, bytes: 175 });
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ success: 1, failure: 1, bytes: 150 });
    expect(buckets[1]).toMatchObject({ success: 1, failure: 0, bytes: 25 });
    // Buckets must be chronological so the sparkline needs no re-sorting.
    expect(buckets[0].minute).toBeLessThan(buckets[1].minute);
  });

  it('prunes buckets outside the retention window', () => {
    const log = new TrafficLog();
    const base = 1_700_000_000_000;
    log.record(sample({ at: base }));
    log.record(sample({ at: base + BUCKET_WINDOW_MINUTES * MINUTE_MS }));
    const { buckets } = log.snapshot();
    // The first bucket has aged out of the window entirely.
    expect(buckets).toHaveLength(1);
    expect(buckets[0].minute).toBe(Math.floor((base + BUCKET_WINDOW_MINUTES * MINUTE_MS) / MINUTE_MS));
  });

  it('drops samples belonging to a removed backend but keeps others', () => {
    const log = new TrafficLog();
    log.record(sample({ requestId: 'a', backendId: 'backend-a' }));
    log.record(sample({ requestId: 'b', backendId: 'backend-b' }));
    log.forget('backend-a');
    const { recent } = log.snapshot();
    expect(recent.map((item) => item.requestId)).toEqual(['b']);
  });

  it('returns an isolated snapshot that later writes cannot mutate', () => {
    const log = new TrafficLog();
    log.record(sample());
    const first = log.snapshot();
    log.record(sample({ requestId: 'r2' }));
    expect(first.recent).toHaveLength(1);
  });

  it('resets every accumulator', () => {
    const log = new TrafficLog();
    log.record(sample({ ok: false, reason: 'AUTH' }));
    log.reset();
    const { recent, buckets, totals } = log.snapshot();
    expect(recent).toEqual([]);
    expect(buckets).toEqual([]);
    expect(totals).toMatchObject({ success: 0, failure: 0, bytes: 0 });
  });

  it('exposes a neutral empty snapshot', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const empty = emptyTraffic();
    expect(empty.recent).toEqual([]);
    expect(empty.totals.success).toBe(0);
    vi.useRealTimers();
  });
});
