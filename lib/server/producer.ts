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
import type { BackendConfig, BackendStatus, ProducerStatus } from './types';
import { normalizeCostMultiplier } from '../cost';
import { ProducerConnection, type ProducerEvent } from './producer-connection';
import { buildAdvertisedOfferings, probeHealth, type HealthResult } from './producer-health';
import { ProducerRequestRouter } from './producer-request-router';

const HEARTBEAT_MS = 15_000;
const HEALTH_MS = 30_000;

/**
 * Join a producer base URL with a consumer or health-check path. The path is
 * preserved exactly apart from ensuring one boundary slash; version segments
 * are never removed or de-duplicated.
 */
type Events = {
  status: (s: ProducerStatus) => void;
  autodown: (reason: string) => void;
};

export { joinUrl, probeHealth } from './producer-health';
export type { HealthResult } from './producer-health';

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
  private checking = new Map<string, boolean>();
  private operation = new Map<string, number>();
  private failStreak = new Map<string, number>();
  private readonly requestRouter: ProducerRequestRouter;
  private readonly requestListener = (event: ProducerEvent) => this.requestRouter.handle(event);
  private readonly closeListener = () => this.onSignalingClose();

  constructor(private connection: ProducerConnection) {
    super();
    this.requestRouter = new ProducerRequestRouter(
      connection,
      () => this.backends.values(),
      (id) => this.advertise.get(id) === true,
      (id) => this.markQuotaExceeded(id),
    );
  }

  status(): ProducerStatus {
    const backends: BackendStatus[] = [...this.backends.values()].map((b) => ({
      id: b.id,
      protocol: b.protocol,
      models: b.models,
      costMultiplier: normalizeCostMultiplier(b.costMultiplier),
      enabled: b.enabled !== false,
      advertised: this.registered && this.advertise.get(b.id) === true,
      checking: this.checking.get(b.id) === true,
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
    this.requestRouter.abortAll('producer stopped');
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
    this.requestRouter.abortAll('server connection closed');
    this.emit('status', this.status());
  }

  /* ----------------------------- backend control ---------------------------- */

  /** Save immediately, then health-gate this backend without blocking control UI. */
  addBackend(b: BackendConfig): void {
    const operation = this.nextOperation(b.id);
    this.backends.set(b.id, b);
    this.health.delete(b.id);
    this.advertise.set(b.id, false);
    this.checking.set(b.id, b.enabled !== false);
    this.failStreak.set(b.id, 0);
    this.syncRegistration();
    if (b.enabled !== false) void this.probeAndRecord(b, operation);
  }

  /** Same gate as add; resets the failure streak for the (re)configured backend. */
  updateBackend(b: BackendConfig): void {
    this.addBackend(b);
  }

  removeBackend(id: string): void {
    this.dropState(id);
    this.syncRegistration();
  }

  /** Stop one backend (user action): keep its config but take it off the air.
   *  No health probe — it just stops being advertised until re-enabled. */
  disableBackend(id: string): void {
    this.nextOperation(id);
    const b = this.backends.get(id);
    if (b) this.backends.set(id, { ...b, enabled: false });
    this.advertise.set(id, false);
    this.checking.set(id, false);
    this.failStreak.set(id, 0);
    this.syncRegistration();
  }

  /** Replace the whole set immediately; enabled backends are probed in background. */
  setBackends(list: BackendConfig[]): void {
    const keep = new Set(list.map((b) => b.id));
    for (const id of [...this.backends.keys()]) if (!keep.has(id)) this.dropState(id);
    const probes: Array<{ backend: BackendConfig; operation: number }> = [];
    for (const b of list) {
      const operation = this.nextOperation(b.id);
      this.backends.set(b.id, b);
      this.advertise.set(b.id, false);
      this.checking.set(b.id, b.enabled !== false);
      this.failStreak.set(b.id, 0);
      if (b.enabled !== false) {
        this.health.delete(b.id);
        probes.push({ backend: b, operation });
      }
    }
    this.syncRegistration();
    for (const probe of probes) void this.probeAndRecord(probe.backend, probe.operation);
  }

  private dropState(id: string): void {
    this.nextOperation(id);
    this.backends.delete(id);
    this.health.delete(id);
    this.advertise.delete(id);
    this.checking.delete(id);
    this.failStreak.delete(id);
  }

  /** Probe one backend and record its health + advertise decision (strict gate).
   *  A user-stopped backend is never probed/advertised. */
  private async probeAndRecord(b: BackendConfig, operation = this.operation.get(b.id) ?? 0): Promise<HealthResult> {
    if (b.enabled === false) {
      this.advertise.set(b.id, false);
      this.checking.set(b.id, false);
      this.failStreak.set(b.id, 0);
      return { ok: true };
    }
    const r = await probeHealth(b);
    if (this.operation.get(b.id) !== operation || this.backends.get(b.id) !== b) return r;
    this.health.set(b.id, { ok: r.ok, reason: r.reason, at: Date.now() });
    this.advertise.set(b.id, r.ok);
    this.checking.set(b.id, false);
    this.failStreak.set(b.id, 0);
    this.syncRegistration();
    return r;
  }

  private nextOperation(id: string): number {
    const next = (this.operation.get(id) ?? 0) + 1;
    this.operation.set(id, next);
    return next;
  }

  /* ------------------------------- registration ----------------------------- */

  /** Healthy backends grouped by protocol; same-protocol models are unioned. */
  /** Reconcile the advertised offerings with the server registration. */
  private syncRegistration(): void {
    if (!this.running) {
      this.emit('status', this.status());
      return;
    }
    const offerings = buildAdvertisedOfferings(this.backends.values(), this.advertise);
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
    const operation = this.operation.get(b.id) ?? 0;
    const r = await probeHealth(b);
    if (this.operation.get(b.id) !== operation || this.backends.get(b.id) !== b) return;
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

  private markQuotaExceeded(backendId: string): void {
    this.health.set(backendId, { ok: false, reason: 'QUOTA', at: Date.now() });
    if (this.advertise.get(backendId) !== false) this.emit('autodown', `${backendId} QUOTA`);
    this.advertise.set(backendId, false);
    this.syncRegistration();
  }
}
