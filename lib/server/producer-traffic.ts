/**
 * Rolling traffic log for the producer daemon.
 *
 * The daemon already counts successes and failures per backend, but the adaptive
 * health gate *consumes* those counters (`takeRequestCounts`) on every probe
 * cycle, so they can never be shown to the user. This keeps an independent,
 * bounded view that is safe to push to the control page on a short interval:
 * the newest N request samples plus per-minute aggregates for a short window.
 *
 * Everything here is capped by construction — a busy producer must not be able
 * to grow this structure without bound, and the whole snapshot is serialized
 * into every status push.
 */
import type { ProducerTraffic, RequestSample, TrafficBucket } from './types';

/** Newest samples kept for the live request feed. */
export const MAX_SAMPLES = 50;
/** How many minute buckets the sparkline keeps. */
export const BUCKET_WINDOW_MINUTES = 60;

const MINUTE_MS = 60_000;

/** Placeholder used before a daemon exists (offline / stopped producer). */
export function emptyTraffic(): ProducerTraffic {
  return { recent: [], buckets: [], totals: { success: 0, failure: 0, bytes: 0, since: Date.now() } };
}

export class TrafficLog {
  /** Newest first, so the UI can render without re-sorting. */
  private samples: RequestSample[] = [];
  private buckets = new Map<number, TrafficBucket>();
  private success = 0;
  private failure = 0;
  private bytes = 0;
  private since = Date.now();

  record(sample: RequestSample): void {
    this.samples.unshift(sample);
    if (this.samples.length > MAX_SAMPLES) this.samples.length = MAX_SAMPLES;

    if (sample.ok) this.success += 1;
    else this.failure += 1;
    this.bytes += sample.bytes;

    const minute = Math.floor(sample.at / MINUTE_MS);
    const bucket = this.buckets.get(minute) ?? { minute, success: 0, failure: 0, bytes: 0 };
    if (sample.ok) bucket.success += 1;
    else bucket.failure += 1;
    bucket.bytes += sample.bytes;
    this.buckets.set(minute, bucket);
    this.prune(minute);
  }

  /** Drop everything belonging to a backend that no longer exists. */
  forget(backendId: string): void {
    this.samples = this.samples.filter((sample) => sample.backendId !== backendId);
  }

  snapshot(): ProducerTraffic {
    // Only non-empty buckets travel over the wire; the panel fills the gaps.
    const buckets = [...this.buckets.values()].sort((a, b) => a.minute - b.minute);
    return {
      recent: [...this.samples],
      buckets,
      totals: { success: this.success, failure: this.failure, bytes: this.bytes, since: this.since },
    };
  }

  reset(): void {
    this.samples = [];
    this.buckets.clear();
    this.success = 0;
    this.failure = 0;
    this.bytes = 0;
    this.since = Date.now();
  }

  private prune(currentMinute: number): void {
    const oldest = currentMinute - BUCKET_WINDOW_MINUTES + 1;
    for (const minute of this.buckets.keys()) {
      if (minute < oldest) this.buckets.delete(minute);
    }
  }
}
