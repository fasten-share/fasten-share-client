import { proxyServer } from '@/lib/server/auth';
import { getCore } from '@/lib/server/core';
import { config } from '@/lib/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context { params: Promise<{ sessionId: string }> }

export async function POST(req: Request, ctx: Context): Promise<Response> {
  const { sessionId } = await ctx.params;
  const upstream = await proxyServer(`/api/v1/auth/wechat/sessions/${encodeURIComponent(sessionId)}/exchange`, {
    method: 'POST',
    headers: {
      'x-wechat-login-token': req.headers.get('x-wechat-login-token') || '',
      'x-device-id': config.all().deviceId,
      'x-device-name': encodeURIComponent(config.all().deviceName),
    },
  });
  if (upstream.status === 409) return upstream;
  if (!upstream.ok || upstream.status === 202) return upstream;
  const data = (await upstream.json()) as Record<string, unknown>;
  if (typeof data.accessToken !== 'string' || !data.accessToken) {
    return Response.json({ error: 'Login response did not contain an access token.' }, { status: 502 });
  }
  if (!data.user || typeof data.user !== 'object') return Response.json({ error: 'Login response did not contain a user.' }, { status: 502 });
  let encryptionKey: string;
  try {
    encryptionKey = getCore().beginEncryptionSession(data.accessToken, data.user as never);
  } catch (error) {
    if ((error as { code?: string }).code === 'ACCOUNT_LIMIT_EXCEEDED') {
      return Response.json({ error: 'ACCOUNT_LIMIT_EXCEEDED', code: 'ACCOUNT_LIMIT_EXCEEDED' }, { status: 409 });
    }
    throw error;
  }
  return Response.json({ ...data, encryptionKey });
}
