import { proxyServer } from '@/lib/server/auth';
import { getCore } from '@/lib/server/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const upstream = await proxyServer('/api/v1/auth/devices/replace', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  if (!upstream.ok) return upstream;
  const data = await upstream.json() as Record<string, unknown>;
  if (typeof data.accessToken !== 'string') return Response.json({ error: 'Invalid replacement response.' }, { status: 502 });
  const encryptionKey = getCore().beginEncryptionSession(data.accessToken);
  return Response.json({ ...data, encryptionKey });
}
