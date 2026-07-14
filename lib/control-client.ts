/** Browser-side client for the /api/control endpoint (UI control plane). */

import { authHeaders } from '@/lib/client/auth';
import type { ToolId } from '@/lib/tool-support';
import type { EncryptedApiKey } from '@/lib/api-key-crypto-types';
import { ENCRYPTION_SESSION_EXPIRED } from '@/lib/api-key-crypto-types';
import { decryptApiKeyFromNode, encryptApiKeyForNode } from '@/lib/client/api-key-crypto';
import { clearAuthentication } from '@/lib/client/auth-session';

export interface BackendView {
  id: string;
  baseUrl: string;
  protocol: string;
  models: string[];
  costMultiplier?: number;
  maxConcurrency?: number;
  apiKey: string; // decrypted in browser memory; '' when no key is stored
  apiVersion?: string; // azure-openai only
  supportedTools?: ToolId[];
  versionPrefix?: string;
  enabled?: boolean;
}

export interface BackendHealth {
  id: string;
  protocol: string;
  models: string[];
  costMultiplier?: number;
  enabled: boolean;
  advertised: boolean;
  checking: boolean;
  lastHealth?: { ok: boolean; reason?: string; at: number };
}

export interface Status {
  configRevision: number;
  transport: { ready: boolean; wsPort: number };
  signaling: { connected: boolean; peerId?: string };
  producer: { running: boolean; registered: boolean; backends: BackendHealth[] };
  config: { signalUrl: string; autoShare: boolean; backends: BackendView[] };
  connectedProducers: { protocol: string; peerId: string }[];
}

export async function getStatus(): Promise<Status> {
  const r = await fetch('/api/control', { cache: 'no-store', headers: authHeaders() });
  if (!r.ok) throw await toControlError(r);
  return decodeStatus(await r.json());
}

/** Browser-side backend input. The control client encrypts apiKey before transport. */
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
  | { action: 'setAutoShare'; autoShare: boolean }
  | { action: 'addBackend'; backend: BackendInput }
  | { action: 'updateBackend'; backend: BackendInput }
  | { action: 'removeBackend'; id: string }
  | { action: 'setBackendEnabled'; id: string; enabled: boolean }
  | { action: 'setBackends'; backends: BackendInput[]; configRevision: number }
  | { action: 'stopProducer' }
  | { action: 'startProducer' };

export async function control(body: Action): Promise<Status> {
  const encryptedBody = await encryptAction(body);
  const r = await fetch('/api/control', {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(encryptedBody),
  });
  if (!r.ok) throw await toControlError(r);
  return decodeStatus(await r.json());
}

type WireBackend = Omit<BackendInput, 'apiKey'> & { encryptedApiKey?: EncryptedApiKey };

async function encryptBackend(backend: BackendInput): Promise<WireBackend> {
  const { apiKey, ...rest } = backend;
  return {
    ...rest,
    encryptedApiKey: apiKey && backend.id ? await encryptApiKeyForNode(apiKey, backend.id) : undefined,
  };
}

async function encryptAction(body: Action): Promise<Record<string, unknown>> {
  if (body.action === 'addBackend' || body.action === 'updateBackend') {
    return { ...body, backend: await encryptBackend(body.backend) };
  }
  if (body.action === 'setBackends') {
    return { ...body, backends: await Promise.all(body.backends.map(encryptBackend)) };
  }
  return body;
}

async function decodeStatus(value: Omit<Status, 'config'> & {
  config: Omit<Status['config'], 'backends'> & {
    backends: Array<Omit<BackendView, 'apiKey'> & { encryptedApiKey?: EncryptedApiKey }>;
  };
}): Promise<Status> {
  try {
    return {
      ...value,
      config: {
        ...value.config,
        backends: await Promise.all(value.config.backends.map(async ({ encryptedApiKey, ...backend }) => ({
          ...backend,
          apiKey: encryptedApiKey ? await decryptApiKeyFromNode(encryptedApiKey, backend.id) : '',
        }))),
      },
    };
  } catch {
    expireEncryptionSession();
    throw Object.assign(new Error(ENCRYPTION_SESSION_EXPIRED), { status: 401 });
  }
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
  const data = (await r.json()) as {
    candidates?: CandidateResult[];
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

type CandidateResult = {
  peerId: string;
  models: string[];
  protocol: string;
  rttToServer: number;
  onlineMs: number;
  userId: string;
  costMultipliers?: Record<string, number>;
  supportedTools?: Record<string, ToolId[]>;
  versionPrefixes?: Record<string, string>;
};

async function toControlError(res: Response): Promise<Error & { status: number }> {
  let message = `Request failed (${res.status})`;
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown; code?: unknown };
    if (data.code === ENCRYPTION_SESSION_EXPIRED || data.code === 'INVALID_ENCRYPTED_API_KEY') {
      expireEncryptionSession();
    }
    if (typeof data.message === 'string') message = data.message;
    else if (typeof data.error === 'string') message = data.error;
  } catch {
    // Keep the status fallback if the response is not JSON.
  }
  return Object.assign(new Error(message), { status: res.status });
}

function expireEncryptionSession(): void {
  clearAuthentication();
  if (typeof window !== 'undefined') window.location.assign('/login');
}

/** A local, non-crypto id (crypto.randomUUID needs a secure context, which a
 *  LAN-IP origin like http://192.168.x.x is not). */
export function newBackendId(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
