/** Formatting helpers for the live producer traffic panel. */
import type { MessageKey } from '@/lib/i18n/dictionary';
import type { RequestSample } from '@/lib/server/types';

/** Compact byte size, e.g. 1.2 MB. Base-10 units keep it readable. */
export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  // Whole bytes never need a decimal; larger units get one significant digit.
  const rendered = unit === 0 ? String(Math.round(size)) : size.toFixed(size >= 100 ? 0 : 1);
  return `${rendered} ${units[unit]}`;
}

/** Sub-second durations stay in ms so fast responses do not all read "0.1s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Relative time, coarse enough that it does not need a per-second re-render. */
export function formatRelativeTime(at: number, now: number, t: Translate): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return t('traffic.justNow');
  if (seconds < 60) return t('traffic.secondsAgo', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('traffic.minutesAgo', { count: minutes });
  return t('traffic.hoursAgo', { count: Math.floor(minutes / 60) });
}

/** Human-readable outcome for one sample. */
export function describeResult(sample: RequestSample, t: Translate): string {
  if (sample.ok) return t('traffic.ok');
  const reason = sample.reason
    ? t(`traffic.reason${sample.reason}` as MessageKey)
    : t('traffic.failed');
  return sample.status ? `${reason} (${sample.status})` : reason;
}

/** Whole-percent success rate; an idle producer reads as 100% rather than NaN. */
export function successRate(success: number, failure: number): number {
  const total = success + failure;
  return total === 0 ? 100 : Math.round((success / total) * 100);
}
