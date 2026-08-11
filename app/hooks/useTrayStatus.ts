'use client';

import { useEffect, useRef } from 'react';
import { control, type Status } from '@/lib/control-client';
import {
  isDesktopShell, sameSummary, sendTrayStatus, subscribeToTrayCommands,
  type TraySummary,
} from '@/lib/client/tray-bridge';

/** Reduces a full status snapshot to the few facts the tray can display. */
export function toTraySummary(status: Status | null): TraySummary {
  if (!status) return { connected: false, sharing: 0, configured: 0, served: 0 };
  const failed = status.producer.backends.find(
    (backend) => backend.lastHealth && !backend.lastHealth.ok,
  );
  return {
    connected: status.signaling.connected,
    sharing: status.producer.backends.filter((backend) => backend.advertised).length,
    configured: status.config.backends.length,
    served: status.producer.traffic.totals.success,
    failing: failed?.lastHealth?.reason ?? undefined,
  };
}

/**
 * Keeps the desktop tray in step with the node, and applies the commands it
 * sends back. In a browser this hook does nothing at all.
 */
export function useTrayStatus(status: Status | null, onChanged: (next: Status) => void): void {
  const lastSent = useRef<TraySummary | null>(null);

  useEffect(() => {
    if (!isDesktopShell()) return;
    const summary = toTraySummary(status);
    // Status is pushed continuously; only real changes are worth an IPC hop,
    // and a repeat would re-fire the tray's notifications.
    if (lastSent.current && sameSummary(lastSent.current, summary)) return;
    lastSent.current = summary;
    sendTrayStatus(summary);
  }, [status]);

  // The handler is re-created as state changes; a ref keeps the subscription
  // itself stable so tray clicks are never dropped between renders.
  const latest = useRef({ status, onChanged });
  useEffect(() => {
    latest.current = { status, onChanged };
  });

  useEffect(() => subscribeToTrayCommands((command) => {
    void (async () => {
      const { status: current, onChanged: apply } = latest.current;
      try {
        if (command === 'stopSharing') {
          apply(await control({ action: 'stopProducer' }));
          return;
        }
        // Starting from the tray means every configured backend goes on the
        // air; a per-backend choice belongs in the window.
        const backends = current?.config.backends ?? [];
        if (backends.length === 0) return;
        for (const backend of backends) {
          if (backend.enabled === false) {
            await control({ action: 'setBackendEnabled', id: backend.id, enabled: true });
          }
        }
        apply(await control({ action: 'startProducer' }));
      } catch {
        // The tray has no place to show an error; the window reflects the
        // unchanged state, which is the honest outcome.
      }
    })();
  }), []);
}
