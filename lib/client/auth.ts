

export interface InviteCodeDto {
  id: string;
  code: string;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface ReferralDto {
  id: string;
  inviteeId: string;
  inviteeDisplayName: string | null;
  inviteeAvatarUrl: string | null;
  inviteCode: string;
  status: 'active' | 'expired' | 'revoked';
  totalPaid: string;
  windowStart: string;
  windowEnd: string;
  createdAt: string;
}

export interface ReferralPayoutDto {
  id: string;
  referralId: string;
  inviterId: string;
  kind: 'producer_cut' | 'recharge_cut';
  amount: string;
  sourceRef: string;
  state: 'escrow' | 'released' | 'clawed_back';
  releasedAt: string | null;
  createdAt: string;
}

export interface ReferralPayoutPageDto {
  payouts: ReferralPayoutDto[];
  limit: number;
  offset: number;
  total: number;
}

export interface UserSummaryDto {
  userId: string;
  username: string | null;
  followerCount: number;
  callCount: number;
}

export interface FollowStatusDto {
  publisherUserId: string;
  following: boolean;
  followerCount: number;
}

export interface FollowedUserDto extends UserSummaryDto {
  followedAt: string;
}

export interface FollowingPageDto {
  users: FollowedUserDto[];
  limit: number;
  page: number;
  pageSize: number;
  total: number;
}

export interface RatingStatusDto {
  publisherUserId: string;
  rating: number;
  rated: boolean;
  myRating: number | null;
}

export interface UserDto {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  tier: string;
  consumerBalance: string;
  consumerPendingDelta: string;
  consumerAvailable: string;
  producerBalance: string;
  producerPendingDelta: string;
  producerAvailable: string;
  escrow: string;
  stake: string;
  reputation: number;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}

export interface AuthError {
  message: string;
  status: number;
  blockedUntil?: string;
}

export interface ConsumerApiKeyDto {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  frozen: boolean;
  freezeReason: 'inactive' | 'manual' | null;
}

export interface RechargeOrder {
  outTradeNo: string;
  amountYuan: number;
  amountCents: number;
  credits: string;
  status: 'pending' | 'paid' | 'closed' | 'failed';
  codeUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
}

export interface SystemMessageDto {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

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

export async function loadMessages(): Promise<SystemMessageDto[]> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/messages', {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as { messages?: SystemMessageDto[] };
  return data.messages ?? [];
}

export async function loadConsumerApiKeys(): Promise<ConsumerApiKeyDto[]> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/me/api-keys', {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as { apiKeys?: ConsumerApiKeyDto[] };
  return data.apiKeys ?? [];
}

export async function createConsumerApiKey(name: string): Promise<ConsumerApiKeyDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/me/api-keys', {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as ConsumerApiKeyDto;
}

export async function deleteConsumerApiKey(id: string): Promise<ConsumerApiKeyDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/me/api-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as ConsumerApiKeyDto;
}

export async function freezeConsumerApiKey(id: string): Promise<ConsumerApiKeyDto> {
  return setConsumerApiKeyFrozen(id, true);
}

export async function unfreezeConsumerApiKey(id: string): Promise<ConsumerApiKeyDto> {
  return setConsumerApiKeyFrozen(id, false);
}

async function setConsumerApiKeyFrozen(
  id: string,
  frozen: boolean,
): Promise<ConsumerApiKeyDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/me/api-keys/${encodeURIComponent(id)}/freeze`, {
    method: frozen ? 'POST' : 'DELETE',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as ConsumerApiKeyDto;
}


export async function loadUserSummaries(userIds: string[]): Promise<Map<string, UserSummaryDto>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const token = getAccessToken();
  if (!token) return new Map();

  const res = await fetch('/api/users/summaries', {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ userIds: unique }),
  });
  if (res.status === 401) {
    clearAccessToken();
    return new Map();
  }
  if (!res.ok) throw await toAuthError(res);

  const data = (await res.json()) as { users?: UserSummaryDto[] };
  return new Map((data.users ?? []).map((user) => [user.userId, user]));
}

export async function loadFollowStatus(publisherUserId: string): Promise<FollowStatusDto | null> {
  const token = getAccessToken();
  if (!token) return null;

  const res = await fetch(`/api/social/follows/${encodeURIComponent(publisherUserId)}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearAccessToken();
    return null;
  }
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as FollowStatusDto;
}

export async function loadFollowingUsers(page = 1, pageSize = 20): Promise<FollowingPageDto> {
  const token = getAccessToken();
  if (!token) return { users: [], limit: 500, page, pageSize, total: 0 };

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const res = await fetch(`/api/social/follows?${params}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearAccessToken();
    return { users: [], limit: 500, page, pageSize, total: 0 };
  }
  if (!res.ok) throw await toAuthError(res);

  const data = (await res.json()) as Partial<FollowingPageDto>;
  return {
    users: data.users ?? [],
    limit: data.limit ?? 500,
    page: data.page ?? page,
    pageSize: data.pageSize ?? pageSize,
    total: data.total ?? 0,
  };
}

export async function followUser(publisherUserId: string): Promise<FollowStatusDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/social/follows/${encodeURIComponent(publisherUserId)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as FollowStatusDto;
}

export async function unfollowUser(publisherUserId: string): Promise<FollowStatusDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/social/follows/${encodeURIComponent(publisherUserId)}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as FollowStatusDto;
}

export async function loadRatingStatuses(
  publisherUserIds: string[],
): Promise<Map<string, RatingStatusDto>> {
  const unique = [...new Set(publisherUserIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const token = getAccessToken();
  if (!token) return new Map();

  const res = await fetch('/api/social/ratings/statuses', {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ publisherUserIds: unique }),
  });
  if (res.status === 401) {
    clearAccessToken();
    return new Map();
  }
  if (!res.ok) throw await toAuthError(res);

  const data = (await res.json()) as { ratings?: RatingStatusDto[] };
  return new Map((data.ratings ?? []).map((rating) => [rating.publisherUserId, rating]));
}

export async function rateUser(
  publisherUserId: string,
  rating: number,
): Promise<RatingStatusDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/social/ratings/${encodeURIComponent(publisherUserId)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ rating }),
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as RatingStatusDto;
}

export async function createRechargeOrder(amountYuan: number): Promise<RechargeOrder> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/credits/recharges', {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ amountYuan }),
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as RechargeOrder;
}

export async function getRechargeOrder(outTradeNo: string): Promise<RechargeOrder> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/credits/recharges/${encodeURIComponent(outTradeNo)}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as RechargeOrder;
}

export async function syncRechargeOrder(outTradeNo: string): Promise<RechargeOrder> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/credits/recharges/${encodeURIComponent(outTradeNo)}/sync`, {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as RechargeOrder;
}


export async function createInviteCode(body: { expiresAt?: string | null } = {}): Promise<InviteCodeDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/me/invite-codes', {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as InviteCodeDto;
}

export async function loadInviteCodes(): Promise<InviteCodeDto[]> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/me/invite-codes', {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as { inviteCodes?: InviteCodeDto[] };
  return data.inviteCodes ?? [];
}

export async function deleteInviteCode(code: string): Promise<InviteCodeDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/me/invite-codes/${encodeURIComponent(code)}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as InviteCodeDto;
}

export async function loadReferrals(): Promise<ReferralDto[]> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/me/referrals', {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as { referrals?: ReferralDto[] };
  return data.referrals ?? [];
}

export async function loadReferralPayouts(limit = 30, offset = 0): Promise<ReferralPayoutPageDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const res = await fetch(`/api/me/referrals/payouts?${params}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as ReferralPayoutPageDto;
}

export async function submitAuth(
  action: 'login' | 'register',
  body: {
    email: string;
    password: string;
    agreementAccepted: true;
    displayName?: string;
    inviteCode?: string;
  },
): Promise<AuthResponse> {
  const res = await fetch(`/api/auth/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as AuthResponse;
  setAccessToken(data.accessToken);
  return data;
}

export async function logout(): Promise<void> {
  const token = getAccessToken();
  clearAccessToken();
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw await toAuthError(res);
}

async function toAuthError(res: Response): Promise<AuthError> {
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
