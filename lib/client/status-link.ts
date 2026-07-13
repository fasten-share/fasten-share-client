/**
 * Passive control-page client. Node owns the producer connection and forwarding.
 *
 *   - connects to the local Node status channel (localhost WebSocket) to receive
 *     pushed `status` updates, and
 *   - runs model discovery through the control API.
 */
import { REPLACED_CODE, WS_PATH, type BridgeCommand } from '@/lib/bridge-protocol';
import { discoverModels, type Status } from '@/lib/control-client';
import type { Candidate } from '@/lib/server/types';

/** Discover producers via Node (empty filters = all). */
export type DiscoverFn = (
  keyword: string,
  protocol: string,
  publisherUserIds?: string[],
  page?: number,
  pageSize?: number,
) => Promise<{ candidates: Candidate[]; page: number; pageSize: number; total: number }>;

/** Handle returned by the status link; `stop()` tears the channel down. */
export interface ProducerBridgeHandle {
  stop(): void;
  discover: DiscoverFn;
}

/**
 * Start the passive status link. `seed` is the full status from the initial
 * getStatus() so the UI renders immediately; pushes from Node then update it.
 */
export function startStatusLink(
  wsPort: number,
  onStatus: (s: Status) => void,
  seed: Status,
): ProducerBridgeHandle {
  const host = window.location.hostname || '127.0.0.1';
  const linkUrl = `ws://${host}:${wsPort}${WS_PATH}`;

  let stopped = false;
  let link: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let backoff = 1000;
  let status: Status = seed;

  function emit(): void {
    onStatus(status);
  }

  function connect(): void {
    if (stopped) return;
    if (link && (link.readyState === WebSocket.CONNECTING || link.readyState === WebSocket.OPEN)) return;
    clearTimeout(retry);
    const ws = new WebSocket(linkUrl);
    link = ws;
    ws.onopen = () => {
      backoff = 1000;
      status = { ...status, transport: { ...status.transport, ready: true } };
      emit();
    };
    ws.onmessage = (e) => {
      let cmd: BridgeCommand;
      try {
        cmd = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data));
      } catch {
        return;
      }
      onCommand(cmd);
    };
    ws.onclose = (event) => {
      if (link === ws) link = undefined;
      if (event.code === REPLACED_CODE) {
        // A newer page/link became active. Yield instead of reconnect-fighting.
        stopped = true;
        clearTimeout(retry);
        return;
      }
      // The control link dropped, but the Node-owned producer keeps running; just
      // reconnect to resume receiving pushes.
      if (!stopped) {
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15_000);
      }
    };
    ws.onerror = () => ws.close();
  }

  function onCommand(cmd: BridgeCommand): void {
    if (cmd.t === 'forcedLogout') {
      window.dispatchEvent(new CustomEvent('fs:forced-logout', { detail: cmd.code }));
      return;
    }
    if (cmd.t !== 'status') return; // config/register/etc. don't apply to a passive page
    const node = cmd.node;
    status = {
      ...status,
      producer: cmd.producer,
      connectedProducers: cmd.connectedProducers,
      signaling: node ? { connected: node.signaling.connected, peerId: node.signaling.peerId } : status.signaling,
    };
    emit();
  }

  const discover = (
    keyword: string,
    protocol: string,
    publisherUserIds?: string[],
    page?: number,
    pageSize?: number,
  ): ReturnType<DiscoverFn> =>
    discoverModels(keyword, protocol, publisherUserIds, page, pageSize) as ReturnType<DiscoverFn>;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(retry);
    try {
      if (link) {
        link.onclose = null;
        link.close();
      }
    } catch {
      /* noop */
    }
  }

  emit(); // render the seed immediately
  connect();
  return { stop, discover };
}
