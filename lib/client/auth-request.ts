import type { AuthError } from './auth-types';
import { clearAccessToken, getAccessToken, toAuthError } from './auth-session';

export function requireAccessToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;
  }
  return token;
}

export async function authRequest(
  input: RequestInfo | URL,
  init: RequestInit = {},
  token = requireAccessToken(),
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    cache: init.cache ?? 'no-store',
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401) clearAccessToken();
  if (!response.ok) throw await toAuthError(response);
  return response;
}

export async function authJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  token = requireAccessToken(),
): Promise<T> {
  const response = await authRequest(input, init, token);
  return response.json() as Promise<T>;
}
