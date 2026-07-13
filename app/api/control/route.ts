/**
 * Control API for the UI: GET status, POST actions (config + producer control).
 * Reads/writes the server-side core singleton.
 */
import { getCore } from '@/lib/server/core';
import { readBearerToken, requireValidAccessToken } from '@/lib/server/auth';
import type { BackendConfig } from '@/lib/server/types';
import { normalizeVersionPrefix } from '@/lib/version-prefix';
import type { EncryptedApiKey } from '@/lib/api-key-crypto-types';
import { ENCRYPTION_SESSION_EXPIRED, INVALID_ENCRYPTED_API_KEY } from '@/lib/api-key-crypto-types';
import { decryptApiKey, encryptApiKey } from '@/lib/server/api-key-crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WireBackend = Omit<BackendConfig, 'apiKey'> & { encryptedApiKey?: EncryptedApiKey };

function encryptionSession(req: Request): { token: string; key: string } | Response {
  const token = readBearerToken(req);
  const key = getCore().encryptionKeyForToken(token);
  if (!token || !key) {
    return Response.json({ error: ENCRYPTION_SESSION_EXPIRED, code: ENCRYPTION_SESSION_EXPIRED }, { status: 401 });
  }
  return { token, key };
}

function decryptBackend(backend: WireBackend, key: string): BackendConfig | undefined {
  try {
    return {
      ...backend,
      apiKey: backend.encryptedApiKey
        ? decryptApiKey(backend.encryptedApiKey, key, backend.id, 'request')
        : undefined,
      encryptedApiKey: undefined,
    } as BackendConfig;
  } catch {
    return undefined;
  }
}

function securedStatus(key: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const status = getCore().status();
  return {
    ...status,
    ...extra,
    config: {
      ...status.config,
      backends: status.config.backends.map(({ apiKey, ...backend }) => ({
        ...backend,
        encryptedApiKey: apiKey ? encryptApiKey(apiKey, key, backend.id, 'response') : undefined,
      })),
    },
  };
}

function normalizeBackend(backend: BackendConfig): BackendConfig | undefined {
  const versionPrefix = normalizeVersionPrefix(backend.versionPrefix);
  if (!versionPrefix) return undefined;
  return { ...backend, versionPrefix };
}

function duplicateOffering(backends: BackendConfig[]): string | undefined {
  const seen = new Set<string>();
  for (const backend of backends) {
    if (backend.enabled === false) continue;
    const protocol = backend.protocol.trim();
    for (const rawModel of backend.models) {
      const model = rawModel.trim();
      const key = `${protocol}\0${model}`;
      if (seen.has(key)) return `${protocol}/${model}`;
      seen.add(key);
    }
  }
  return undefined;
}

export async function GET(req: Request): Promise<Response> {
  const authError = await requireValidAccessToken(req);
  if (authError) return authError;
  const session = encryptionSession(req);
  if (session instanceof Response) return session;
  const core = getCore();
  core.setAccessToken(session.token);
  return Response.json(securedStatus(session.key));
}

export async function POST(req: Request): Promise<Response> {
  const authError = await requireValidAccessToken(req);
  if (authError) return authError;
  const session = encryptionSession(req);
  if (session instanceof Response) return session;
  const core = getCore();
  core.setAccessToken(session.token);
  let body: {
    action?: string;
    url?: string;
    backend?: WireBackend;
    backends?: WireBackend[];
    id?: string;
    enabled?: boolean;
    autoShare?: boolean;
    keyword?: string;
    protocol?: string;
    publisherUserIds?: unknown[];
    page?: number;
    pageSize?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  switch (body.action) {
    case 'setSignalUrl':
      core.setSignalUrl();
      break;
    case 'setAutoShare':
      core.setAutoShare(body.autoShare === true);
      break;
    case 'addBackend': {
      if (!body.backend) return Response.json({ error: 'missing backend' }, { status: 400 });
      const decrypted = decryptBackend(body.backend, session.key);
      if (!decrypted) return Response.json({ error: INVALID_ENCRYPTED_API_KEY, code: INVALID_ENCRYPTED_API_KEY }, { status: 400 });
      const backend = normalizeBackend(decrypted);
      if (!backend) return Response.json({ error: 'invalid version prefix' }, { status: 400 });
      const duplicate = duplicateOffering([...core.status().config.backends, backend]);
      if (duplicate) return Response.json({ error: `duplicate protocol + model: ${duplicate}` }, { status: 400 });
      core.addBackend(backend);
      return Response.json(securedStatus(session.key));
    }
    case 'updateBackend': {
      if (!body.backend?.id) return Response.json({ error: 'missing backend id' }, { status: 400 });
      const decrypted = decryptBackend(body.backend, session.key);
      if (!decrypted) return Response.json({ error: INVALID_ENCRYPTED_API_KEY, code: INVALID_ENCRYPTED_API_KEY }, { status: 400 });
      const backend = normalizeBackend(decrypted);
      if (!backend) return Response.json({ error: 'invalid version prefix' }, { status: 400 });
      const existing = core.status().config.backends;
      const duplicate = duplicateOffering(existing.map((item) => item.id === backend.id ? backend : item));
      if (duplicate) return Response.json({ error: `duplicate protocol + model: ${duplicate}` }, { status: 400 });
      core.updateBackend(backend);
      return Response.json(securedStatus(session.key));
    }
    case 'removeBackend':
      core.removeBackend(String(body.id ?? ''));
      break;
    case 'setBackendEnabled':
      if (!body.id) return Response.json({ error: 'missing backend id' }, { status: 400 });
      core.setBackendEnabled(body.id, body.enabled === true);
      break;
    case 'discover': {
      // UI model search in backend mode (the page has no signaling socket of its own).
      const publisherUserIds = Array.isArray(body.publisherUserIds)
        ? [...new Set(
            body.publisherUserIds.filter(
              (id: unknown): id is string => typeof id === 'string' && /^\d+$/.test(id),
            ),
          )].slice(0, 500)
        : undefined;
      const list = await core.discoverModels(
        String(body.keyword ?? ''),
        String(body.protocol ?? ''),
        publisherUserIds,
        Number(body.page ?? 1),
        Number(body.pageSize ?? 20),
      );
      return Response.json(securedStatus(session.key, list));
    }
    case 'setBackends':
      {
        const decrypted = (body.backends ?? []).map((backend) => decryptBackend(backend, session.key));
        if (decrypted.some((backend) => !backend)) {
          return Response.json({ error: INVALID_ENCRYPTED_API_KEY, code: INVALID_ENCRYPTED_API_KEY }, { status: 400 });
        }
        const backends = (decrypted as BackendConfig[]).map(normalizeBackend);
        if (backends.some((backend) => !backend)) {
          return Response.json({ error: 'invalid version prefix' }, { status: 400 });
        }
        const duplicate = duplicateOffering(backends as BackendConfig[]);
        if (duplicate) return Response.json({ error: `duplicate protocol + model: ${duplicate}` }, { status: 400 });
        core.setBackends(backends as BackendConfig[]);
      }
      break;
    case 'startProducer':
      core.startProducer();
      break;
    case 'stopProducer':
      core.stopProducer();
      break;
    default:
      return Response.json({ error: 'unknown action' }, { status: 400 });
  }
  return Response.json(securedStatus(session.key));
}
