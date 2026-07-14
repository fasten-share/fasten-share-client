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
import { ConsumerSearchPanel } from './ConsumerSearchPanel';

interface ConsumerInfoProps { status: Status; origin: string; discover: DiscoverFn; currentUserId: string; apiKeys: ConsumerApiKeyDto[]; selectedApiKeyId: string; onSelectApiKey: (id: string) => void; apiKeysLoading: boolean; apiKeysError: string }

export function ConsumerInfo(props: ConsumerInfoProps) {
  const { status, origin, discover, currentUserId, apiKeys, selectedApiKeyId,
    onSelectApiKey, apiKeysLoading, apiKeysError } = props;
  const { t } = useI18n();
  const state = useConsumerInfoState({ status, discover, currentUserId, apiKeys, selectedApiKeyId, t });
  const { searchScope, rows, expanded, searching, searched, searchPage, searchHasMore,
    selectedApiKey, followingUserIds, ratingDrafts, setRatingDrafts, ratingUserIds,
    setRatingError, runSearch, toggleExpanded, onToggleKey,
    onToggleFollow, onRate, toolConfig } = state;
  const { copied, curlTarget, setCurlTarget, toolByTarget, setToolByTarget, configuringTarget, configuringTool, pendingInspection, toolConfigStage, toolBackups, restorePreview, toolConfigWorking, toolConfigMessage, toolConfigError, copy, beginToolConfig, closeToolConfigPreview, cleanToolConfig, checkAndConfigureTool, showRestorePreview, restoreBackup } = toolConfig;
  return (
    <div>
      <ConsumerSearchPanel state={state} apiKeys={apiKeys} apiKeysLoading={apiKeysLoading} apiKeysError={apiKeysError} />
      {/* Results stay separate from search controls so each can evolve independently. */}
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
        {searched && (rows.length > 0 || searchPage > 1) && (
          <div className={styles.pagination}>
            <button
              type="button"
              className="secondary"
              disabled={searching || searchPage <= 1}
              onClick={() => void runSearch(searchScope, searchPage - 1)}
            >
              {t('consumer.previousPage')}
            </button>
            <span>{t('consumer.cursorPageInfo', { page: searchPage })}</span>
            <button
              type="button"
              className="secondary"
              disabled={searching || !searchHasMore}
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
        <ToolConfigModal target={configuringTarget} tool={configuringTool} origin={origin} apiKey={selectedApiKey} inspection={pendingInspection} stage={toolConfigStage} backups={toolBackups} restorePreview={restorePreview} working={toolConfigWorking} t={t} onClose={closeToolConfigPreview} onClean={() => void cleanToolConfig(configuringTool)} onCheckAndConfigure={() => void checkAndConfigureTool(configuringTarget, configuringTool)} onPreviewRestore={(id) => void showRestorePreview(configuringTool, id)} onRestore={(id) => void restoreBackup(configuringTool, id)} />
      )}
    </div>
  );
}
