import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: Request, ctx: RouteContext): Promise<Response> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });

  const { id } = await ctx.params;
  return proxyServer(`/api/v1/me/api-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: bearerHeaders(token),
  });
}
