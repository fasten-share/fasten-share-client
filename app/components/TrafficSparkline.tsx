'use client';

import { useMemo } from 'react';
import type { TrafficBucket } from '@/lib/server/types';
import styles from './ProducerTrafficPanel.module.css';

const MINUTE_MS = 60_000;

/**
 * Per-minute request bars for the last hour. The daemon only sends non-empty
 * buckets, so the gaps are filled here to keep the time axis honest — a quiet
 * minute must read as zero, not be collapsed away.
 *
 * `now` is passed in rather than read here: rendering must stay pure, and the
 * panel already owns a coarse clock for its relative timestamps.
 */
export function TrafficSparkline({ buckets, now, minutes = 60, label }: {
  buckets: TrafficBucket[];
  now: number;
  minutes?: number;
  label: string;
}) {
  const bars = useMemo(() => {
    const currentMinute = Math.floor(now / MINUTE_MS);
    const byMinute = new Map(buckets.map((bucket) => [bucket.minute, bucket]));
    const filled: TrafficBucket[] = [];
    for (let offset = minutes - 1; offset >= 0; offset -= 1) {
      const minute = currentMinute - offset;
      filled.push(byMinute.get(minute) ?? { minute, success: 0, failure: 0, bytes: 0 });
    }
    return filled;
  }, [buckets, minutes, now]);

  const peak = Math.max(1, ...bars.map((bucket) => bucket.success + bucket.failure));

  return (
    <div className={styles.sparkline} role="img" aria-label={label}>
      {bars.map((bucket) => {
        const total = bucket.success + bucket.failure;
        // Any traffic keeps a visible floor so single requests do not vanish.
        const height = total === 0 ? 0 : Math.max(8, (total / peak) * 100);
        return (
          <span
            key={bucket.minute}
            className={`${styles.bar} ${bucket.failure > 0 ? styles.barFailure : ''}`}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}
