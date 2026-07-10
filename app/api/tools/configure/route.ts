import { requireValidAccessToken } from '@/lib/server/auth';
import { configureTool, inspectToolConfig } from '@/lib/server/tool-config';
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
    if (body.action === 'inspect') return Response.json(inspectToolConfig(body.tool));
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
    const routeBase = `https://node.fastenshare.com/api/inference/${protocol}/${encodedModel}/${peerId}`;
    const baseUrl = toolEndpoint(routeBase, versionPrefix, body.tool, protocol);
    return Response.json(configureTool({ tool: body.tool, protocol, model, baseUrl }, apiKey));
  } catch (error) {
    return errorResponse(error);
  }
}
