import { NextRequest, NextResponse } from 'next/server';

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  // A browser-stored JWT is attached by fetch, not top-level navigation.
  // Let the app shell load; client-side auth then calls /api/auth/me with Bearer.
  if (wantsHtml(req)) return NextResponse.next();

  if (hasBearerToken(req)) return NextResponse.next();

  return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
}

function hasBearerToken(req: NextRequest): boolean {
  const header = req.headers.get('authorization');
  if (!header) return false;
  const [scheme, token] = header.split(' ');
  return /^bearer$/i.test(scheme) && Boolean(token);
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/.test(pathname)
  );
}

function wantsHtml(req: NextRequest): boolean {
  const accept = req.headers.get('accept') ?? '';
  return accept.includes('text/html');
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
