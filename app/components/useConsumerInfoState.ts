'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { followUser, loadFollowingUsers, loadRatingStatuses, loadUserSummaries, rateUser, unfollowUser, type ConsumerApiKeyDto, type FollowedUserDto, type RatingStatusDto } from '@/lib/client/auth';
import type { Status } from '@/lib/control-client';
import type { DiscoverFn } from '@/lib/client/status-link';
import { PAGE_SIZE, type ConsumerRow as Row, type SearchScope } from './consumer-utils';
import { useConsumerToolConfig } from './useConsumerToolConfig';
import type { useI18n } from '@/lib/i18n/context';
import { buildConsumerRows } from './consumer-row-builder';

type Translate = ReturnType<typeof useI18n>['t'];

export function useConsumerInfoState({ status, discover, currentUserId, apiKeys, selectedApiKeyId, t }: {
  status: Status; discover: DiscoverFn; currentUserId: string; apiKeys: ConsumerApiKeyDto[];
  selectedApiKeyId: string; t: Translate;
}) {
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [keyword, setKeyword] = useState('');
  const [protocol, setProtocol] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const selectedApiKey =
    apiKeys.find((apiKey) => apiKey.id === selectedApiKeyId && !apiKey.frozen)
    ?? apiKeys.find((apiKey) => !apiKey.frozen)
    ?? null;
  const toolConfig = useConsumerToolConfig(selectedApiKey, t);
  const { curlTarget, setCurlTarget, pendingInspection, closeToolConfigPreview } = toolConfig;
  const [followingUserIds, setFollowingUserIds] = useState<Set<string>>(new Set());
  const [followedUsers, setFollowedUsers] = useState<FollowedUserDto[]>([]);
  const [followedRatings, setFollowedRatings] = useState<Map<string, number>>(new Map());
  const [selectedFollowingUserIds, setSelectedFollowingUserIds] = useState<string[]>([]);
  const [followingPage, setFollowingPage] = useState(1);
  const [followingTotal, setFollowingTotal] = useState(0);
  const [followError, setFollowError] = useState('');
  const [ratingDrafts, setRatingDrafts] = useState<Record<string, number>>({});
  const [ratingUserIds, setRatingUserIds] = useState<Set<string>>(new Set());
  const [ratingError, setRatingError] = useState('');
  const searchRequest = useRef(0);

  const connected = status.signaling.connected;
  const searchPageCount = Math.max(1, Math.ceil(searchTotal / PAGE_SIZE));
  const followingPageCount = Math.max(1, Math.ceil(followingTotal / PAGE_SIZE));

  const runSearch = useCallback(async (scope: SearchScope, page = 1) => {
    const requestId = ++searchRequest.current;
    const kw = keyword.trim();
    const proto = protocol.trim();
    setSearching(true);
    // This lookup is only for follow badges in result rows; the visible picker
    // remains paged independently below.
    const currentFollowing = await loadFollowingUsers(1, 500)
      .catch(() => ({ users: [], limit: 500, page: 1, pageSize: 500, total: 0 }));
    const currentFollowedUsers = currentFollowing.users;
    const publisherUserIds =
      scope === 'following'
        ? selectedFollowingUserIds
        : undefined;
    const result = await discover(
      scope === 'following' ? '' : kw,
      scope === 'following' ? '' : proto,
      publisherUserIds,
      page,
      PAGE_SIZE,
    ).catch(() => ({ candidates: [], page, pageSize: PAGE_SIZE, total: 0 }));
    const list = result.candidates;
    const userIds = [...new Set(list.map((c) => c.userId).filter(Boolean))];
    const [userSummaries, ratingStatuses] = await Promise.all([
      loadUserSummaries(userIds).catch(() => new Map()),
      loadRatingStatuses(userIds).catch(() => new Map<string, RatingStatusDto>()),
    ]);
    const out = buildConsumerRows(list, scope, kw, userSummaries, ratingStatuses, currentFollowedUsers);
    if (requestId !== searchRequest.current) return;
    setSearchPage(result.page);
    setSearchTotal(result.total);
    setRows(out);
    setExpanded(new Set());
    setRatingDrafts((current) => {
      const next = { ...current };
      ratingStatuses.forEach((status) => {
        if (status.myRating !== null) next[status.publisherUserId] = status.myRating;
      });
      return next;
    });
    setFollowedRatings((current) => {
      const next = new Map(current);
      ratingStatuses.forEach((status) => next.set(status.publisherUserId, status.rating));
      return next;
    });
    setSearching(false);
    setSearched(true);
  }, [keyword, protocol, discover, selectedFollowingUserIds]);

  const openFollowingPicker = useCallback(async (page = 1) => {
    ++searchRequest.current;
    setSearching(true);
    const result = await loadFollowingUsers(page, PAGE_SIZE)
      .catch(() => ({ users: [], limit: 500, page, pageSize: PAGE_SIZE, total: 0 }));
    const users = result.users;
    const ratings = await loadRatingStatuses(users.map((user) => user.userId))
      .catch(() => new Map<string, RatingStatusDto>());
    setFollowedUsers(users);
    setFollowingPage(result.page);
    setFollowingTotal(result.total);
    const ratingByUserId = new Map<string, number>();
    ratings.forEach((status, userId) => ratingByUserId.set(userId, status.rating));
    setFollowedRatings(ratingByUserId);
    setRows([]);
    setExpanded(new Set());
    setSearched(false);
    setSearching(false);
  }, []);

  // Auto-run an (empty) search once signaling is up, to list what's available.
  const autoRan = useRef(false);
  useEffect(() => {
    if (connected && !autoRan.current) {
      autoRan.current = true;
      void runSearch('all');
    }
  }, [connected, runSearch]);

  function onEnter(e: React.KeyboardEvent) {
    if (e.key === 'Enter') void runSearch(searchScope);
  }

  function toggleExpanded(key: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onToggleKey(e: React.KeyboardEvent, key: string) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggleExpanded(key);
  }

  async function onToggleFollow(publisherUserId: string, following: boolean) {
    if (publisherUserId === currentUserId || followingUserIds.has(publisherUserId)) return;

    setFollowError('');
    setFollowingUserIds((cur) => new Set(cur).add(publisherUserId));
    try {
      const status = following ? await unfollowUser(publisherUserId) : await followUser(publisherUserId);
      if (!status.following) {
        setFollowedUsers((cur) => cur.filter((user) => user.userId !== status.publisherUserId));
        setFollowingTotal((total) => Math.max(0, total - 1));
        setSelectedFollowingUserIds((cur) =>
          cur.filter((userId) => userId !== status.publisherUserId),
        );
      }
      setRows((cur) =>
        cur
          .map((row) => ({
            ...row,
            nodes: row.nodes
              .map((node) =>
                node.userId === status.publisherUserId
                  ? { ...node, following: status.following, followerCount: status.followerCount }
                  : node,
              )
              .filter(
                (node) =>
                  searchScope !== 'following' ||
                  status.following ||
                  node.userId !== status.publisherUserId,
              ),
          }))
          .filter((row) => row.nodes.length > 0),
      );
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? Number(error.status)
          : 0;
      setFollowError(
        status === 409 ? t('consumer.followLimitReached') : t('consumer.followUpdateFailed'),
      );
      // Keep the existing row state; users can retry without interrupting curl.
    } finally {
      setFollowingUserIds((cur) => {
        const next = new Set(cur);
        next.delete(publisherUserId);
        return next;
      });
    }
  }

  function applyRatingStatus(status: RatingStatusDto): void {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        nodes: row.nodes.map((node) =>
          node.userId === status.publisherUserId
            ? {
                ...node,
                rating: status.rating,
                rated: status.rated,
                myRating: status.myRating,
              }
            : node,
        ),
      })),
    );
    setFollowedRatings((current) => {
      const next = new Map(current);
      next.set(status.publisherUserId, status.rating);
      return next;
    });
    if (status.myRating !== null) {
      const myRating = status.myRating;
      setRatingDrafts((current) => ({
        ...current,
        [status.publisherUserId]: myRating,
      }));
    }
  }

  async function onRate(publisherUserId: string): Promise<void> {
    const rating = ratingDrafts[publisherUserId];
    if (!rating || ratingUserIds.has(publisherUserId)) return;

    setRatingError('');
    setRatingUserIds((current) => new Set(current).add(publisherUserId));
    try {
      applyRatingStatus(await rateUser(publisherUserId, rating));
    } catch (error) {
      const statusCode =
        typeof error === 'object' && error !== null && 'status' in error
          ? Number(error.status)
          : 0;
      if (statusCode === 409) {
        const current = await loadRatingStatuses([publisherUserId])
          .catch(() => new Map<string, RatingStatusDto>());
        const currentStatus = current.get(publisherUserId);
        if (currentStatus) applyRatingStatus(currentStatus);
        setRatingError(t('consumer.ratingAlreadySubmitted'));
      } else {
        setRatingError(t('consumer.ratingSubmitFailed'));
      }
    } finally {
      setRatingUserIds((current) => {
        const next = new Set(current);
        next.delete(publisherUserId);
        return next;
      });
    }
  }

  // Close either preview dialog on Escape.
  useEffect(() => {
    if (!curlTarget && !pendingInspection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setCurlTarget(null);
      closeToolConfigPreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeToolConfigPreview, curlTarget, pendingInspection, setCurlTarget]);

  return {
    searchScope, setSearchScope, keyword, setKeyword, protocol, setProtocol, rows,
    expanded, searching, searched, searchPage, searchTotal, selectedApiKey,
    followingUserIds, followedUsers, followedRatings, selectedFollowingUserIds,
    setSelectedFollowingUserIds, followingPage, followingTotal, followError,
    ratingDrafts, setRatingDrafts, ratingUserIds, ratingError, setRatingError, connected,
    searchPageCount, followingPageCount, runSearch, openFollowingPicker, onEnter,
    toggleExpanded, onToggleKey, onToggleFollow, onRate, toolConfig,
  };
}

export type ConsumerInfoState = ReturnType<typeof useConsumerInfoState>;
