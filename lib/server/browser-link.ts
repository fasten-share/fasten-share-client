/**
 * Local Node -> page status channel (a localhost-only WebSocket server). The page
 * that has the app open connects here to receive pushed `status` snapshots; it is
 * a one-way channel (the page sends nothing back). Node runs everything itself
 * (producer connection and backend forwarding), so the page is just a control UI.
 *
 * Only ONE page is active at a time (newest connection wins). A disconnect does
 * NOT affect the producer — it keeps serving headlessly. Singleton on globalThis
 * so the WebSocketServer is created once even across `next dev` HMR reloads.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { Emitter } from '../emitter';
import { DEFAULT_WS_PORT, WS_PATH, REPLACED_CODE, type BridgeCommand } from '../bridge-protocol';

const WS_PORT = Number(process.env.FS_WS_PORT ?? DEFAULT_WS_PORT);
// Localhost-only by default (the browser is on the same machine for Electron /
// local dev). Set FS_WS_HOST=0.0.0.0 to reach it from a browser on another host
// (e.g. Docker) — only do that on a trusted network.
const WS_HOST = process.env.FS_WS_HOST ?? '127.0.0.1';

type Events = {
  connect: () => void;
  disconnect: () => void;
};

export class BrowserLink extends Emitter<Events> {
  private wss?: WebSocketServer;
  private active?: WebSocket;
  readonly port = WS_PORT;

  start(): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({ host: WS_HOST, port: WS_PORT, path: WS_PATH });
    this.wss.on('connection', (ws) => this.attach(ws));
    this.wss.on('error', (e) => console.error('[browser-link]', (e as Error).message));
    this.wss.on('listening', () => console.log(`[browser-link] listening on ${WS_HOST}:${WS_PORT}${WS_PATH}`));
  }

  /** Whether a browser transport is currently connected. */
  get ready(): boolean {
    return this.active?.readyState === WebSocket.OPEN;
  }

  send(cmd: BridgeCommand): boolean {
    if (this.active?.readyState === WebSocket.OPEN) {
      this.active.send(JSON.stringify(cmd));
      return true;
    }
    return false;
  }

  private attach(ws: WebSocket): void {
    // Newest browser wins: drop the previous transport if any. Close it with a
    // deliberate code so the kicked client yields instead of reconnect-fighting.
    const replacing = !!this.active && this.active !== ws;
    if (replacing) {
      try {
        this.active!.close(REPLACED_CODE, 'replaced');
      } catch {
        /* noop */
      }
    }
    this.active = ws;

    ws.on('close', () => {
      // Only fire disconnect if this socket is still the active one (a newer
      // browser replacing it already moved `active` forward).
      if (this.active === ws) {
        this.active = undefined;
        this.emit('disconnect');
      }
    });
    ws.on('error', () => {
      /* a 'close' event follows */
    });

    // Reset listeners tied to the replaced transport (its 'close' is suppressed
    // because `active` already moved on), then announce the fresh one.
    if (replacing) this.emit('disconnect');
    this.emit('connect');
  }
}

declare global {
  var __mcBrowserLink: BrowserLink | undefined;
}

export function getBrowserLink(): BrowserLink {
  if (!globalThis.__mcBrowserLink) {
    const link = new BrowserLink();
    link.start();
    globalThis.__mcBrowserLink = link;
  }
  return globalThis.__mcBrowserLink;
}
