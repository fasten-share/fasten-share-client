import { randomUUID } from 'node:crypto';
import { accountStore, type AccountProfile } from './account-store';
import { getBrowserLink, type BrowserLink } from './browser-link';
import { config } from './config';
import { ProducerConnection } from './producer-connection';
import { ProducerDaemon } from './producer';
import type { BackendConfig, Candidate, ProducerStatus } from './types';
import type { UserDto } from '../client/auth-types';
import { normalizeSupportedTools } from '../tool-support';
import { normalizeCostMultiplier } from '../cost';
import { normalizeMaxConcurrency } from '../concurrency';
import { versionPrefixOrDefault } from '../version-prefix';
import { PRODUCER_WS_PATH } from './protocol-version';
import { generateApiKeyEncryptionKey } from './api-key-crypto';

function producerWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = PRODUCER_WS_PATH;
  url.search = '';
  return url.toString();
}

export function tokenUserId(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown };
    return typeof payload.sub === 'string' && /^\d+$/.test(payload.sub) ? payload.sub : null;
  } catch { return null; }
}

export class AccountRuntime {
  private readonly connection: ProducerConnection;
  private producer?: ProducerDaemon;
  private producerStatus: ProducerStatus = { running: false, registered: false, backends: [] };
  private producerId: string | null = null;
  private configRevision = 0;
  private forcedLogoutCode: 'DEVICE_LIMIT_EXCEEDED' | null = null;
  private profile: AccountProfile;
  private renewalTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly userId: string,
    private accessToken: string,
    readonly encryptionKey: string,
    private readonly link: BrowserLink,
    private readonly onInvalid: (userId: string) => void,
  ) {
    const cfg = config.all();
    this.profile = accountStore.readProfile(userId);
    this.connection = new ProducerConnection(producerWsUrl(cfg.serverUrl), cfg.deviceId);
    this.connection.on('open', () => { this.producer?.onSignalingOpen(); this.pushStatus(); });
    this.connection.on('close', () => this.pushStatus());
    this.connection.on('registered', (producerId) => { this.producerId = producerId; this.pushStatus(); });
    this.connection.on('error', (error) => console.warn(`[producer-connection:${userId}]`, error.message));
    this.connection.on('forcedLogout', () => {
      this.forcedLogoutCode = 'DEVICE_LIMIT_EXCEEDED';
      this.stop();
      this.onInvalid(userId);
      this.link.send({ t: 'forcedLogout', userId, code: 'DEVICE_LIMIT_EXCEEDED' });
    });
    this.connection.start();
    this.scheduleRenewal();
    if (this.profile.autoShare && this.profile.backends.some((b) => b.enabled !== false)) this.startProducer();
  }

  token(): string { return this.accessToken; }
  setToken(token: string): void { this.accessToken = token; this.producer?.setAccessToken(token); this.scheduleRenewal(); }
  private scheduleRenewal(): void {
    clearTimeout(this.renewalTimer);
    let expiresAt = 0;
    try {
      const payload = JSON.parse(Buffer.from(this.accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
      expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    } catch {}
    if (!expiresAt) return;
    const delay = Math.min(Math.max(expiresAt - Date.now() - 24 * 60 * 60 * 1000, 1_000), 2_147_483_647);
    this.renewalTimer = setTimeout(() => void this.renew(), delay);
  }
  private async renew(): Promise<void> {
    try {
      const response = await fetch(new URL('/api/v1/auth/refresh', config.all().serverUrl), {
        method: 'POST', cache: 'no-store', headers: { authorization: `Bearer ${this.accessToken}` },
      });
      if (response.status === 401 || response.status === 403) return this.onInvalid(this.userId);
      if (!response.ok) throw new Error(`refresh failed (${response.status})`);
      const data = await response.json() as { accessToken?: string | null };
      if (data.accessToken) { accountStore.updateToken(this.userId, data.accessToken); this.setToken(data.accessToken); }
      else this.scheduleRenewal();
    } catch {
      this.renewalTimer = setTimeout(() => void this.renew(), 5 * 60 * 1000);
    }
  }
  pushStatus(): void {
    this.link.send({
      t: 'status', userId: this.userId, configRevision: this.configRevision,
      producer: this.producerStatus, connectedProducers: [],
      node: { signaling: { connected: this.connection.connected, peerId: this.producerId ?? undefined } },
    });
  }
  private ensureDaemon(): ProducerDaemon {
    if (!this.producer) {
      const producer = new ProducerDaemon(this.connection);
      this.producer = producer;
      producer.setAccessToken(this.accessToken);
      producer.on('status', (status) => {
        if (this.producer !== producer) return;
        this.producerStatus = status;
        this.pushStatus();
      });
      producer.on('autodown', (reason) => console.warn(`[producer:${this.userId}]`, reason));
      producer.start();
    }
    return this.producer;
  }
  startProducer(): { ok: boolean; error?: string } {
    if (!this.profile.backends.length) return { ok: false, error: 'no backend configured' };
    this.ensureDaemon().setBackends(this.profile.backends);
    return { ok: true };
  }
  stopProducer(): void {
    this.producer?.stop('manual'); this.producer = undefined;
    this.producerStatus = { running: false, registered: false, backends: [] }; this.pushStatus();
  }
  stop(): void { clearTimeout(this.renewalTimer); this.stopProducer(); this.connection.stop(); this.accessToken = ''; }
  async discoverModels(keyword: string, protocol: string, publisherUserIds?: string[], cursor?: string, limit = 20) {
    if (!this.accessToken) return { candidates: [] as Candidate[], nextCursor: null, hasMore: false, limit };
    const url = new URL('/api/v1/producers', config.all().serverUrl);
    if (keyword) url.searchParams.set('keyword', keyword);
    if (protocol) url.searchParams.set('protocol', protocol);
    if (publisherUserIds?.length) url.searchParams.set('publisherUserIds', publisherUserIds.join(','));
    if (cursor) url.searchParams.set('cursor', cursor);
    url.searchParams.set('limit', String(limit));
    const response = await fetch(url, { headers: { authorization: `Bearer ${this.accessToken}` }, cache: 'no-store' });
    if (!response.ok) throw new Error(`producer discovery failed (${response.status})`);
    const data = await response.json() as { candidates?: Candidate[]; nextCursor?: string | null; hasMore?: boolean; limit?: number };
    return { candidates: data.candidates ?? [], nextCursor: data.nextCursor ?? null, hasMore: data.hasMore === true, limit: data.limit ?? limit };
  }
  setSignalUrl(): void { this.connection.setUrl(producerWsUrl(config.all().serverUrl)); this.changed(); }
  setAutoShare(enabled: boolean): void { this.saveProfile({ ...this.profile, autoShare: enabled }); }
  private normalizeBackend(backend: BackendConfig): BackendConfig {
    const normalized = { ...backend, id: backend.id || randomUUID(), costMultiplier: normalizeCostMultiplier(backend.costMultiplier), maxConcurrency: normalizeMaxConcurrency(backend.maxConcurrency), supportedTools: normalizeSupportedTools(backend.supportedTools, backend.protocol), versionPrefix: versionPrefixOrDefault(backend.versionPrefix, backend.protocol) };
    if (normalized.apiKey) return normalized;
    const previous = this.profile.backends.find((item) => item.id === normalized.id);
    return previous?.apiKey ? { ...normalized, apiKey: previous.apiKey } : normalized;
  }
  private saveProfile(profile: AccountProfile): void { this.profile = profile; accountStore.saveProfile(profile); this.changed(); }
  private save(backend: BackendConfig): void {
    const exists = this.profile.backends.some((item) => item.id === backend.id);
    this.saveProfile({ ...this.profile, backends: exists ? this.profile.backends.map((item) => item.id === backend.id ? backend : item) : [...this.profile.backends, backend] });
  }
  addBackend(backend: BackendConfig): void { const value = this.normalizeBackend(backend); this.save(value); this.ensureDaemon().addBackend(value); }
  updateBackend(backend: BackendConfig): void { const value = this.normalizeBackend(backend); this.save(value); this.ensureDaemon().updateBackend(value); }
  removeBackend(id: string): void { this.saveProfile({ ...this.profile, backends: this.profile.backends.filter((item) => item.id !== id) }); this.producer?.removeBackend(id); }
  setBackendEnabled(id: string, enabled: boolean): void {
    const current = this.profile.backends.find((item) => item.id === id); if (!current) return;
    this.save({ ...current, enabled }); if (enabled) this.ensureDaemon().updateBackend({ ...current, enabled }); else this.producer?.disableBackend(id);
  }
  setBackends(backends: BackendConfig[]): void {
    const normalized = backends.map((backend) => this.normalizeBackend(backend));
    this.saveProfile({ ...this.profile, backends: normalized });
    if (!normalized.length) this.stopProducer(); else this.ensureDaemon().setBackends(normalized);
  }
  status() {
    return { userId: this.userId, configRevision: this.configRevision, transport: { ready: true, wsPort: this.link.port }, signaling: { connected: this.connection.connected, peerId: this.producerId ?? undefined }, producer: this.producerStatus, config: { signalUrl: config.all().serverUrl, autoShare: this.profile.autoShare, backends: this.profile.backends.map((backend) => ({ ...backend })) }, connectedProducers: [] };
  }
  private changed(): void { this.configRevision += 1; this.pushStatus(); }
}

export class Core {
  readonly link = getBrowserLink();
  private readonly runtimes = new Map<string, AccountRuntime>();
  constructor() {
    for (const account of accountStore.accounts()) if (account.state === 'active' && account.token) this.createRuntime(account.user.id, account.token, account.encryptionKey);
    this.link.on('connect', () => this.runtimes.forEach((runtime) => runtime.pushStatus()));
  }
  private createRuntime(userId: string, token: string, encryptionKey: string): AccountRuntime {
    this.runtimes.get(userId)?.stop();
    const runtime = new AccountRuntime(userId, token, encryptionKey, this.link, (id) => this.invalidate(id));
    this.runtimes.set(userId, runtime); return runtime;
  }
  beginEncryptionSession(token: string, user: UserDto): string {
    const userId = tokenUserId(token); if (!userId || user.id !== userId) throw new Error('invalid login token');
    const key = generateApiKeyEncryptionKey(); accountStore.saveAccount(user, token, key); this.createRuntime(userId, token, key); config.setLastActiveUserId(userId); return key;
  }
  runtimeForToken(token: string | null): AccountRuntime | null { const id = token ? tokenUserId(token) : null; return id ? this.runtimes.get(id) ?? null : null; }
  encryptionKeyForToken(token: string | null): string | null { return this.runtimeForToken(token)?.encryptionKey ?? null; }
  clearEncryptionSession(token?: string | null): void { const id = token ? tokenUserId(token) : null; if (id) this.logout(id); }
  setAccessToken(token: string | null): void { if (!token) return; const runtime = this.runtimeForToken(token); runtime?.setToken(token); if (runtime) accountStore.updateToken(runtime.userId, token); }
  accounts() {
    type Summary = { user: UserDto; lastUsedAt: number; state: 'active' | 'reauth-required' | 'signed-out'; running: boolean };
    const active = new Map(accountStore.accounts().map((account) => [account.user.id, account]));
    const result: Summary[] = accountStore.accounts().map(({ user, lastUsedAt, state }) => ({ user, lastUsedAt, state, running: this.runtimes.get(user.id)?.status().producer.running ?? false }));
    for (const userId of accountStore.profileUserIds()) {
      if (active.has(userId)) continue;
      const user = accountStore.readProfile(userId).user;
      if (user) result.push({ user, lastUsedAt: 0, state: 'signed-out', running: false });
    }
    return result;
  }
  accountCredentials(userId: string) { return accountStore.account(userId); }
  selectAccount(userId: string): void { accountStore.touch(userId); config.setLastActiveUserId(userId); }
  logout(userId: string): void { this.runtimes.get(userId)?.stop(); this.runtimes.delete(userId); accountStore.logout(userId); }
  deleteProfile(userId: string): void { this.logout(userId); accountStore.deleteProfile(userId); }
  private invalidate(userId: string): void { this.runtimes.get(userId)?.stop(); this.runtimes.delete(userId); accountStore.requireReauth(userId); }
}

declare global { var __mcCore: Core | undefined; }
export function getCore(): Core { return (globalThis.__mcCore ??= new Core()); }
