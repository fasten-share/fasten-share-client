import { SERVICE_URL } from './service-url';

export function readBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!/^bearer$/i.test(scheme) || !token) return null;
  return token;
}

export function bearerHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

export async function requireValidAccessToken(req: Request): Promise<Response | null> {
  const token = readBearerToken(req);
  if (!token) return Response.json({ error: 'Missing bearer token.' }, { status: 401 });
  return validateAccessToken(token);
}

async function validateAccessToken(token: string): Promise<Response | null> {
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(new URL('/api/v1/auth/me', SERVICE_URL), {
      headers: bearerHeaders(token),
      cache: 'no-store',
    });
  } catch (err) {
    return Response.json(
      { error: `fasten-share-server unreachable: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (upstream.ok) return null;
  return Response.json(
    { error: upstream.status === 401 ? 'Invalid or expired bearer token.' : 'Authentication check failed.' },
    { status: upstream.status },
  );
}

export async function proxyServer(path: string, init: RequestInit): Promise<Response> {
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(new URL(path, SERVICE_URL), {
      ...init,
      cache: 'no-store',
    });
  } catch (err) {
    return Response.json(
      { error: `fasten-share-server unreachable: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
    },
  });
}
