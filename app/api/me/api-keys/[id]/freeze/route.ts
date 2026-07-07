import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function updateFreeze(
  req: Request,
  ctx: RouteContext,
  method: 'POST' | 'DELETE',
): Promise<Response> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });

  const { id } = await ctx.params;
  return proxyServer(`/api/me/api-keys/${encodeURIComponent(id)}/freeze`, {
    method,
    headers: bearerHeaders(token),
  });
}

export function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return updateFreeze(req, ctx, 'POST');
}

export function DELETE(req: Request, ctx: RouteContext): Promise<Response> {
  return updateFreeze(req, ctx, 'DELETE');
}
