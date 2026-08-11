import type { ConsumerApiKeyDto } from '@/lib/client/auth';
import type { RecentSearch } from '@/lib/recent-searches';
import { useI18n } from '@/lib/i18n/context';
import type { ConsumerInfoState } from './useConsumerInfoState';
import styles from './ConsumerInfo.module.css';

export function ConsumerSearchPanel({ state, apiKeys, apiKeysLoading, apiKeysError }: {
  state: ConsumerInfoState; apiKeys: ConsumerApiKeyDto[]; apiKeysLoading: boolean; apiKeysError: string;
}) {
  const { t } = useI18n();
  const { searchScope, setSearchScope, keyword, setKeyword, protocol, setProtocol,
    searching, selectedFollowingUserIds, setSelectedFollowingUserIds, followedUsers,
    followedRatings, followingPage, followingTotal, followingPageCount,
    connected, runSearch, openFollowingPicker, onEnter,
    recentSearches, searchFor, dropRecent, clearRecentSearches } = state;
  return (
    <div className="card">
      <h2>{t('consumer.findModel')}</h2>
      <p className="muted">{t('consumer.description')}</p>
      <div className={styles.scopeTabs} role="tablist" aria-label={t('consumer.searchScope')}>
        <button className={searchScope === 'all' ? styles.activeScopeTab : ''} role="tab" aria-selected={searchScope === 'all'}
          onClick={() => { setSearchScope('all'); void runSearch('all', 1); }}>{t('consumer.allModels')}</button>
        <button className={searchScope === 'following' ? styles.activeScopeTab : ''} role="tab" aria-selected={searchScope === 'following'}
          onClick={() => { setSearchScope('following'); void openFollowingPicker(1); }}>{t('consumer.followingModels')}</button>
      </div>
      {searchScope === 'all' ? (
        <>
          <div className="row">
            <div><label>{t('consumer.modelName')}</label><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={onEnter} placeholder={t('consumer.modelNamePlaceholder')} /></div>
            <div><label>{t('consumer.protocol')}</label><select value={protocol} onChange={(event) => setProtocol(event.target.value)}>
              <option value="">{t('consumer.protocolAny')}</option>
              {['openai', 'openai-response', 'gemini', 'anthropic', 'azure-openai', 'ollama'].map((value) => <option value={value} key={value}>{value}</option>)}
            </select></div>
          </div>
          <div className="hint">{t('consumer.exactMatchHint')}</div>
          <RecentSearches
            entries={recentSearches}
            busy={searching}
            onPick={(entry) => void searchFor(entry)}
            onRemove={dropRecent}
            onClear={clearRecentSearches}
          />
          <div className="actions">
            <button onClick={() => void runSearch('all', 1, true)} disabled={!connected || searching}>
              {searching ? t('consumer.searching') : t('consumer.search')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!connected || searching}
              onClick={() => void searchFor({ keyword: '', protocol: '' })}
            >
              {t('consumer.browseAll')}
            </button>
          </div>
        </>
      ) : (
        <div className={styles.followingPicker}>
          <div className={styles.followingHeader}><label>{t('consumer.selectFollowingUser')}</label><span>{t('consumer.selectedFollowingUsers', { selected: selectedFollowingUserIds.length, total: followedUsers.length })}</span></div>
          {followedUsers.length === 0 ? <div className={styles.followingEmpty}>{t('consumer.noFollowingUsers')}</div> : (
            <div className={styles.followingOptions}>{followedUsers.map((user) => (
              <label className={styles.followingOption} key={user.userId}>
                <input type="checkbox" checked={selectedFollowingUserIds.includes(user.userId)} onChange={(event) => setSelectedFollowingUserIds((current) => event.target.checked ? [...current, user.userId] : current.filter((id) => id !== user.userId))} />
                <span className={styles.followingName}>
                  {user.username || t('consumer.unnamedUser')}
                  {user.badge ? (
                    <span className="badge green">
                      {user.badge === 'official' ? t('consumer.officialSupply') : user.badge}
                    </span>
                  ) : null}
                </span>
                <span className={styles.followingMetrics}>
                  <span className={styles.followerMetric}>{t('consumer.followers')}: {user.followerCount}</span>
                  <span className={styles.callCountMetric}>{t('consumer.callCount')}: {user.callCount}</span>
                  <span className={styles.ratingMetric}>{t('consumer.rating')}: {(followedRatings.get(user.userId) ?? 0) > 0 ? t('consumer.ratingValue', { rating: (followedRatings.get(user.userId) ?? 0).toFixed(1) }) : t('consumer.noRating')}</span>
                </span>
              </label>
            ))}</div>
          )}
          {followingTotal > 0 && <Pagination page={followingPage} pages={followingPageCount} total={followingTotal} busy={searching} onPage={openFollowingPicker} />}
          <div className="actions"><button onClick={() => void runSearch('following', 1, true)} disabled={!connected || searching || selectedFollowingUserIds.length === 0}>{searching ? t('consumer.searching') : t('consumer.search')}</button></div>
        </div>
      )}
      {!connected && <div className="hint">{t('common.waitingSignaling')}</div>}
      {apiKeysLoading && <div className="hint">{t('apiKeys.loading')}</div>}
      {!apiKeysLoading && apiKeys.length === 0 && <div className="hint">{t('consumer.noApiKeys')}</div>}
      {apiKeysError && <div className="hint err">{apiKeysError}</div>}
    </div>
  );
}

function RecentSearches({ entries, busy, onPick, onRemove, onClear }: {
  entries: readonly RecentSearch[];
  busy: boolean;
  onPick: (entry: RecentSearch) => void;
  onRemove: (entry: RecentSearch) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  if (entries.length === 0) return null;
  return (
    <div className={styles.recent}>
      <span className={styles.recentLabel}>{t('consumer.recentSearches')}</span>
      <div className={styles.recentChips}>
        {entries.map((entry) => (
          <span className={styles.recentChip} key={`${entry.protocol}|${entry.keyword}`}>
            <button
              type="button"
              className={styles.recentChipMain}
              disabled={busy}
              onClick={() => onPick(entry)}
              title={entry.protocol || t('consumer.recentAny')}
            >
              {entry.keyword}
              {entry.protocol ? <span className={styles.recentProtocol}>{entry.protocol}</span> : null}
            </button>
            <button
              type="button"
              className={styles.recentChipRemove}
              aria-label={t('consumer.removeRecent')}
              onClick={() => onRemove(entry)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <button type="button" className={styles.recentClear} onClick={onClear}>
        {t('consumer.clearRecent')}
      </button>
    </div>
  );
}

function Pagination({ page, pages, total, busy, onPage }: { page: number; pages: number; total: number; busy: boolean; onPage: (page: number) => Promise<void> }) {
  const { t } = useI18n();
  return <div className={styles.pagination}>
    <button type="button" className="secondary" disabled={busy || page <= 1} onClick={() => void onPage(page - 1)}>{t('consumer.previousPage')}</button>
    <span>{t('consumer.pageInfo', { page, pages, total })}</span>
    <button type="button" className="secondary" disabled={busy || page >= pages} onClick={() => void onPage(page + 1)}>{t('consumer.nextPage')}</button>
  </div>;
}
