import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ outTradeNo: string }>;
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });

  const { outTradeNo } = await ctx.params;
  return proxyServer(`/api/v1/credits/recharges/${encodeURIComponent(outTradeNo)}`, {
    headers: bearerHeaders(token),
  });
}
