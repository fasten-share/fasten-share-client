import { getCore } from '@/lib/server/core';
import { requireLocalOrigin } from '@/lib/server/local-origin';
import { requireLocalSession } from '@/lib/server/local-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const originError = requireLocalOrigin(req); if (originError) return originError;
  const sessionError = requireLocalSession(req); if (sessionError) return sessionError;
  return Response.json({ accounts: getCore().accounts() });
}
