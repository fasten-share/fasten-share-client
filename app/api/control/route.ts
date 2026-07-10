/**
 * Control API for the UI: GET status, POST actions (config + producer control).
 * Reads/writes the server-side core singleton.
 */
import { getCore } from '@/lib/server/core';
import { readBearerToken, requireValidAccessToken } from '@/lib/server/auth';
import type { BackendConfig } from '@/lib/server/types';
import { normalizeVersionPrefix } from '@/lib/version-prefix';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeBackend(backend: BackendConfig): BackendConfig | undefined {
  const versionPrefix = normalizeVersionPrefix(backend.versionPrefix);
  if (!versionPrefix) return undefined;
  return { ...backend, versionPrefix };
}

export async function GET(req: Request): Promise<Response> {
  const authError = await requireValidAccessToken(req);
  if (authError) return authError;
  const core = getCore();
  core.setAccessToken(readBearerToken(req));
  return Response.json(core.status());
}

export async function POST(req: Request): Promise<Response> {
  const authError = await requireValidAccessToken(req);
  if (authError) return authError;
  const core = getCore();
  core.setAccessToken(readBearerToken(req));
  let body: {
    action?: string;
    url?: string;
    backend?: BackendConfig;
    backends?: BackendConfig[];
    id?: string;
    enabled?: boolean;
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
    case 'addBackend': {
      if (!body.backend) return Response.json({ error: 'missing backend' }, { status: 400 });
      const backend = normalizeBackend(body.backend);
      if (!backend) return Response.json({ error: 'invalid version prefix' }, { status: 400 });
      const check = await core.addBackend(backend);
      return Response.json({ ...core.status(), check });
    }
    case 'updateBackend': {
      if (!body.backend?.id) return Response.json({ error: 'missing backend id' }, { status: 400 });
      const backend = normalizeBackend(body.backend);
      if (!backend) return Response.json({ error: 'invalid version prefix' }, { status: 400 });
      const check = await core.updateBackend(backend);
      return Response.json({ ...core.status(), check });
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
      return Response.json({ ...core.status(), ...list });
    }
    case 'setBackends':
      {
        const backends = (body.backends ?? []).map(normalizeBackend);
        if (backends.some((backend) => !backend)) {
          return Response.json({ error: 'invalid version prefix' }, { status: 400 });
        }
        await core.setBackends(backends as BackendConfig[]);
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
  return Response.json(core.status());
}
