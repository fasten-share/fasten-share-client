import { bearerHeaders, proxyServer, readBearerToken } from '@/lib/server/auth';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });
  return proxyServer(`/api/v1/withdrawals/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: bearerHeaders(token) });
}
