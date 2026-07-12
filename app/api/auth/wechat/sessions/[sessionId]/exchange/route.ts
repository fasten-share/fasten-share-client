import { proxyServer } from '@/lib/server/auth';
import { getCore } from '@/lib/server/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: RouteContext<'/api/auth/wechat/sessions/[sessionId]/exchange'>): Promise<Response> {
  const { sessionId } = await ctx.params;
  const upstream = await proxyServer(`/api/v1/auth/wechat/sessions/${encodeURIComponent(sessionId)}/exchange`, {
    method: 'POST',
    headers: { 'x-wechat-login-token': req.headers.get('x-wechat-login-token') || '' },
  });
  if (!upstream.ok || upstream.status === 202) return upstream;
  const data = (await upstream.json()) as Record<string, unknown>;
  if (typeof data.accessToken !== 'string' || !data.accessToken) {
    return Response.json({ error: 'Login response did not contain an access token.' }, { status: 502 });
  }
  const encryptionKey = getCore().beginEncryptionSession(data.accessToken);
  return Response.json({ ...data, encryptionKey });
}
