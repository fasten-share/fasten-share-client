'use client';

import { useEffect, useRef } from 'react';
import { startStatusLink, type ProducerBridgeHandle } from '@/lib/client/status-link';
import { clearAccessToken } from '@/lib/client/auth';
import { DEFAULT_WS_PORT } from '@/lib/bridge-protocol';
import { getStatus, type Status } from '@/lib/control-client';

/** Minimal status used until the first getStatus()/push arrives. */
function emptyStatus(): Status {
  return {
    transport: { ready: false, wsPort: DEFAULT_WS_PORT },
    signaling: { connected: false },
    producer: { running: false, registered: false, backends: [] },
    config: { signalUrl: '', backends: [] },
    connectedProducers: [],
  };
}

/**
 * Mounts the passive control-page status link while the app page is open. Node
 * owns the producer connection and shares headlessly, so this
 * only receives pushed status (via the local ws) and drives discovery through the
 * control API — closing the page does NOT take the producer offline. It pushes
 * live status up via `onStatus`. Renders nothing.
 */
export function ProducerBridge({
  onStatus,
  onHandle,
}: {
  onStatus: (s: Status) => void;
  onHandle?: (h: ProducerBridgeHandle | null) => void;
}) {
  // Keep the latest callbacks in refs so the link starts exactly once.
  const onStatusRef = useRef(onStatus);
  const onHandleRef = useRef(onHandle);
  useEffect(() => {
    onStatusRef.current = onStatus;
    onHandleRef.current = onHandle;
  });

  useEffect(() => {
    let handle: ProducerBridgeHandle | undefined;
    let cancelled = false;

    void (async () => {
      // One-time seed from the control API (full status); pushes update it after.
      let seed: Status;
      try {
        seed = await getStatus();
      } catch (err) {
        if ((err as { status?: number }).status === 401) clearAccessToken();
        seed = emptyStatus(); // server not ready yet — the ws push will fill it in
      }
      if (cancelled) return;
      handle = startStatusLink(seed.transport.wsPort, (s) => onStatusRef.current(s), seed);
      onHandleRef.current?.(handle);
    })();

    const onUnload = () => handle?.stop();
    window.addEventListener('beforeunload', onUnload);

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', onUnload);
      onHandleRef.current?.(null);
      handle?.stop();
    };
  }, []);

  return null;
}
