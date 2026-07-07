import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });

  return proxyServer('/api/messages?limit=50', {
    headers: bearerHeaders(token),
  });
}
