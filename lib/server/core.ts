import { randomUUID } from 'node:crypto';
import { getBrowserLink, type BrowserLink } from './browser-link';
import { config } from './config';
import { ProducerConnection } from './producer-connection';
import { ProducerDaemon, type HealthResult } from './producer';
import type { BackendConfig, Candidate, ProducerStatus } from './types';
import { normalizeSupportedTools } from '../tool-support';
import { normalizeCostMultiplier } from '../cost';
import { normalizeMaxConcurrency } from '../concurrency';
import { versionPrefixOrDefault } from '../version-prefix';
import { PRODUCER_WS_PATH } from './protocol-version';
import { SERVICE_URL } from './service-url';
import { generateApiKeyEncryptionKey } from './api-key-crypto';

function producerWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = PRODUCER_WS_PATH;
  url.search = '';
  return url.toString();
}

function tokenUserId(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      sub?: unknown;
    };
    return typeof payload.sub === 'string' && /^\d+$/.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

export class Core {
  readonly link: BrowserLink;
  private connection: ProducerConnection;
  private producer?: ProducerDaemon;
  private producerStatus: ProducerStatus = { running: false, registered: false, backends: [] };
  private accessToken: string | null = null;
  private activeUserId: string | null = null;
  private producerId: string | null = null;
  private encryptionUserId: string | null = null;
  private encryptionKey: string | null = null;

  constructor() {
    const cfg = config.all();
    this.link = getBrowserLink();
    this.connection = new ProducerConnection(producerWsUrl(cfg.serverUrl));
    this.connection.on('open', () => {
      this.producer?.onSignalingOpen();
      this.pushStatus();
    });
    this.connection.on('close', () => this.pushStatus());
    this.connection.on('registered', (producerId) => {
      if (!this.activeUserId) return;
      this.producerId = producerId;
      this.pushStatus();
    });
    this.connection.on('error', (error) => console.warn('[producer-connection]', error.message));
    this.link.on('connect', () => this.pushStatus());
    this.connection.start();
  }

  private pushStatus(): void {
    this.link.send({
      t: 'status',
      producer: this.producerStatus,
      connectedProducers: [],
      node: {
        signaling: {
          connected: this.connection.connected,
          peerId: this.producerId ?? undefined,
        },
      },
    });
  }

  private ensureDaemon(): ProducerDaemon {
    if (!this.producer) {
      if (!this.activeUserId) {
        throw new Error('producer requires an authenticated account');
      }
      const producer = new ProducerDaemon(this.connection);
      this.producer = producer;
      producer.setAccessToken(this.accessToken);
      producer.on('status', (status) => {
        if (this.producer !== producer) return;
        this.producerStatus = status;
        this.pushStatus();
      });
      producer.on('autodown', (reason) => {
        if (this.producer === producer) console.warn('[producer]', reason);
      });
      producer.start();
    }
    return this.producer;
  }

  setAccessToken(token: string | null): void {
    const normalized = token?.trim() || null;
    const userId = normalized ? tokenUserId(normalized) : null;
    if (!normalized || !userId) {
      this.accessToken = null;
      this.activeUserId = null;
      this.producerId = null;
      this.stopProducer();
      return;
    }
    if (this.activeUserId !== userId) {
      this.stopProducer();
      this.activeUserId = userId;
      this.producerId = null;
      const cfg = config.all();
      if (cfg.backendOwnerUserId !== userId) config.setOwnedBackends(userId, []);
    }
    this.accessToken = normalized;
    this.producer?.setAccessToken(normalized);
    const cfg = config.all();
    if (
      !this.producer &&
      cfg.autoShare &&
      cfg.backendOwnerUserId === userId &&
      cfg.backends.some((b) => b.enabled !== false)
    ) {
      this.startProducer();
    }
    this.pushStatus();
  }

  beginEncryptionSession(token: string): string {
    const userId = tokenUserId(token);
    if (!userId) throw new Error('invalid login token');
    const key = generateApiKeyEncryptionKey();
    this.encryptionUserId = userId;
    this.encryptionKey = key;
    this.setAccessToken(token);
    return key;
  }

  encryptionKeyForToken(token: string | null): string | null {
    const userId = token ? tokenUserId(token) : null;
    return userId && userId === this.encryptionUserId ? this.encryptionKey : null;
  }

  clearEncryptionSession(token?: string | null): void {
    const userId = token ? tokenUserId(token) : this.encryptionUserId;
    if (userId && userId === this.encryptionUserId) {
      this.encryptionUserId = null;
      this.encryptionKey = null;
    }
  }

  startProducer(): { ok: boolean; error?: string } {
    const backends = config.all().backends;
    if (!backends.length) return { ok: false, error: 'no backend configured' };
    void this.ensureDaemon().setBackends(backends);
    return { ok: true };
  }

  stopProducer(): void {
    this.producer?.stop('manual');
    this.producer = undefined;
    this.producerStatus = { running: false, registered: false, backends: [] };
    this.pushStatus();
  }

  async discoverModels(
    keyword: string,
    protocol: string,
    publisherUserIds?: string[],
    page = 1,
    pageSize = 20,
  ): Promise<{ candidates: Candidate[]; page: number; pageSize: number; total: number }> {
    if (!this.accessToken) return { candidates: [], page, pageSize, total: 0 };
    const url = new URL('/api/v1/producers', config.all().serverUrl);
    if (keyword) url.searchParams.set('keyword', keyword);
    if (protocol) url.searchParams.set('protocol', protocol);
    if (publisherUserIds?.length) url.searchParams.set('publisherUserIds', publisherUserIds.join(','));
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(pageSize));
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`producer discovery failed (${response.status})`);
    const data = (await response.json()) as {
      candidates?: Candidate[];
      page?: number;
      pageSize?: number;
      total?: number;
    };
    return {
      candidates: data.candidates ?? [],
      page: data.page ?? page,
      pageSize: data.pageSize ?? pageSize,
      total: data.total ?? 0,
    };
  }

  setSignalUrl(): void {
    config.setServerUrl();
    this.connection.setUrl(producerWsUrl(SERVICE_URL));
  }

  setAutoShare(enabled: boolean): void {
    config.setAutoShare(enabled);
  }

  private normalizeBackend(backend: BackendConfig): BackendConfig {
    const normalized = {
      ...backend,
      id: backend.id || randomUUID(),
      costMultiplier: normalizeCostMultiplier(backend.costMultiplier),
      maxConcurrency: normalizeMaxConcurrency(backend.maxConcurrency),
      supportedTools: normalizeSupportedTools(backend.supportedTools, backend.protocol),
      versionPrefix: versionPrefixOrDefault(backend.versionPrefix, backend.protocol),
    };
    if (normalized.apiKey) return normalized;
    const previous = config.all().backends.find((item) => item.id === normalized.id);
    return previous?.apiKey ? { ...normalized, apiKey: previous.apiKey } : normalized;
  }

  private save(backend: BackendConfig): void {
    const list = config.all().backends;
    const exists = list.some((item) => item.id === backend.id);
    if (!this.activeUserId) throw new Error('missing authenticated account');
    config.setOwnedBackends(
      this.activeUserId,
      exists ? list.map((item) => item.id === backend.id ? backend : item) : [...list, backend],
    );
  }

  async addBackend(backend: BackendConfig): Promise<HealthResult> {
    const value = this.normalizeBackend(backend);
    this.save(value);
    return this.ensureDaemon().addBackend(value);
  }

  async updateBackend(backend: BackendConfig): Promise<HealthResult> {
    const value = this.normalizeBackend(backend);
    this.save(value);
    return this.ensureDaemon().updateBackend(value);
  }

  removeBackend(id: string): void {
    if (!this.activeUserId) return;
    config.setOwnedBackends(this.activeUserId, config.all().backends.filter((item) => item.id !== id));
    this.producer?.removeBackend(id);
  }

  setBackendEnabled(id: string, enabled: boolean): void {
    const current = config.all().backends.find((item) => item.id === id);
    if (!current) return;
    this.save({ ...current, enabled });
    if (enabled) void this.ensureDaemon().updateBackend({ ...current, enabled });
    else this.producer?.disableBackend(id);
  }

  async setBackends(backends: BackendConfig[]): Promise<void> {
    const normalized = backends.map((backend) => this.normalizeBackend(backend));
    if (!this.activeUserId) throw new Error('missing authenticated account');
    config.setOwnedBackends(this.activeUserId, normalized);
    if (!normalized.length) return this.stopProducer();
    await this.ensureDaemon().setBackends(normalized);
  }

  status() {
    const cfg = config.all();
    return {
      transport: { ready: true, wsPort: this.link.port },
      signaling: { connected: this.connection.connected, peerId: this.producerId ?? undefined },
      producer: this.producerStatus,
      config: {
        signalUrl: cfg.serverUrl,
        autoShare: cfg.autoShare,
        backends: cfg.backends.map((backend) => ({ ...backend })),
      },
      connectedProducers: [],
    };
  }
}

declare global {
  var __mcCore: Core | undefined;
}

export function getCore(): Core {
  return (globalThis.__mcCore ??= new Core());
}
