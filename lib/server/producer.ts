/**
 * Producer daemon (Node) — multi-backend orchestrator (§20). Holds N backends,
 * each with its own protocol / baseUrl / apiKey / models, registers their union
 * as `offerings[]`, health-checks each backend independently, and serves inbound
 * tunnel requests: picks the backend by (protocol, model), rewrites the auth
 * header with that backend's key (per-protocol scheme; see protocols.ts), fetches
 * the real backend, and streams the response back over the producer WebSocket.
 * DESIGN §7.4/§7.5 + §20.6.
 *
 * Each backend has an independent health gate: an unhealthy one is dropped from
 * the advertised offerings on its own (its models stop being advertised) while
 * the others keep serving; only when every backend is unhealthy do we
 * deregister entirely.
 */
import { Emitter } from '../emitter';
import type { BackendConfig, BackendStatus, Offering, ProducerStatus } from './types';
import { sanitizeHeaders } from './headers';
import { adapterFor } from './protocols';
import { normalizeSupportedTools } from '../tool-support';
import { normalizeCostMultiplier } from '../cost';
import { normalizeMaxConcurrency } from '../concurrency';
import { versionPrefixOrDefault } from '../version-prefix';
import { ProducerConnection, type ProducerEvent } from './producer-connection';

const HEARTBEAT_MS = 15_000;
const HEALTH_MS = 30_000;
const MAX_CHUNK_BYTES = 64 * 1024;
const MAX_CONCURRENCY_MESSAGE = 'This producer node has reached its maximum concurrency limit.';

/**
 * Join a producer base URL with a consumer or health-check path. The path is
 * preserved exactly apart from ensuring one boundary slash; version segments
 * are never removed or de-duplicated.
 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : '/' + path;
  return base + p;
}

function joinVersionPath(versionPrefix: string, endpointPath: string): string {
  const prefix = versionPrefix === '/' ? '' : versionPrefix.replace(/\/+$/, '');
  const endpoint = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  return `${prefix}${endpoint}`;
}

type Events = {
  status: (s: ProducerStatus) => void;
  autodown: (reason: string) => void;
};

export type HealthResult = { ok: boolean; reason?: string };

/**
 * Probe a backend's availability without registering anything. Shared by the
 * per-backend pre-share gate (core add/update) and the daemon's periodic check.
 */
export async function probeHealth(cfg: BackendConfig): Promise<HealthResult> {
  try {
    const { path, headers, body } = adapterFor(cfg.protocol).health(cfg);
    const versionPrefix = versionPrefixOrDefault(cfg.versionPrefix, cfg.protocol);
    const res = await fetch(joinUrl(cfg.baseUrl, joinVersionPath(versionPrefix, path)), {
      method: 'POST',
      headers,
      body,
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'AUTH' };
    if (res.status === 402 || res.status === 429) return { ok: false, reason: 'QUOTA' };
    if (!res.ok) return { ok: false, reason: 'HTTP' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'NETWORK' };
  }
}

export class ProducerDaemon extends Emitter<Events> {
  private healthTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private registered = false;
  private lastAdSig = ''; // signature of the last advertised offerings (skip no-op re-registers)
  private accessToken: string | null = null;

  // Per-backend state, keyed by stable backend id.
  private backends = new Map<string, BackendConfig>();
  private health = new Map<string, BackendStatus['lastHealth']>(); // raw probe result (UI)
  private advertise = new Map<string, boolean>(); // whether the backend's models are advertised
  private failStreak = new Map<string, number>();
  private activeRequests = new Map<string, Set<symbol>>();
  private inbound = new Map<string, {
    controller: ReadableStreamDefaultController<Uint8Array>;
    abort: AbortController;
  }>();
  private readonly requestListener = (event: ProducerEvent) => this.onRequestEvent(event);
  private readonly closeListener = () => this.onSignalingClose();

  constructor(private connection: ProducerConnection) { super(); }

  status(): ProducerStatus {
    const backends: BackendStatus[] = [...this.backends.values()].map((b) => ({
      id: b.id,
      protocol: b.protocol,
      models: b.models,
      costMultiplier: normalizeCostMultiplier(b.costMultiplier),
      enabled: b.enabled !== false,
      advertised: this.registered && this.advertise.get(b.id) === true,
      lastHealth: this.health.get(b.id),
    }));
    return { running: this.running, registered: this.registered, backends };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connection.on('request', this.requestListener);
    this.connection.on('close', this.closeListener);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.healthTimer = setInterval(() => void this.check(), HEALTH_MS);
    void this.check(); // probes every backend then (re)registers the healthy union
    this.emit('status', this.status());
  }

  stop(reason = 'manual'): void {
    if (!this.running) return;
    this.running = false;
    this.connection.off('request', this.requestListener);
    this.connection.off('close', this.closeListener);
    clearInterval(this.heartbeatTimer);
    clearInterval(this.healthTimer);
    if (this.registered) this.connection.deregister(reason);
    this.abortInbound('producer stopped');
    this.registered = false;
    this.lastAdSig = '';
    this.emit('status', this.status());
  }

  setAccessToken(token: string | null): void {
    const normalized = token?.trim() || null;
    if (this.accessToken === normalized) return;
    const wasRegistered = this.registered;
    this.accessToken = normalized;
    this.registered = wasRegistered;
    this.lastAdSig = '';
    this.syncRegistration();
  }

  onSignalingOpen(): void {
    if (!this.running) return;
    // The server dropped our registration when the socket closed; force
    // a fresh register of the current advertised offerings.
    this.registered = false;
    this.lastAdSig = '';
    this.syncRegistration();
  }

  private onSignalingClose(): void {
    if (!this.running) return;
    this.registered = false;
    this.lastAdSig = '';
    this.abortInbound('server connection closed');
    this.emit('status', this.status());
  }

  private abortInbound(reason: string): void {
    for (const active of this.inbound.values()) {
      active.abort.abort();
      try { active.controller.error(new Error(reason)); } catch { /* already closed */ }
    }
  }

  /* ----------------------------- backend control ---------------------------- */

  /** Add/replace one backend, gate it on a health probe, advertise if healthy. */
  async addBackend(b: BackendConfig): Promise<HealthResult> {
    this.backends.set(b.id, b);
    const r = await this.probeAndRecord(b);
    this.syncRegistration();
    return r;
  }

  /** Same gate as add; resets the failure streak for the (re)configured backend. */
  updateBackend(b: BackendConfig): Promise<HealthResult> {
    return this.addBackend(b);
  }

  removeBackend(id: string): void {
    this.dropState(id);
    this.syncRegistration();
  }

  /** Stop one backend (user action): keep its config but take it off the air.
   *  No health probe — it just stops being advertised until re-enabled. */
  disableBackend(id: string): void {
    const b = this.backends.get(id);
    if (b) this.backends.set(id, { ...b, enabled: false });
    this.advertise.set(id, false);
    this.failStreak.set(id, 0);
    this.syncRegistration();
  }

  /** Replace the whole backend set (page-driven auto-share). Gates each one. */
  async setBackends(list: BackendConfig[]): Promise<void> {
    const keep = new Set(list.map((b) => b.id));
    for (const id of [...this.backends.keys()]) if (!keep.has(id)) this.dropState(id);
    await Promise.all(
      list.map(async (b) => {
        this.backends.set(b.id, b);
        await this.probeAndRecord(b);
      }),
    );
    this.syncRegistration();
  }

  private dropState(id: string): void {
    this.backends.delete(id);
    this.health.delete(id);
    this.advertise.delete(id);
    this.failStreak.delete(id);
  }

  /** Probe one backend and record its health + advertise decision (strict gate).
   *  A user-stopped backend is never probed/advertised. */
  private async probeAndRecord(b: BackendConfig): Promise<HealthResult> {
    if (b.enabled === false) {
      this.advertise.set(b.id, false);
      this.failStreak.set(b.id, 0);
      return { ok: true };
    }
    const r = await probeHealth(b);
    this.health.set(b.id, { ok: r.ok, reason: r.reason, at: Date.now() });
    this.advertise.set(b.id, r.ok);
    this.failStreak.set(b.id, 0);
    return r;
  }

  /* ------------------------------- registration ----------------------------- */

  /** Healthy backends grouped by protocol; same-protocol models are unioned. */
  private advertisedOfferings(): Offering[] {
    const byProto = new Map<string, {
      models: string[];
      costMultipliers: Record<string, number>;
      supportedTools: Record<string, ReturnType<typeof normalizeSupportedTools>>;
      versionPrefixes: Record<string, string>;
    }>();
    for (const b of this.backends.values()) {
      if (b.enabled === false) continue;
      if (this.advertise.get(b.id) !== true) continue;
      const entry = byProto.get(b.protocol) ?? {
        models: [],
        costMultipliers: {},
        supportedTools: {},
        versionPrefixes: {},
      };
      const costMultiplier = normalizeCostMultiplier(b.costMultiplier);
      const tools = normalizeSupportedTools(b.supportedTools, b.protocol);
      for (const m of b.models) {
        if (!entry.models.includes(m)) entry.models.push(m);
        entry.costMultipliers[m] ??= costMultiplier;
        entry.supportedTools[m] = normalizeSupportedTools(
          [...(entry.supportedTools[m] ?? []), ...tools],
          b.protocol,
        );
        entry.versionPrefixes[m] ??= versionPrefixOrDefault(b.versionPrefix, b.protocol);
      }
      byProto.set(b.protocol, entry);
    }
    return [...byProto].map(([
      protocol,
      { models, costMultipliers, supportedTools, versionPrefixes },
    ]) => ({
      protocol,
      models,
      costMultipliers,
      supportedTools,
      versionPrefixes,
    }));
  }

  /** Reconcile the advertised offerings with the server registration. */
  private syncRegistration(): void {
    if (!this.running) {
      this.emit('status', this.status());
      return;
    }
    const offerings = this.advertisedOfferings();
    const sig = JSON.stringify(offerings);
    if (offerings.length === 0) {
      if (this.registered) this.connection.deregister('all-unhealthy');
      this.registered = false;
      this.lastAdSig = '';
    } else if (!this.accessToken) {
      if (this.registered) this.connection.deregister('missing-token');
      this.registered = false;
      this.lastAdSig = '';
    } else if (sig !== this.lastAdSig || !this.registered) {
      const sent = this.connection.register(`Bearer ${this.accessToken}`, offerings);
      this.registered = sent;
      this.lastAdSig = sent ? sig : '';
    }
    this.emit('status', this.status());
  }

  private heartbeat(): void {
    if (this.registered) this.connection.heartbeat();
  }

  /* -------------------------------- health loop ----------------------------- */

  private async check(): Promise<void> {
    await Promise.all([...this.backends.values()].map((b) => this.checkBackend(b)));
    this.syncRegistration();
  }

  private async checkBackend(b: BackendConfig): Promise<void> {
    if (b.enabled === false) return; // user-stopped: don't probe or advertise
    const r = await probeHealth(b);
    this.health.set(b.id, { ok: r.ok, reason: r.reason, at: Date.now() });
    if (r.ok) {
      this.advertise.set(b.id, true);
      this.failStreak.set(b.id, 0);
      return;
    }
    const streak = (this.failStreak.get(b.id) ?? 0) + 1;
    this.failStreak.set(b.id, streak);
    // QUOTA/AUTH drop immediately; NETWORK only after a 2nd consecutive miss.
    if (r.reason === 'QUOTA' || r.reason === 'AUTH' || streak >= 2) {
      if (this.advertise.get(b.id) !== false) this.emit('autodown', `${b.id} ${r.reason ?? 'UNHEALTHY'}`);
      this.advertise.set(b.id, false);
    }
  }

  /* --------------------------------- routing -------------------------------- */

  /** Pick the backend serving (proto, model). Empty model (old consumer) only
   *  resolves when exactly one backend serves the protocol. */
  private selectBackend(proto: string, model: string): BackendConfig | undefined {
    const forProto = [...this.backends.values()].filter(
      (b) =>
        b.protocol === proto &&
        b.enabled !== false &&
        this.advertise.get(b.id) === true,
    );
    if (model) return forProto.find((b) => b.models.includes(model));
    return forProto.length === 1 ? forProto[0] : undefined;
  }

  private acquireRequestSlot(backend: BackendConfig): symbol | undefined {
    const active = this.activeRequests.get(backend.id) ?? new Set<symbol>();
    if (active.size >= normalizeMaxConcurrency(backend.maxConcurrency)) return undefined;
    const token = Symbol(backend.id);
    active.add(token);
    this.activeRequests.set(backend.id, active);
    return token;
  }

  private releaseRequestSlot(backendId: string, token: symbol): void {
    const active = this.activeRequests.get(backendId);
    if (!active) return;
    active.delete(token);
    if (active.size === 0) this.activeRequests.delete(backendId);
  }

  private onRequestEvent(event: ProducerEvent): void {
    if (event.type === 'request.start') {
      void this.startRequest(event).catch((error: unknown) => {
        this.connection.respond({
          type: 'response.error',
          requestId: event.requestId,
          data: {
            message: error instanceof Error ? error.message : String(error),
            code: 'UPSTREAM_ERROR',
            status: 502,
          },
        });
      });
    } else if (event.type === 'request.chunk' && event.chunk) {
      const active = this.inbound.get(event.requestId);
      try { active?.controller.enqueue(event.chunk); } catch { /* late chunk */ }
    } else if (event.type === 'request.end') {
      const active = this.inbound.get(event.requestId);
      try { active?.controller.close(); } catch { /* duplicate end */ }
    } else if (event.type === 'request.cancel') {
      const active = this.inbound.get(event.requestId);
      active?.abort.abort();
      try { active?.controller.error(new Error('request cancelled')); } catch { /* closed */ }
    }
  }

  private async startRequest(event: ProducerEvent): Promise<void> {
    const data = event.data ?? {};
    const proto = String(data.protocol ?? '');
    const model = String(data.model ?? '');
    const method = String(data.method ?? 'POST').toUpperCase();
    const path = String(data.path ?? '/');
    const rawHeaders = data.headers && typeof data.headers === 'object'
      ? data.headers as Record<string, string>
      : {};
    const send = (type: string, extra: Record<string, unknown> = {}) => {
      if (!this.connection.respond({ type, requestId: event.requestId, ...extra })) {
        throw new Error('server connection not open');
      }
    };
    const backend = this.selectBackend(proto, model);
    if (!backend) {
      send('response.error', { data: { message: `no backend for '${proto}'/'${model}'`, code: 'BACKEND_NOT_FOUND' } });
      return;
    }
    const adapter = adapterFor(backend.protocol);
    const headers = sanitizeHeaders(rawHeaders);
    for (const name of adapter.authHeaderNames) delete headers[name];
    for (const [k, v] of Object.entries(adapter.authHeaders(backend))) {
      if (k === 'anthropic-version' && headers['anthropic-version']) continue;
      headers[k] = v;
    }
    const requestSlot = this.acquireRequestSlot(backend);
    if (!requestSlot) {
      send('response.error', {
        data: { message: MAX_CONCURRENCY_MESSAGE, code: 'PRODUCER_MAX_CONCURRENCY', status: 429 },
      });
      return;
    }
    const abortController = new AbortController();
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (controller) => { bodyController = controller; } });
    this.inbound.set(event.requestId, { controller: bodyController, abort: abortController });
    let responseStatus: number | undefined;
    try {
      const init: RequestInit & { duplex?: 'half' } = {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        signal: abortController.signal,
        duplex: 'half',
      };
      const res = await fetch(joinUrl(backend.baseUrl, path), init);
      responseStatus = res.status;
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (resHeaders[k] = v));
      send('response.head', { data: { status: res.status, headers: sanitizeHeaders(resHeaders) } });
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (let off = 0; off < value.length; off += MAX_CHUNK_BYTES) {
            const slice = value.subarray(off, off + MAX_CHUNK_BYTES);
            if (!await this.connection.respondChunk(event.requestId, slice)) {
              throw new Error('server connection not open');
            }
          }
        }
      }
      send('response.end');
    } catch (e) {
      if (!abortController.signal.aborted) {
        try {
          send('response.error', {
            data: { message: String((e as Error)?.message ?? e), code: 'UPSTREAM_ERROR' },
          });
        } catch { /* socket already closed */ }
      }
    } finally {
      this.inbound.delete(event.requestId);
      this.releaseRequestSlot(backend.id, requestSlot);
    }
    if (responseStatus === 402 || responseStatus === 429) {
      this.health.set(backend.id, { ok: false, reason: 'QUOTA', at: Date.now() });
      if (this.advertise.get(backend.id) !== false) this.emit('autodown', `${backend.id} QUOTA`);
      this.advertise.set(backend.id, false);
      this.syncRegistration();
    }
  }
}
