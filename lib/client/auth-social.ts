import { authJson } from './auth-request';
import { getAccessToken } from './auth-session';
import type {
  FollowStatusDto,
  FollowingPageDto,
  RatingStatusDto,
  UserSummaryDto,
} from './auth-types';

async function optionalAuthJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T | undefined> {
  const token = getAccessToken();
  if (!token) return undefined;
  try {
    return await authJson<T>(input, init, token);
  } catch (error) {
    if ((error as { status?: unknown }).status === 401) return undefined;
    throw error;
  }
}

export async function loadUserSummaries(userIds: string[]): Promise<Map<string, UserSummaryDto>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const data = await optionalAuthJson<{ users?: UserSummaryDto[] }>('/api/users/summaries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userIds: unique }),
  });
  return new Map((data?.users ?? []).map((user) => [user.userId, user]));
}

export async function loadFollowStatus(publisherUserId: string): Promise<FollowStatusDto | null> {
  return (
    (await optionalAuthJson<FollowStatusDto>(
      `/api/social/follows/${encodeURIComponent(publisherUserId)}`,
    )) ?? null
  );
}

export async function loadFollowingUsers(page = 1, pageSize = 20): Promise<FollowingPageDto> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const data = await optionalAuthJson<Partial<FollowingPageDto>>(`/api/social/follows?${params}`);
  return {
    users: data?.users ?? [],
    limit: data?.limit ?? 500,
    page: data?.page ?? page,
    pageSize: data?.pageSize ?? pageSize,
    total: data?.total ?? 0,
  };
}

export async function followUser(publisherUserId: string): Promise<FollowStatusDto> {
  return authJson<FollowStatusDto>(`/api/social/follows/${encodeURIComponent(publisherUserId)}`, {
    method: 'POST',
  });
}

export async function unfollowUser(publisherUserId: string): Promise<FollowStatusDto> {
  return authJson<FollowStatusDto>(`/api/social/follows/${encodeURIComponent(publisherUserId)}`, {
    method: 'DELETE',
  });
}

export async function loadRatingStatuses(
  publisherUserIds: string[],
): Promise<Map<string, RatingStatusDto>> {
  const unique = [...new Set(publisherUserIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const data = await optionalAuthJson<{ ratings?: RatingStatusDto[] }>(
    '/api/social/ratings/statuses',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publisherUserIds: unique }),
    },
  );
  return new Map((data?.ratings ?? []).map((rating) => [rating.publisherUserId, rating]));
}

export async function rateUser(
  publisherUserId: string,
  rating: number,
): Promise<RatingStatusDto> {
  return authJson<RatingStatusDto>(`/api/social/ratings/${encodeURIComponent(publisherUserId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rating }),
  });
}
