import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config';

const COOKIE = 'fs.localAccount';

function signature(userId: string): string {
  return createHmac('sha256', config.all().sessionSecret).update(userId).digest('base64url');
}

export function localSessionUserId(req: Request): string | null {
  const raw = req.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [userId, supplied] = decodeURIComponent(raw).split('.');
  if (!/^\d+$/.test(userId) || !supplied) return null;
  const expected = signature(userId);
  const left = Buffer.from(supplied); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right) ? userId : null;
}

export function requireLocalSession(req: Request): Response | null {
  return localSessionUserId(req) ? null : Response.json({ error: 'local session required' }, { status: 401 });
}

export function withLocalSession(response: Response, userId: string): Response {
  response.headers.append('set-cookie', `${COOKIE}=${encodeURIComponent(`${userId}.${signature(userId)}`)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
  return response;
}
