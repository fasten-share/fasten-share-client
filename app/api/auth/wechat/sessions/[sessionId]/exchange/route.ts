import { proxyServer } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: RouteContext<'/api/auth/wechat/sessions/[sessionId]/exchange'>): Promise<Response> {
  const { sessionId } = await ctx.params;
  return proxyServer(`/api/v1/auth/wechat/sessions/${encodeURIComponent(sessionId)}/exchange`, {
    method: 'POST',
    headers: { 'x-wechat-login-token': req.headers.get('x-wechat-login-token') || '' },
  });
}
