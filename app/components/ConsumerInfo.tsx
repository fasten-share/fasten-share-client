'use client';

import type { Status } from '@/lib/control-client';
import type { ConsumerApiKeyDto } from '@/lib/client/auth';
import type { DiscoverFn } from '@/lib/client/status-link';
import { useI18n } from '@/lib/i18n/context';
import styles from './ConsumerInfo.module.css';
import type { ToolId } from '@/lib/tool-support';
import { formatMultiplier, rowKey, targetKey } from './consumer-utils';
import { CurlModal, ToolConfigModal } from './ConsumerToolModals';
import { useConsumerInfoState } from './useConsumerInfoState';
import { RatingStars } from './RatingStars';

interface ConsumerInfoProps { status: Status; origin: string; discover: DiscoverFn; currentUserId: string; apiKeys: ConsumerApiKeyDto[]; selectedApiKeyId: string; onSelectApiKey: (id: string) => void; apiKeysLoading: boolean; apiKeysError: string }

export function ConsumerInfo(props: ConsumerInfoProps) {
  const { status, origin, discover, currentUserId, apiKeys, selectedApiKeyId,
    onSelectApiKey, apiKeysLoading, apiKeysError } = props;
  const { t } = useI18n();
  const state = useConsumerInfoState({ status, discover, currentUserId, apiKeys, selectedApiKeyId, t });
  const { searchScope, setSearchScope, keyword, setKeyword, protocol, setProtocol, rows, expanded, searching, searched, searchPage, searchTotal, selectedApiKey, followingUserIds, followedUsers, followedRatings, selectedFollowingUserIds, setSelectedFollowingUserIds, followingPage, followingTotal, followError, ratingDrafts, setRatingDrafts, ratingUserIds, ratingError, setRatingError, connected, searchPageCount, followingPageCount, runSearch, openFollowingPicker, onEnter, toggleExpanded, onToggleKey, onToggleFollow, onRate, toolConfig } = state;
  const { copied, curlTarget, setCurlTarget, toolByTarget, setToolByTarget, configuringTarget, configuringTool, pendingInspection, toolConfigStage, toolBackups, restorePreview, toolConfigWorking, toolConfigMessage, toolConfigError, copy, beginToolConfig, closeToolConfigPreview, cleanToolConfig, verifyToolConfig, showRestorePreview, restoreBackup, finishToolConfig } = toolConfig;
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
        <CurlModal target={curlTarget} origin={origin} apiKey={selectedApiKey} copied={copied} t={t} onClose={() => setCurlTarget(null)} onCopy={copy} />
      )}
      {configuringTarget && configuringTool && pendingInspection && (
        <ToolConfigModal target={configuringTarget} tool={configuringTool} origin={origin} apiKey={selectedApiKey} inspection={pendingInspection} stage={toolConfigStage} backups={toolBackups} restorePreview={restorePreview} working={toolConfigWorking} t={t} onClose={closeToolConfigPreview} onClean={() => void cleanToolConfig(configuringTool)} onVerify={() => void verifyToolConfig(configuringTool)} onPreviewRestore={(id) => void showRestorePreview(configuringTool, id)} onRestore={(id) => void restoreBackup(configuringTool, id)} onFinish={() => void finishToolConfig(configuringTarget, configuringTool)} />
      )}
    </div>
  );
}
