'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { control, type Status } from '@/lib/control-client';
import type { DiscoverFn, ProducerBridgeHandle } from '@/lib/client/status-link';
import { useI18n } from '@/lib/i18n/context';
import { prepareAutoShare } from '../home-utils';

export function useHomeProducer() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [signalUrl, setSignalUrl] = useState('');
  const [bridgeHandle, setBridgeHandle] = useState<ProducerBridgeHandle | null>(null);
  const [autoShareNotice, setAutoShareNotice] = useState('');
  const autoShareDone = useRef(false);

  const onStatus = useCallback((next: Status) => {
    setStatus(next);
    setSignalUrl((current) => current === '' ? next.config.signalUrl : current);
  }, []);

  const setAutoShare = useCallback(async (next: boolean) => {
    onStatus(await control({ action: 'setAutoShare', autoShare: next }));
  }, [onStatus]);

  useEffect(() => {
    if (!status?.config.autoShare || autoShareDone.current) return;
    if (!status.signaling.connected || status.producer.running) return;
    const stored = status.config.backends;
    if (!stored.some((backend) => backend.models.length > 0)) return;
    autoShareDone.current = true;
    const prepared = prepareAutoShare(stored);
    void (async () => {
      if (prepared.duplicate) {
        setAutoShareNotice(t('producer.autoShareDuplicateSkipped', { offering: prepared.duplicate }));
      }
      try {
        const next = await control({ action: 'setBackends', backends: prepared.backends });
        onStatus(next);
        const failed = next.producer.backends.find((backend) => backend.lastHealth && !backend.lastHealth.ok);
        if (failed) {
          setAutoShareNotice(t('producer.autoShareFailed', {
            reason: failed.lastHealth?.reason ?? t('producer.healthReasonUnknown'),
          }));
        }
      } catch {
        setAutoShareNotice(t('producer.autoShareFailed', { reason: t('producer.healthReasonUnknown') }));
      }
    })();
  }, [status, onStatus, t]);

  useEffect(() => {
    if (status && !status.transport.ready) autoShareDone.current = false;
  }, [status]);

  const discover = useCallback<DiscoverFn>(
    (keyword, protocol, publisherUserIds, page, pageSize) => bridgeHandle
      ? bridgeHandle.discover(keyword, protocol, publisherUserIds, page, pageSize)
      : Promise.resolve({ candidates: [], page: page ?? 1, pageSize: pageSize ?? 20, total: 0 }),
    [bridgeHandle],
  );

  return {
    status, setStatus, signalUrl, setBridgeHandle, autoShareNotice,
    onStatus, setAutoShare, discover,
  };
}
