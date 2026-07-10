'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Status } from '@/lib/control-client';
import {
  followUser,
  loadFollowingUsers,
  loadRatingStatuses,
  loadUserSummaries,
  rateUser,
  unfollowUser,
} from '@/lib/client/auth';
import type {
  ConsumerApiKeyDto,
  FollowedUserDto,
  RatingStatusDto,
} from '@/lib/client/auth';
import type { Candidate } from '@/lib/server/types';
import type { DiscoverFn } from '@/lib/client/status-link';
import { useI18n } from '@/lib/i18n/context';
import styles from './ConsumerInfo.module.css';
import { normalizeSupportedTools, type ToolId } from '@/lib/tool-support';
import { applyToolConfig, inspectTool, type ToolConfigInspection } from '@/lib/tool-config-client';
import { versionPrefixOrDefault } from '@/lib/version-prefix';
import { toolEndpoint } from '@/lib/tool-endpoint';

interface Row {
  model: string;
  protocol: string;
  nodes: NodeRow[];
}

interface NodeRow {
  peerId: string;
  rttToServer: number;
  onlineMs: number;
  userId: string;
  username: string | null;
  followerCount: number;
  callCount: number;
  costMultiplier: number;
  following: boolean;
  rating: number;
  rated: boolean;
  myRating: number | null;
  supportedTools: ToolId[];
  versionPrefix: string;
}

interface CurlTarget {
  model: string;
  protocol: string;
  peerId: string;
  versionPrefix: string;
}

type SearchScope = 'all' | 'following';

const PAGE_SIZE = 20;

/** base64url-encode a model id for the URL path segment (matches the consumer route). */
function b64url(s: string): string {
  const bin = String.fromCharCode(...new TextEncoder().encode(s));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const AZURE_API_VERSION = '2024-10-21';

/** Build a ready-to-run curl command using the producer-advertised version
 * prefix. The producer injects the real credential, so the example
 * never carries an upstream API key. */
function buildCurl(origin: string, target: CurlTarget, apiKey: string): string {
  const prefix = target.versionPrefix === '/' ? '' : target.versionPrefix;
  const base = `${origin}/${target.protocol}/${b64url(target.model)}/${target.peerId}${prefix}`;
  const json = (o: unknown) => JSON.stringify(o);
  const authHeader = `  -H 'Authorization: Bearer ${apiKey}' \\\n`;
  const ct = `  -H 'content-type: application/json' \\\n`;

  switch (target.protocol) {
    case 'anthropic':
      return (
        `curl ${base}/messages \\\n` +
        authHeader +
        ct +
        `  -H 'anthropic-version: 2023-06-01' \\\n` +
        `  -d '${json({ model: target.model, max_tokens: 1024, messages: [{ role: 'user', content: 'what is your model you are?' }] })}'`
      );

    case 'openai-response':
      return (
        `curl ${base}/responses \\\n` +
        authHeader +
        ct +
        `  -d '${json({ model: target.model, input: 'what is your model you are?' })}'`
      );

    case 'gemini':
      return (
        `curl ${base}/models/${target.model}:generateContent \\\n` +
        authHeader +
        ct +
        `  -d '${json({ contents: [{ parts: [{ text: 'what is your model you are?' }] }] })}'`
      );

    case 'azure-openai':
      return (
        `curl '${base}/deployments/${target.model}/chat/completions?api-version=${AZURE_API_VERSION}' \\\n` +
        authHeader +
        ct +
        `  -d '${json({ messages: [{ role: 'user', content: 'what is your model you are?' }] })}'`
      );

    // openai, ollama, and any OpenAI-compatible fallback
    default:
      return (
        `curl ${base}/chat/completions \\\n` +
        authHeader +
        ct +
        `  -d '${json({ model: target.model, messages: [{ role: 'user', content: 'what is your model you are?' }] })}'`
      );
  }
}

function buildToolEndpoint(
  origin: string,
  target: CurlTarget,
  tool: Exclude<ToolId, 'curl'>,
): string {
  const routeBase = `${origin}/${target.protocol}/${b64url(target.model)}/${target.peerId}`;
  return toolEndpoint(routeBase, target.versionPrefix, tool, target.protocol);
}

function rowKey(row: Pick<Row, 'protocol' | 'model'>): string {
  return `${row.protocol} ${row.model}`;
}

function formatMultiplier(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, '')}x`;
}

function RatingStars({
  value,
  disabled,
  label,
  onChange,
}: {
  value: number;
  disabled: boolean;
  label: (rating: number) => string;
  onChange: (rating: number) => void;
}) {
  return (
    <div className={styles.ratingStars}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = value >= star ? 100 : value >= star - 0.5 ? 50 : 0;
        return (
          <span className={styles.ratingStar} key={star}>
            <span className={styles.ratingStarBase} aria-hidden="true">★</span>
            <span
              className={styles.ratingStarFill}
              style={{ width: `${fill}%` }}
              aria-hidden="true"
            >
              ★
            </span>
            <button
              type="button"
              className={styles.ratingStarLeft}
              disabled={disabled}
              aria-label={label(star - 0.5)}
              onClick={() => onChange(star - 0.5)}
            />
            <button
              type="button"
              className={styles.ratingStarRight}
              disabled={disabled}
              aria-label={label(star)}
              onClick={() => onChange(star)}
            />
          </span>
        );
      })}
    </div>
  );
}

export function ConsumerInfo({
  status,
  origin,
  discover,
  currentUserId,
  apiKeys,
  selectedApiKeyId,
  onSelectApiKey,
  apiKeysLoading,
  apiKeysError,
}: {
  status: Status;
  origin: string;
  discover: DiscoverFn;
  currentUserId: string;
  apiKeys: ConsumerApiKeyDto[];
  selectedApiKeyId: string;
  onSelectApiKey: (id: string) => void;
  apiKeysLoading: boolean;
  apiKeysError: string;
}) {
  const { t } = useI18n();
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [keyword, setKeyword] = useState('');
  const [protocol, setProtocol] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotal, setSearchTotal] = useState(0);
  const [copied, setCopied] = useState('');
  const [curlTarget, setCurlTarget] = useState<CurlTarget | null>(null);
  const [toolByTarget, setToolByTarget] = useState<Record<string, ToolId>>({});
  const [configuringTarget, setConfiguringTarget] = useState<CurlTarget | null>(null);
  const [configuringTool, setConfiguringTool] = useState<Exclude<ToolId, 'curl'> | null>(null);
  const [pendingInspection, setPendingInspection] = useState<ToolConfigInspection | null>(null);
  const [toolConfigMessage, setToolConfigMessage] = useState('');
  const [toolConfigError, setToolConfigError] = useState('');
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
  const selectedApiKey =
    apiKeys.find((apiKey) => apiKey.id === selectedApiKeyId && !apiKey.frozen)
    ?? apiKeys.find((apiKey) => !apiKey.frozen)
    ?? null;
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
    const list: Candidate[] = result.candidates;
    const userIds = [...new Set(list.map((c) => c.userId).filter(Boolean))];
    const [userSummaries, ratingStatuses] = await Promise.all([
      loadUserSummaries(userIds).catch(() => new Map()),
      loadRatingStatuses(userIds).catch(() => new Map<string, RatingStatusDto>()),
    ]);
    const followedByUserId = new Map(
      currentFollowedUsers.map((user) => [user.userId, user]),
    );
    // Group producers by (protocol, model), keeping the matching peer nodes inside
    // each row so users can choose the exact peerId to connect to.
    const kwLower = scope === 'all' ? kw.toLowerCase() : '';
    const byModel = new Map<string, Row>();
    for (const c of list) {
      for (const m of c.models) {
        if (kwLower && !m.toLowerCase().includes(kwLower)) continue;
        const key = `${c.protocol} ${m}`;
        const row = byModel.get(key) ?? { model: m, protocol: c.protocol, nodes: [] };
        if (!row.nodes.some((n) => n.peerId === c.peerId)) {
          row.nodes.push({
            peerId: c.peerId,
            rttToServer: c.rttToServer,
            onlineMs: c.onlineMs,
            userId: c.userId,
            username: userSummaries.get(c.userId)?.username ?? null,
            followerCount:
              followedByUserId.get(c.userId)?.followerCount ??
              userSummaries.get(c.userId)?.followerCount ??
              0,
            callCount: userSummaries.get(c.userId)?.callCount ?? 0,
            costMultiplier: c.costMultipliers?.[m] ?? 1,
            following: scope === 'following' || followedByUserId.has(c.userId),
            rating: ratingStatuses.get(c.userId)?.rating ?? 0,
            rated: ratingStatuses.get(c.userId)?.rated ?? false,
            myRating: ratingStatuses.get(c.userId)?.myRating ?? null,
            supportedTools: normalizeSupportedTools(c.supportedTools?.[m], c.protocol),
            versionPrefix: versionPrefixOrDefault(
              c.versionPrefixes?.[m],
              c.protocol,
            ),
          });
        }
        byModel.set(key, row);
      }
    }
    const out = [...byModel.values()];
    for (const row of out) {
      row.nodes.sort((a, b) => a.rttToServer - b.rttToServer || b.onlineMs - a.onlineMs);
    }
    out.sort((a, b) => a.protocol.localeCompare(b.protocol) || a.model.localeCompare(b.model));
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

  function copy(text: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(''), 1200);
  }

  function targetKey(target: CurlTarget): string {
    return `${target.protocol}\0${target.model}\0${target.peerId}`;
  }

  async function beginToolConfig(target: CurlTarget, tool: ToolId): Promise<void> {
    if (!selectedApiKey) return;
    if (tool === 'curl') {
      setCurlTarget(target);
      return;
    }
    setToolConfigError('');
    setToolConfigMessage('');
    setConfiguringTarget(target);
    setConfiguringTool(tool);
    try {
      const inspection = await inspectTool(tool);
      setPendingInspection(inspection);
    } catch (error) {
      setToolConfigError(error instanceof Error ? error.message : String(error));
      setConfiguringTarget(null);
      setConfiguringTool(null);
    }
  }

  const closeToolConfigPreview = useCallback((): void => {
    setConfiguringTarget(null);
    setConfiguringTool(null);
    setPendingInspection(null);
  }, []);

  async function finishToolConfig(target: CurlTarget, tool: Exclude<ToolId, 'curl'>): Promise<void> {
    if (!selectedApiKey) return;
    setPendingInspection(null);
    try {
      const result = await applyToolConfig({
        tool,
        protocol: target.protocol,
        model: target.model,
        peerId: target.peerId,
        versionPrefix: target.versionPrefix,
        apiKey: selectedApiKey.key,
      });
      setToolConfigMessage(
        t('consumer.toolConfigured', {
          path: result.configPath,
          backup: result.backupPath || t('consumer.noBackup'),
        }),
      );
      setPendingInspection(null);
      setConfiguringTarget(null);
      setConfiguringTool(null);
    } catch (error) {
      setToolConfigError(error instanceof Error ? error.message : String(error));
      setPendingInspection(null);
      setConfiguringTarget(null);
      setConfiguringTool(null);
    }
  }

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
  }, [closeToolConfigPreview, curlTarget, pendingInspection]);

  return (
    <div>
      <div className="card">
        <h2>{t('consumer.findModel')}</h2>
        <p className="muted">{t('consumer.description')}</p>
        <div className={styles.scopeTabs} role="tablist" aria-label={t('consumer.searchScope')}>
          <button
            className={searchScope === 'all' ? styles.activeScopeTab : ''}
            role="tab"
            aria-selected={searchScope === 'all'}
            onClick={() => {
              setSearchScope('all');
              void runSearch('all', 1);
            }}
          >
            {t('consumer.allModels')}
          </button>
          <button
            className={searchScope === 'following' ? styles.activeScopeTab : ''}
            role="tab"
            aria-selected={searchScope === 'following'}
            onClick={() => {
              setSearchScope('following');
              void openFollowingPicker(1);
            }}
          >
            {t('consumer.followingModels')}
          </button>
        </div>
        {searchScope === 'all' ? (
          <>
            <div className="row">
              <div>
                <label>{t('consumer.modelName')}</label>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={onEnter}
                  placeholder={t('consumer.modelNamePlaceholder')}
                />
              </div>
              <div>
                <label>{t('consumer.protocol')}</label>
                <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                  <option value="">{t('consumer.protocolAny')}</option>
                  <option value="openai">openai</option>
                  <option value="openai-response">openai-response</option>
                  <option value="gemini">gemini</option>
                  <option value="anthropic">anthropic</option>
                  <option value="azure-openai">azure-openai</option>
                  <option value="ollama">ollama</option>
                </select>
              </div>
            </div>
            <div className="actions">
              <button onClick={() => void runSearch('all', 1)} disabled={!connected || searching}>
                {searching ? t('consumer.searching') : t('consumer.search')}
              </button>
            </div>
          </>
        ) : (
          <div className={styles.followingPicker}>
            <div className={styles.followingHeader}>
              <label>{t('consumer.selectFollowingUser')}</label>
              <span>
                {t('consumer.selectedFollowingUsers', {
                  selected: selectedFollowingUserIds.length,
                  total: followedUsers.length,
                })}
              </span>
            </div>
            {followedUsers.length === 0 ? (
              <div className={styles.followingEmpty}>{t('consumer.noFollowingUsers')}</div>
            ) : (
              <div className={styles.followingOptions}>
                {followedUsers.map((user) => (
                  <label className={styles.followingOption} key={user.userId}>
                    <input
                      type="checkbox"
                      checked={selectedFollowingUserIds.includes(user.userId)}
                      onChange={(e) => {
                        setSelectedFollowingUserIds((current) =>
                          e.target.checked
                            ? [...current, user.userId]
                            : current.filter((userId) => userId !== user.userId),
                        );
                      }}
                    />
                    <span className={styles.followingName}>
                      {user.username || t('consumer.unnamedUser')}
                    </span>
                    <span className={styles.followingMetrics}>
                      <span className={styles.followerMetric}>
                        {t('consumer.followers')}: {user.followerCount}
                      </span>
                      <span className={styles.callCountMetric}>
                        {t('consumer.callCount')}: {user.callCount}
                      </span>
                      <span className={styles.ratingMetric}>
                        {t('consumer.rating')}:{' '}
                        {(followedRatings.get(user.userId) ?? 0) > 0
                          ? t('consumer.ratingValue', {
                              rating: (followedRatings.get(user.userId) ?? 0).toFixed(1),
                            })
                          : t('consumer.noRating')}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {followingTotal > 0 && (
              <div className={styles.pagination}>
                <button
                  type="button"
                  className="secondary"
                  disabled={searching || followingPage <= 1}
                  onClick={() => void openFollowingPicker(followingPage - 1)}
                >
                  {t('consumer.previousPage')}
                </button>
                <span>
                  {t('consumer.pageInfo', {
                    page: followingPage,
                    pages: followingPageCount,
                    total: followingTotal,
                  })}
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={searching || followingPage >= followingPageCount}
                  onClick={() => void openFollowingPicker(followingPage + 1)}
                >
                  {t('consumer.nextPage')}
                </button>
              </div>
            )}
            <div className="actions">
              <button
                onClick={() => void runSearch('following', 1)}
                disabled={!connected || searching || selectedFollowingUserIds.length === 0}
              >
                {searching ? t('consumer.searching') : t('consumer.search')}
              </button>
            </div>
          </div>
        )}
        {!connected && <div className="hint">{t('common.waitingSignaling')}</div>}
        {apiKeysLoading && <div className="hint">{t('apiKeys.loading')}</div>}
        {!apiKeysLoading && apiKeys.length === 0 && (
          <div className="hint">{t('consumer.noApiKeys')}</div>
        )}
        {apiKeysError && <div className="hint err">{apiKeysError}</div>}
        {followError && <div className="hint err">{followError}</div>}
        {ratingError && <div className="hint err">{ratingError}</div>}
      </div>

      <div className="card">
        <h2>{t('consumer.results', { count: rows.length })}</h2>
        {!searched && <p className="muted">{t('consumer.searchToSee')}</p>}
        {searched && rows.length === 0 && (
          <p className="muted">
            {searchScope === 'following'
              ? t('consumer.noFollowingMatch')
              : t('consumer.noMatch')}
          </p>
        )}
        {rows.map((r) => {
          const key = rowKey(r);
          const open = expanded.has(key);
          return (
            <div className={styles.candidate} key={key}>
              <div
                className={styles.candidateHead}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => toggleExpanded(key)}
                onKeyDown={(e) => onToggleKey(e, key)}
              >
                <div className={styles.meta}>
                  <span className="badge">{r.protocol}</span>
                  <span style={{ marginLeft: 10, fontWeight: 600 }}>{r.model}</span>
                </div>
                <span className="badge green">{t('consumer.nodes', { count: r.nodes.length })}</span>
                <span className={styles.chevron}>{open ? 'v' : '>'}</span>
              </div>

              {open && (
                <div className={styles.nodeList}>
                  {r.nodes.map((node) => {
                    const target = {
                      model: r.model,
                      protocol: r.protocol,
                      peerId: node.peerId,
                      versionPrefix: node.versionPrefix,
                    };
                    const selectedTool =
                      toolByTarget[targetKey(target)] ?? node.supportedTools[0] ?? 'curl';
                    const isSelf = node.userId === currentUserId;
                    const followBusy = followingUserIds.has(node.userId);
                    const ratingBusy = ratingUserIds.has(node.userId);
                    const ratingValue =
                      node.rated && node.myRating !== null
                        ? node.myRating
                        : ratingDrafts[node.userId] ?? 0;
                    return (
                      <div className={styles.nodeRow} key={node.peerId}>
                        <div className={styles.nodeInfo}>
                          <div className={styles.pid} title={node.peerId}>
                            {t('consumer.nodeId')}: {node.peerId}
                          </div>
                          <div className={styles.nodeOwner}>
                            <span title={node.userId}>{t('consumer.userId')}: {node.userId}</span>
                            <span>{t('consumer.username')}: {node.username || t('consumer.unnamedUser')}</span>
                            <span>{t('consumer.followers')}: {node.followerCount}</span>
                            <span>{t('consumer.callCount')}: {node.callCount}</span>
                            <span>
                              {t('consumer.rating')}:{' '}
                              {node.rating > 0
                                ? t('consumer.ratingValue', { rating: node.rating.toFixed(1) })
                                : t('consumer.noRating')}
                            </span>
                            <span>{t('consumer.costMultiplier')}: {formatMultiplier(node.costMultiplier)}</span>
                            <span>{t('consumer.versionPrefix')}: {node.versionPrefix}</span>
                          </div>
                          <div className={styles.ratingPanel}>
                            {isSelf ? (
                              <span className={styles.ratingNote}>{t('consumer.cannotRateSelf')}</span>
                            ) : (
                              <>
                                <RatingStars
                                  value={ratingValue}
                                  disabled={node.rated || ratingBusy}
                                  label={(value) =>
                                    t('consumer.selectRating', { rating: value.toFixed(1) })
                                  }
                                  onChange={(value) => {
                                    setRatingError('');
                                    setRatingDrafts((current) => ({
                                      ...current,
                                      [node.userId]: value,
                                    }));
                                  }}
                                />
                                {node.rated && node.myRating !== null ? (
                                  <span className={styles.ratingNote}>
                                    {t('consumer.yourRating', {
                                      rating: node.myRating.toFixed(1),
                                    })}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={!ratingValue || ratingBusy}
                                    onClick={() => void onRate(node.userId)}
                                  >
                                    {ratingBusy
                                      ? t('consumer.ratingSubmitting')
                                      : t('consumer.submitRating')}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div className={styles.nodeActions}>
                          <button
                            className="secondary"
                            disabled={isSelf || followBusy}
                            onClick={() => void onToggleFollow(node.userId, node.following)}
                          >
                            {isSelf
                              ? t('common.followingSelf')
                              : node.following
                                ? t('common.unfollow')
                                : t('common.follow')}
                          </button>
                          <div
                            className={`${styles.usageControls} ${
                              selectedApiKey ? '' : styles.usageControlsDisabled
                            }`}
                          >
                            <select
                              value={selectedApiKey?.id ?? ''}
                              aria-label={t('consumer.selectApiKey')}
                              disabled={!apiKeys.some((apiKey) => !apiKey.frozen)}
                              onChange={(event) => onSelectApiKey(event.target.value)}
                            >
                              {!apiKeys.some((apiKey) => !apiKey.frozen) ? (
                                <option value="">{t('consumer.noApiKeyOption')}</option>
                              ) : null}
                              {apiKeys.map((apiKey) => (
                                <option
                                  value={apiKey.id}
                                  key={apiKey.id}
                                  disabled={apiKey.frozen}
                                >
                                  {apiKey.name}
                                  {apiKey.frozen ? ` (${t('apiKeys.frozen')})` : ''}
                                </option>
                              ))}
                            </select>
                            <select
                              value={selectedTool}
                              aria-label={t('consumer.selectTool')}
                              disabled={!selectedApiKey}
                              onChange={(e) =>
                                setToolByTarget((current) => ({
                                  ...current,
                                  [targetKey(target)]: e.target.value as ToolId,
                                }))
                              }
                            >
                              {node.supportedTools.map((tool) => (
                                <option value={tool} key={tool}>{tool}</option>
                              ))}
                            </select>
                            <button
                              className="secondary"
                              disabled={!selectedApiKey || configuringTarget != null}
                              onClick={() => void beginToolConfig(target, selectedTool)}
                            >
                              {selectedTool === 'curl'
                                ? t('consumer.copyCurl')
                                : t('consumer.configureTool', { tool: selectedTool })}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {searched && searchTotal > 0 && (
          <div className={styles.pagination}>
            <button
              type="button"
              className="secondary"
              disabled={searching || searchPage <= 1}
              onClick={() => void runSearch(searchScope, searchPage - 1)}
            >
              {t('consumer.previousPage')}
            </button>
            <span>{t('consumer.pageInfo', { page: searchPage, pages: searchPageCount, total: searchTotal })}</span>
            <button
              type="button"
              className="secondary"
              disabled={searching || searchPage >= searchPageCount}
              onClick={() => void runSearch(searchScope, searchPage + 1)}
            >
              {t('consumer.nextPage')}
            </button>
          </div>
        )}
        <div className="hint">
          {t('consumer.serviceLinkHint')}{' '}
          <code>{origin}/&lt;protocol&gt;/&lt;base64url(model)&gt;/&lt;peerId&gt;&lt;version-prefix&gt;</code>
        </div>
        {toolConfigMessage && <div className="hint">{toolConfigMessage}</div>}
        {toolConfigError && <div className="hint err">{toolConfigError}</div>}
      </div>

      {curlTarget && (
        <div className="modal-overlay" onClick={() => setCurlTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {t('consumer.curlTitle')} <span className="badge">{curlTarget.protocol}</span>{' '}
              <span style={{ fontWeight: 600 }}>{curlTarget.model}</span>
            </h3>
            <div className={styles.pid} style={{ marginBottom: 10 }}>
              {t('consumer.nodeId')}: {curlTarget.peerId}
            </div>
            <pre>{selectedApiKey ? buildCurl(origin, curlTarget, selectedApiKey.key) : ''}</pre>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setCurlTarget(null)}>
                {t('consumer.close')}
              </button>
              <button
                disabled={!selectedApiKey}
                onClick={() => selectedApiKey && copy(buildCurl(origin, curlTarget, selectedApiKey.key))}
              >
                {selectedApiKey && copied === buildCurl(origin, curlTarget, selectedApiKey.key)
                  ? t('consumer.copied')
                  : t('consumer.copy')}
              </button>
            </div>
          </div>
        </div>
      )}

      {configuringTarget && configuringTool && pendingInspection && (
        <div className="modal-overlay" onClick={closeToolConfigPreview}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('consumer.toolConfigPreviewTitle', { tool: configuringTool })}</h3>
            <p>{t('consumer.toolConfigPreviewDescription')}</p>
            <pre>
              {[
                `${t('consumer.previewTool')}: ${configuringTool}`,
                `${t('consumer.protocol')}: ${configuringTarget.protocol}`,
                `${t('consumer.modelName')}: ${configuringTarget.model}`,
                `${t('consumer.nodeId')}: ${configuringTarget.peerId}`,
                `${t('consumer.apiKey')}: ${selectedApiKey?.name ?? ''}`,
                `${t('consumer.previewEndpoint')}: ${buildToolEndpoint(origin, configuringTarget, configuringTool)}`,
                `${t('consumer.previewConfigPath')}: ${pendingInspection.configPath}`,
              ].join('\n')}
            </pre>
            {pendingInspection.conflicts.length > 0 && (
              <>
                <h4>{t('consumer.envConflictTitle')}</h4>
                <p>{t('consumer.envConflictDescription')}</p>
                <pre>{pendingInspection.conflicts.join('\n')}</pre>
              </>
            )}
            <div className="modal-actions">
              <button className="secondary" onClick={closeToolConfigPreview}>
                {t('consumer.close')}
              </button>
              <button onClick={() => {
                void finishToolConfig(configuringTarget, configuringTool);
              }}>
                {t('consumer.confirmConfigure')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
