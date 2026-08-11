import { describe, expect, it } from 'vitest';
import {
  describeResult,
  formatBytes,
  formatDuration,
  formatRelativeTime,
  successRate,
} from '@/app/components/traffic-format';
import type { MessageKey } from '@/lib/i18n/dictionary';
import type { RequestSample } from '@/lib/server/types';

/** Echoes the key so assertions stay independent of dictionary wording. */
const t = (key: MessageKey, vars?: Record<string, string | number>): string =>
  vars ? `${key}:${Object.values(vars).join(',')}` : key;

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

describe('formatBytes', () => {
  it('keeps raw bytes whole', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('steps up through base-10 units with one decimal', () => {
    expect(formatBytes(1000)).toBe('1.0 KB');
    expect(formatBytes(1_234_000)).toBe('1.2 MB');
    expect(formatBytes(5_000_000_000)).toBe('5.0 GB');
  });

  it('drops the decimal once the value is large within its unit', () => {
    expect(formatBytes(150_000)).toBe('150 KB');
  });

  it('treats junk input as zero', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('keeps sub-second responses in milliseconds', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(999)).toBe('999 ms');
  });

  it('switches to seconds, then minutes', () => {
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(65_000)).toBe('1m 5s');
  });

  it('renders an em dash for invalid input', () => {
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000;

  it('collapses the last few seconds into "just now"', () => {
    expect(formatRelativeTime(now - 2_000, now, t)).toBe('traffic.justNow');
  });

  it('counts seconds, minutes and hours', () => {
    expect(formatRelativeTime(now - 30_000, now, t)).toBe('traffic.secondsAgo:30');
    expect(formatRelativeTime(now - 5 * 60_000, now, t)).toBe('traffic.minutesAgo:5');
    expect(formatRelativeTime(now - 3 * 3_600_000, now, t)).toBe('traffic.hoursAgo:3');
  });

  it('never reports a negative age when clocks drift forward', () => {
    expect(formatRelativeTime(now + 5_000, now, t)).toBe('traffic.justNow');
  });
});

describe('describeResult', () => {
  it('reports success plainly', () => {
    expect(describeResult(sample(), t)).toBe('traffic.ok');
  });

  it('maps a failure reason to its own message', () => {
    expect(describeResult(sample({ ok: false, reason: 'QUOTA' }), t)).toBe('traffic.reasonQUOTA');
  });

  it('appends the upstream status when there is one', () => {
    expect(describeResult(sample({ ok: false, reason: 'HTTP', status: 502 }), t))
      .toBe('traffic.reasonHTTP (502)');
  });

  it('falls back to a generic failure without a reason', () => {
    expect(describeResult(sample({ ok: false }), t)).toBe('traffic.failed');
  });
});

describe('successRate', () => {
  it('reads as 100% while idle instead of NaN', () => {
    expect(successRate(0, 0)).toBe(100);
  });

  it('rounds to whole percent', () => {
    expect(successRate(1, 2)).toBe(33);
    expect(successRate(9, 1)).toBe(90);
    expect(successRate(0, 4)).toBe(0);
  });
});
