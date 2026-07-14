/**
 * Wire protocol for the local Node -> page status channel (a localhost WebSocket).
 *
 * Node owns the producer connection and backend forwarding; the page is a
 * passive control UI. This channel is one-way: Node pushes
 * a `status` snapshot on change so the UI never has to poll. The page sends
 * nothing back over it (operations go through /api/control).
 *
 * Shared by lib/server/* (Node) and lib/client/status-link.ts (browser); types
 * only, so importing it from either side is erased at build time.
 */
import type { ProducerStatus } from './server/types';

/** Node -> page commands. */
export type BridgeCommand = {
  t: 'status';
  producer: ProducerStatus;
  connectedProducers: { protocol: string; peerId: string }[];
  configRevision: number;
  // Node owns signaling, so it includes its state for the passive page to render.
  node: { signaling: { connected: boolean; peerId?: string } };
} | { t: 'forcedLogout'; code: 'DEVICE_LIMIT_EXCEEDED' };

/** Default port for the local status channel; overridable via FS_WS_PORT. */
export const DEFAULT_WS_PORT = 8087;

/** Path the local status WebSocket listens on (keeps the root free for other ws). */
export const WS_PATH = '/bridge';

/**
 * Close code used when a newer page takes over the status channel. The kicked
 * client treats it as "you lost the election" and yields (does not reconnect-fight).
 */
export const REPLACED_CODE = 4000;
