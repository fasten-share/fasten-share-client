/**
 * Node-side config store. Persists to a JSON file in a user-writable dir
 * (override with FS_DATA_DIR — the Electron shell points this at userData).
 * Env vars can seed config for headless (Docker) producers.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BackendConfig, NodeConfig } from './types';
import { normalizeCostMultiplier } from '../cost';
import { normalizeMaxConcurrency } from '../concurrency';
import { normalizeSupportedTools } from '../tool-support';
import { versionPrefixOrDefault } from '../version-prefix';
import { SERVICE_URL } from './service-url';

const DATA_DIR = process.env.FS_DATA_DIR || join(homedir(), '.fasten-share');
const CONFIG_PATH = join(DATA_DIR, 'config.json');
/** Ensure a backend has a stable id (older configs / env seeds may lack one). */
function withId(b: Omit<BackendConfig, 'id'> & { id?: string }): BackendConfig {
  return {
    ...b,
    id: b.id || randomUUID(),
    costMultiplier: normalizeCostMultiplier(b.costMultiplier),
    maxConcurrency: normalizeMaxConcurrency(b.maxConcurrency),
    supportedTools: normalizeSupportedTools(b.supportedTools, b.protocol),
    versionPrefix: versionPrefixOrDefault(b.versionPrefix, b.protocol),
  };
}

/** Seed producer backends from env (for headless deploys). */
function backendsFromEnv(): BackendConfig[] {
  // FS_BACKENDS: a JSON array of backends (multi-backend headless).
  const json = process.env.FS_BACKENDS;
  if (json) {
    try {
      const arr = JSON.parse(json);
      if (Array.isArray(arr)) return arr.map(withId);
    } catch {
      /* malformed — fall through to single-backend seed */
    }
  }
  // FS_BACKEND_*: a single backend (back-compat with single-backend deploys).
  const baseUrl = process.env.FS_BACKEND_BASEURL;
  if (!baseUrl) return [];
  return [
    withId({
      baseUrl,
      apiKey: process.env.FS_BACKEND_APIKEY || undefined,
      protocol: process.env.FS_BACKEND_PROTOCOL || 'openai',
      apiVersion: process.env.FS_BACKEND_APIVERSION || undefined, // azure-openai only
      versionPrefix: process.env.FS_BACKEND_VERSION_PREFIX,
      costMultiplier: normalizeCostMultiplier(process.env.FS_BACKEND_COST_MULTIPLIER),
      maxConcurrency: normalizeMaxConcurrency(process.env.FS_BACKEND_MAX_CONCURRENCY),
      models: (process.env.FS_BACKEND_MODELS || '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    }),
  ];
}

/** Legacy single-backend shape (pre §20) read for one-time migration. */
type LegacyConfig = Partial<NodeConfig> & {
  producerId?: string;
  backend?: (Omit<BackendConfig, 'id'> & { id?: string }) | null;
};

function read(): NodeConfig {
  let stored: LegacyConfig = {};
  try {
    stored = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    /* no file yet */
  }

  let backends: BackendConfig[] | undefined;
  if (Array.isArray(stored.backends)) {
    backends = stored.backends.map(withId);
  } else if (stored.backend) {
    // One-time migration: wrap the old single backend into the array form.
    backends = [withId(stored.backend)];
  }

  const cfg: NodeConfig = {
    // Service selection is no longer configurable; migrate persisted legacy URLs.
    serverUrl: SERVICE_URL,
    // IDs from older clients were locally generated and are deliberately discarded.
    producerIds: stored.producerIdsServerIssued ? (stored.producerIds ?? {}) : {},
    producerIdsServerIssued: true,
    backendOwnerUserId: stored.backendOwnerUserId ?? process.env.FS_BACKEND_OWNER_USER_ID,
    // Unowned persisted backends must never be inherited by the next account.
    backends:
      stored.backendOwnerUserId || process.env.FS_BACKEND_OWNER_USER_ID
        ? (backends ?? backendsFromEnv())
        : [],
  };

  // Persist the migrated/seeded shape so the legacy `backend` key is dropped and
  // ids are stable across restarts.
  if (!Array.isArray(stored.backends) || stored.serverUrl !== SERVICE_URL) write(cfg);
  return cfg;
}

function write(cfg: NodeConfig): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {
    /* read-only fs — keep in-memory only */
  }
}

let cache: NodeConfig | undefined;

export const config = {
  all(): NodeConfig {
    return (cache ??= read());
  },
  setServerUrl(): void {
    const c = this.all();
    c.serverUrl = SERVICE_URL;
    write(c);
  },
  setOwnedBackends(userId: string, backends: BackendConfig[]): void {
    const c = this.all();
    c.backendOwnerUserId = userId;
    c.backends = backends.map(withId);
    write(c);
  },
  serverProducerIdFor(userId: string): string | undefined {
    return this.all().producerIds[userId];
  },
  saveServerProducerId(userId: string, producerId: string): void {
    const c = this.all();
    c.producerIds[userId] = producerId;
    c.producerIdsServerIssued = true;
    write(c);
  },
};
