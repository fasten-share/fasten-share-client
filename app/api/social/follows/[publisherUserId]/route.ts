import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ publisherUserId: string }>;
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  return proxyFollow(req, context, 'GET');
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  return proxyFollow(req, context, 'POST');
}

export async function DELETE(req: Request, context: RouteContext): Promise<Response> {
  return proxyFollow(req, context, 'DELETE');
}

async function proxyFollow(
  req: Request,
  context: RouteContext,
  method: 'GET' | 'POST' | 'DELETE',
): Promise<Response> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });

  const { publisherUserId } = await context.params;
  return proxyServer(`/api/v1/social/follows/${encodeURIComponent(publisherUserId)}`, {
    method,
    headers: bearerHeaders(token),
  });
}
