import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function DELETE(req: Request, ctx: RouteContext): Promise<Response> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });

  const { code } = await ctx.params;
  return proxyServer(`/api/me/invite-codes/${encodeURIComponent(code)}`, {
    method: 'DELETE',
    headers: bearerHeaders(token),
  });
}
