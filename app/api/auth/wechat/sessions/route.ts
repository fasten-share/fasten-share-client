import { proxyServer } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return proxyServer('/api/v1/auth/wechat/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
  });
}
