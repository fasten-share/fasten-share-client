import { proxyServer } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, ctx: RouteContext<'/api/auth/wechat/sessions/[sessionId]'>): Promise<Response> {
  const { sessionId } = await ctx.params;
  return proxyServer(`/api/v1/auth/wechat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { 'x-wechat-login-token': req.headers.get('x-wechat-login-token') || '' },
  });
}
