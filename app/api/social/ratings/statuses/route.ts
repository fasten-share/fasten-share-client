import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });

  return proxyServer('/api/v1/social/ratings/statuses', {
    method: 'POST',
    headers: {
      ...bearerHeaders(token),
      'content-type': req.headers.get('content-type') || 'application/json',
    },
    body: await req.text(),
  });
}
