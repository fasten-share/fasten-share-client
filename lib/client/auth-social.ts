import { clearAccessToken, getAccessToken, toAuthError } from './auth-session';
import type {
  AuthError,
  FollowStatusDto,
  FollowingPageDto,
  RatingStatusDto,
  UserSummaryDto,
} from './auth-types';

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
