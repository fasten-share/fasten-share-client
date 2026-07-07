import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';
import { getCore } from '@/lib/server/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AUTH_ACTIONS = new Set(['login', 'register']);

interface RouteContext {
  params: Promise<{ action: string }>;
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const { action } = await ctx.params;
  if (action !== 'me') return Response.json({ error: 'not found' }, { status: 404 });

  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });

  return proxyServer('/api/auth/me', {
    headers: bearerHeaders(token),
  });
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const { action } = await ctx.params;

  if (action === 'logout') {
    // JWT logout is client-side state removal until refresh-token rotation exists.
    return Response.json({ ok: true });
  }

  if (action === 'refresh') {
    const token = readBearerToken(req);
    if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });

    const upstream = await proxyServer('/api/auth/refresh', {
      method: 'POST',
      headers: bearerHeaders(token),
    });
    if (!upstream.ok) return upstream;

    const data = (await upstream.json()) as { accessToken?: unknown };
    const accessToken = typeof data.accessToken === 'string' ? data.accessToken : null;
    if (accessToken) getCore().setAccessToken(accessToken);
    return Response.json({ accessToken });
  }

  if (!AUTH_ACTIONS.has(action)) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  return proxyServer(`/api/auth/${action}`, {
    method: 'POST',
    headers: { 'content-type': req.headers.get('content-type') || 'application/json' },
    body: await req.text(),
  });
}
