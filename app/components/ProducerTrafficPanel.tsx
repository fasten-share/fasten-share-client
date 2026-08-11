'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Status } from '@/lib/control-client';
import { useI18n } from '@/lib/i18n/context';
import {
  describeResult,
  formatBytes,
  formatDuration,
  formatRelativeTime,
  successRate,
} from './traffic-format';
import { TrafficSparkline } from './TrafficSparkline';
import styles from './ProducerTrafficPanel.module.css';

/** Relative timestamps only need coarse refreshes; the feed itself is pushed. */
const CLOCK_INTERVAL_MS = 15_000;

export function ProducerTrafficPanel({ status }: { status: Status }) {
  const { t } = useI18n();
  const traffic = status.producer.traffic;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Samples carry a backend id; show the model/protocol the consumer asked for
  // and fall back gracefully when the backend has since been removed.
  const modelById = useMemo(
    () => new Map(status.producer.backends.map((backend) => [backend.id, backend])),
    [status.producer.backends],
  );

  const { success, failure, bytes } = traffic.totals;
  const total = success + failure;
  const sharing = status.producer.backends.some((backend) => backend.enabled);

  return (
    <div className="card">
      <h2>{t('traffic.title')}</h2>
      <p className="muted">{t('traffic.subtitle')}</p>

      <div className={styles.metrics}>
        <Metric label={t('traffic.requests')} value={total.toLocaleString()} />
        <Metric label={t('traffic.succeeded')} value={success.toLocaleString()} tone="ok" />
        <Metric
          label={t('traffic.failed')}
          value={failure.toLocaleString()}
          tone={failure > 0 ? 'error' : undefined}
        />
        <Metric label={t('traffic.successRate')} value={`${successRate(success, failure)}%`} />
        <Metric label={t('traffic.bytesServed')} value={formatBytes(bytes)} />
      </div>

      <TrafficSparkline buckets={traffic.buckets} now={now} label={t('traffic.perMinute')} />
      <div className={styles.sparklineLabel}>{t('traffic.perMinute')}</div>

      {traffic.recent.length === 0 ? (
        <p className="muted">{sharing ? t('traffic.empty') : t('traffic.emptyOffline')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('traffic.colModel')}</th>
                <th>{t('traffic.colWhen')}</th>
                <th>{t('traffic.colDuration')}</th>
                <th>{t('traffic.colBytes')}</th>
                <th>{t('traffic.colResult')}</th>
              </tr>
            </thead>
            <tbody>
              {traffic.recent.map((sample) => (
                <tr key={sample.requestId}>
                  <td>
                    <span className="badge">{sample.protocol}</span>
                    <span className={styles.model} title={sample.model}>
                      {sample.model || modelById.get(sample.backendId)?.models[0] || '—'}
                    </span>
                  </td>
                  <td className={styles.muted}>
                    <time dateTime={new Date(sample.at).toISOString()}>
                      {formatRelativeTime(sample.at, now, t)}
                    </time>
                  </td>
                  <td className={styles.numeric}>{formatDuration(sample.durationMs)}</td>
                  <td className={styles.numeric}>{formatBytes(sample.bytes)}</td>
                  <td>
                    <span className={sample.ok ? styles.resultOk : styles.resultFailed}>
                      {describeResult(sample, t)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'error' }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <strong className={`${styles.metricValue} ${tone ? styles[tone] : ''}`}>{value}</strong>
    </div>
  );
}
