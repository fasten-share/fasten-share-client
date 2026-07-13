import type { AuthError, DeviceLimitResult, UserDto, WechatLoginResult, WechatLoginSession } from './auth-types';
import { clearApiKeyEncryptionKey, setApiKeyEncryptionKey } from './api-key-crypto';

const TOKEN_STORAGE_KEY = 'fs.accessToken';
const AUTH_NOTICE_STORAGE_KEY = 'fs.authNotice';
const ACCESS_TOKEN_RENEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_RETRY_MS = 5 * 60 * 1000;
const CLOCK_SKEW_RETRY_MS = 60 * 1000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAccessToken(token: string): void {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearAccessToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  clearApiKeyEncryptionKey();
}

export function clearAuthentication(): void {
  clearAccessToken();
}

export function setAuthNotice(message: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(AUTH_NOTICE_STORAGE_KEY, message);
}

export function consumeAuthNotice(): string {
  if (typeof window === 'undefined') return '';
  const message = window.sessionStorage.getItem(AUTH_NOTICE_STORAGE_KEY) ?? '';
  window.sessionStorage.removeItem(AUTH_NOTICE_STORAGE_KEY);
  return message;
}

export function authHeaders(): HeadersInit {
  const token = getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function accessTokenExpiresAt(token: string): number | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = JSON.parse(window.atob(padded)) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isSafeInteger(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

export async function renewAccessTokenIfNeeded(): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;

  const expiresAt = accessTokenExpiresAt(token);
  if (expiresAt === null || expiresAt - Date.now() > ACCESS_TOKEN_RENEW_WINDOW_MS) {
    return false;
  }

  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);

  const data = (await res.json()) as { accessToken?: unknown };
  if (typeof data.accessToken !== 'string' || !data.accessToken) return false;
  setAccessToken(data.accessToken);
  return true;
}

export function startAccessTokenRenewal(onUnauthorized: (error?: AuthError) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = (delayMs: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void check(), Math.min(Math.max(delayMs, 0), MAX_TIMEOUT_MS));
  };

  const scheduleForCurrentToken = (justRenewed: boolean) => {
    const token = getAccessToken();
    if (!token) return;
    const expiresAt = accessTokenExpiresAt(token);
    if (expiresAt === null) return;

    const remainingMs = expiresAt - Date.now();
    if (remainingMs > ACCESS_TOKEN_RENEW_WINDOW_MS) {
      schedule(remainingMs - ACCESS_TOKEN_RENEW_WINDOW_MS);
    } else if (justRenewed && remainingMs > 0) {
      schedule(Math.max(1_000, remainingMs / 2));
    } else {
      schedule(0);
    }
  };

  const check = async () => {
    if (stopped) return;
    const token = getAccessToken();
    const expiresAt = token ? accessTokenExpiresAt(token) : null;
    if (!token || expiresAt === null) return;

    try {
      const renewed = await renewAccessTokenIfNeeded();
      if (stopped) return;
      if (renewed) {
        scheduleForCurrentToken(true);
      } else if (expiresAt - Date.now() <= ACCESS_TOKEN_RENEW_WINDOW_MS) {
        schedule(CLOCK_SKEW_RETRY_MS);
      } else {
        scheduleForCurrentToken(false);
      }
    } catch (error) {
      if (stopped) return;
      if ((error as AuthError).status === 401 || (error as AuthError).status === 403) {
        onUnauthorized(error as AuthError);
        return;
      }
      const remainingMs = expiresAt - Date.now();
      schedule(
        remainingMs > 0
          ? Math.min(ACCESS_TOKEN_RETRY_MS, Math.max(1_000, remainingMs / 2))
          : ACCESS_TOKEN_RETRY_MS,
      );
    }
  };

  const reschedule = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    scheduleForCurrentToken(false);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== TOKEN_STORAGE_KEY && event.key !== null) return;
    if (!getAccessToken()) {
      onUnauthorized();
      return;
    }
    reschedule();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') reschedule();
  };

  window.addEventListener('storage', handleStorage);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  scheduleForCurrentToken(false);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener('storage', handleStorage);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

export async function loadMe(): Promise<UserDto | null> {
  const token = getAccessToken();
  if (!token) return null;

  const res = await fetch('/api/auth/me', {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearAccessToken();
    return null;
  }
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as { user: UserDto };
  return data.user;
}

export async function createWechatLoginSession(body: {
  agreementAccepted: true;
  inviteCode?: string;
  next?: string;
  lang: 'cn' | 'en';
}): Promise<WechatLoginSession> {
  const res = await fetch('/api/auth/wechat/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toAuthError(res);
  return res.json() as Promise<WechatLoginSession>;
}

export async function exchangeWechatLogin(sessionId: string, clientToken: string): Promise<WechatLoginResult | DeviceLimitResult | null> {
  const res = await fetch(`/api/auth/wechat/sessions/${encodeURIComponent(sessionId)}/exchange`, {
    method: 'POST',
    headers: { 'x-wechat-login-token': clientToken },
  });
  if (res.status === 202) return null;
  if (res.status === 409) {
    const limited = await res.json() as DeviceLimitResult;
    if (limited.code === 'DEVICE_LIMIT_EXCEEDED') return limited;
    throw Object.assign(new Error('Login session was already consumed.'), { status: 409 });
  }
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as WechatLoginResult;
  if (typeof data.encryptionKey !== 'string' || !data.encryptionKey) {
    throw Object.assign(new Error('Login response did not contain an encryption key.'), { status: 502 });
  }
  setAccessToken(data.accessToken);
  setApiKeyEncryptionKey(data.encryptionKey);
  return data;
}

export function forceDeviceLogout(): void {
  setAuthNotice('该设备因账号设备节点超过数量上限，已退出登录。');
  clearAuthentication();
}

export async function replaceDevice(replacementToken: string, targetDeviceId: string): Promise<WechatLoginResult> {
  const res = await fetch('/api/auth/devices/replace', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ replacementToken, targetDeviceId }),
  });
  if (!res.ok) throw await toAuthError(res);
  const data = await res.json() as WechatLoginResult;
  setAccessToken(data.accessToken);
  if (data.encryptionKey) setApiKeyEncryptionKey(data.encryptionKey);
  return data;
}

export async function cancelWechatLogin(sessionId: string, clientToken: string): Promise<void> {
  const res = await fetch(`/api/auth/wechat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { 'x-wechat-login-token': clientToken },
  });
  if (!res.ok && res.status !== 404) throw await toAuthError(res);
}

export async function logout(): Promise<void> {
  const token = getAccessToken();
  let res: Response;
  try {
    res = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  } finally {
    clearAuthentication();
  }
  if (!res.ok) throw await toAuthError(res);
}

export async function toAuthError(res: Response): Promise<AuthError> {
  let message = `Request failed (${res.status})`;
  let blockedUntil: string | undefined;
  try {
    const data = (await res.json()) as {
      message?: unknown;
      error?: unknown;
      blockedUntil?: unknown;
    };
    if (typeof data.message === 'string') message = data.message;
    else if (Array.isArray(data.message)) message = data.message.join(', ');
    else if (typeof data.error === 'string') message = data.error;
    if (typeof data.blockedUntil === 'string') {
      blockedUntil = data.blockedUntil;
      const localBlockedUntil = new Date(blockedUntil);
      if (res.status === 403 && !Number.isNaN(localBlockedUntil.getTime())) {
        message = `账号已被封禁，封禁结束时间：${localBlockedUntil.toLocaleString()}`;
      }
    }
  } catch {
    // Keep the status fallback if the response is not JSON.
  }
  return { message, status: res.status, blockedUntil };
}
