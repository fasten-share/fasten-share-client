import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });
  const url = new URL(req.url);
  return proxyServer(`/api/v1/withdrawals${url.search}`, { headers: bearerHeaders(token) });
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });
  return proxyServer('/api/v1/withdrawals', {
    method: 'POST',
    headers: { ...bearerHeaders(token), 'content-type': 'application/json', 'idempotency-key': req.headers.get('idempotency-key') ?? '' },
    body: await req.text(),
  });
}
