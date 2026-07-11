import { requireValidAccessToken } from '@/lib/server/auth';
import { SERVICE_URL } from '@/lib/server/service-url';
import {
  cleanupToolConfig,
  configureTool,
  inspectToolConfig,
  listToolConfigBackups,
  previewToolConfigRestore,
  restoreToolConfig,
} from '@/lib/server/tool-config';
import { isToolId } from '@/lib/tool-support';
import { normalizeVersionPrefix } from '@/lib/version-prefix';
import { toolEndpoint } from '@/lib/tool-endpoint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 400 },
  );
}

export async function POST(req: Request): Promise<Response> {
  const authError = await requireValidAccessToken(req);
  if (authError) return authError;

  let body: {
    action?: unknown;
    tool?: unknown;
    protocol?: unknown;
    model?: unknown;
    peerId?: unknown;
    versionPrefix?: unknown;
    apiKey?: unknown;
    backupId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!isToolId(body.tool) || body.tool === 'curl') {
    return Response.json({ error: 'invalid configurable tool' }, { status: 400 });
  }

  try {
    if (body.action === 'inspect' || body.action === 'preview-cleanup' || body.action === 'verify') {
      return Response.json(inspectToolConfig(body.tool));
    }
    if (body.action === 'cleanup') return Response.json(cleanupToolConfig(body.tool));
    if (body.action === 'list-backups') return Response.json(listToolConfigBackups(body.tool));
    if (body.action === 'preview-restore') return Response.json(previewToolConfigRestore(body.tool, body.backupId));
    if (body.action === 'restore') return Response.json(restoreToolConfig(body.tool, body.backupId));
    if (body.action !== 'configure') {
      return Response.json({ error: 'unknown action' }, { status: 400 });
    }
    const protocol = String(body.protocol ?? '');
    const model = String(body.model ?? '');
    const peerId = String(body.peerId ?? '');
    const versionPrefix = normalizeVersionPrefix(body.versionPrefix);
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!/^[a-z][a-z0-9-]*$/.test(protocol) || !model || !/^[\w-]+$/.test(peerId)) {
      return Response.json({ error: 'invalid target' }, { status: 400 });
    }
    if (!versionPrefix) {
      return Response.json({ error: 'invalid version prefix' }, { status: 400 });
    }
    if (!/^fs_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/.test(apiKey)) {
      return Response.json({ error: 'invalid consumer API key' }, { status: 400 });
    }
    const encodedModel = Buffer.from(model, 'utf8').toString('base64url');
    const routeBase = `${SERVICE_URL}/api/v1/inference/${protocol}/${encodedModel}/${peerId}`;
    const baseUrl = toolEndpoint(routeBase, versionPrefix, body.tool, protocol);
    return Response.json(configureTool({ tool: body.tool, protocol, model, baseUrl }, apiKey));
  } catch (error) {
    return errorResponse(error);
  }
}
