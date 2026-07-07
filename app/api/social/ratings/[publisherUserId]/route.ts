import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ publisherUserId: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });

  const { publisherUserId } = await context.params;
  return proxyServer(`/api/social/ratings/${encodeURIComponent(publisherUserId)}`, {
    method: 'POST',
    headers: {
      ...bearerHeaders(token),
      'content-type': req.headers.get('content-type') || 'application/json',
    },
    body: await req.text(),
  });
}
