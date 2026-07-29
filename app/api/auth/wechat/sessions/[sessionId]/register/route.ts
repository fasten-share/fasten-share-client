import { proxyServer } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context { params: Promise<{ sessionId: string }> }

export async function POST(req: Request, ctx: Context): Promise<Response> {
  const { sessionId } = await ctx.params;
  return proxyServer(`/api/v1/auth/wechat/sessions/${encodeURIComponent(sessionId)}/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-wechat-login-token': req.headers.get('x-wechat-login-token') || '',
    },
    body: await req.text(),
  });
}
