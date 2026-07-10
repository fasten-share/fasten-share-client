/** Browser-side client for the /api/control endpoint (UI control plane). */

import { authHeaders } from '@/lib/client/auth';
import type { ToolId } from '@/lib/tool-support';

export interface BackendView {
  id: string;
  baseUrl: string;
  protocol: string;
  models: string[];
  costMultiplier?: number;
  maxConcurrency?: number;
  apiKey: string; // masked ('***') when a key is stored; '' otherwise
  apiVersion?: string; // azure-openai only
  supportedTools?: ToolId[];
  versionPrefix?: string;
}

export interface BackendHealth {
  id: string;
  protocol: string;
  models: string[];
  costMultiplier?: number;
  enabled: boolean;
  advertised: boolean;
  lastHealth?: { ok: boolean; reason?: string; at: number };
}

export interface Status {
  transport: { ready: boolean; wsPort: number };
  signaling: { connected: boolean; peerId?: string };
  producer: { running: boolean; registered: boolean; backends: BackendHealth[] };
  config: { signalUrl: string; backends: BackendView[] };
  connectedProducers: { protocol: string; peerId: string }[];
  // Only present on an add/updateBackend response: the pre-share health check.
  check?: { ok: boolean; reason?: string };
}

export async function getStatus(): Promise<Status> {
  const r = await fetch('/api/control', { cache: 'no-store', headers: authHeaders() });
  if (!r.ok) throw await toControlError(r);
  return r.json();
}

/** A backend as sent to the control plane (apiKey omitted/blank => keep stored). */
export interface BackendInput {
  id?: string;
  baseUrl: string;
  protocol: string;
  models: string[];
  costMultiplier?: number;
  maxConcurrency?: number;
  apiKey?: string;
  apiVersion?: string;
  enabled?: boolean;
  supportedTools?: ToolId[];
  versionPrefix?: string;
}

type Action =
  | { action: 'setSignalUrl' }
  | { action: 'addBackend'; backend: BackendInput }
  | { action: 'updateBackend'; backend: BackendInput }
  | { action: 'removeBackend'; id: string }
  | { action: 'setBackendEnabled'; id: string; enabled: boolean }
  | { action: 'setBackends'; backends: BackendInput[] }
  | { action: 'stopProducer' }
  | { action: 'startProducer' };

export async function control(body: Action): Promise<Status> {
  const r = await fetch('/api/control', {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw await toControlError(r);
  return r.json();
}

/** Model search via Node (backend mode: the page has no signaling socket). */
export async function discoverModels(
  keyword: string,
  protocol: string,
  publisherUserIds?: string[],
  page = 1,
  pageSize = 20,
): Promise<{
  candidates: {
  peerId: string;
  models: string[];
  protocol: string;
  rttToServer: number;
  onlineMs: number;
  userId: string;
  costMultipliers?: Record<string, number>;
  supportedTools?: Record<string, ToolId[]>;
  versionPrefixes?: Record<string, string>;
  }[];
  page: number;
  pageSize: number;
  total: number;
}> {
  const r = await fetch('/api/control', {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'discover', keyword, protocol, publisherUserIds, page, pageSize }),
  });
  if (!r.ok) throw await toControlError(r);
  const data = await r.json();
  return {
    candidates: data.candidates ?? [],
    page: data.page ?? page,
    pageSize: data.pageSize ?? pageSize,
    total: data.total ?? 0,
  };
}

async function toControlError(res: Response): Promise<Error & { status: number }> {
  let message = `Request failed (${res.status})`;
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof data.message === 'string') message = data.message;
    else if (typeof data.error === 'string') message = data.error;
  } catch {
    // Keep the status fallback if the response is not JSON.
  }
  return Object.assign(new Error(message), { status: res.status });
}

/* ------------------------- localStorage backends ------------------------ */
// Backends are mirrored in localStorage so the UI prefills directly from the
// browser (the server still keeps its own copy and runs the producer).

export interface StoredBackend {
  id: string;
  baseUrl: string;
  protocol: string;
  models: string[];
  costMultiplier?: number;
  maxConcurrency?: number;
  apiKey?: string;
  apiVersion?: string; // azure-openai only
  enabled?: boolean; // false => stopped (kept locally, not auto-shared)
  supportedTools?: ToolId[];
  versionPrefix?: string;
}

const BACKENDS_KEY_PREFIX = 'fs.backends.';

/** A local, non-crypto id (crypto.randomUUID needs a secure context, which a
 *  LAN-IP origin like http://192.168.x.x is not). */
export function newBackendId(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function loadBackends(userId: string): StoredBackend[] {
  if (typeof window === 'undefined' || !/^\d+$/.test(userId)) return [];
  try {
    const raw = window.localStorage.getItem(`${BACKENDS_KEY_PREFIX}${userId}`);
    if (raw) return JSON.parse(raw) as StoredBackend[];
    return [];
  } catch {
    return [];
  }
}

export function saveBackends(userId: string, backends: StoredBackend[]): void {
  if (typeof window === 'undefined' || !/^\d+$/.test(userId)) return;
  try {
    window.localStorage.setItem(`${BACKENDS_KEY_PREFIX}${userId}`, JSON.stringify(backends));
  } catch {
    /* storage unavailable / quota — server copy still persists */
  }
}
