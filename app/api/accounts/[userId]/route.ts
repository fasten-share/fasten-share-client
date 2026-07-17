import { getCore } from '@/lib/server/core';
import { requireLocalOrigin } from '@/lib/server/local-origin';
import { requireLocalSession, withLocalSession } from '@/lib/server/local-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context { params: Promise<{ userId: string }> }

export async function DELETE(req: Request, ctx: Context): Promise<Response> {
  const originError = requireLocalOrigin(req); if (originError) return originError;
  const sessionError = requireLocalSession(req); if (sessionError) return sessionError;
  const { userId } = await ctx.params;
  if (!/^\d+$/.test(userId)) return Response.json({ error: 'invalid user id' }, { status: 400 });
  if (new URL(req.url).searchParams.get('profile') === 'true') getCore().deleteProfile(userId);
  else getCore().logout(userId);
  return Response.json({ ok: true });
}

export async function POST(req: Request, ctx: Context): Promise<Response> {
  const originError = requireLocalOrigin(req); if (originError) return originError;
  const sessionError = requireLocalSession(req); if (sessionError) return sessionError;
  const { userId } = await ctx.params;
  if (!/^\d+$/.test(userId)) return Response.json({ error: 'invalid user id' }, { status: 400 });
  const account = getCore().accountCredentials(userId);
  if (!account || account.state !== 'active' || !account.token) {
    return Response.json({ error: 'ACCOUNT_REAUTH_REQUIRED', code: 'ACCOUNT_REAUTH_REQUIRED' }, { status: 409 });
  }
  getCore().selectAccount(userId);
  return withLocalSession(Response.json({ accessToken: account.token, encryptionKey: account.encryptionKey, user: account.user }), userId);
}
