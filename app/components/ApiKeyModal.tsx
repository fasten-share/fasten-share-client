'use client';

import { useState } from 'react';
import {
  createConsumerApiKey,
  deleteConsumerApiKey,
  freezeConsumerApiKey,
  type ConsumerApiKeyDto,
  unfreezeConsumerApiKey,
} from '@/lib/client/auth';
import { useI18n } from '@/lib/i18n/context';
import styles from './ApiKeyModal.module.css';

export function ApiKeyModal({
  apiKeys,
  onChange,
  onClose,
}: {
  apiKeys: ConsumerApiKeyDto[];
  onChange: (apiKeys: ConsumerApiKeyDto[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [freezingId, setFreezingId] = useState('');
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState('');
  const [error, setError] = useState('');

  async function onCreate(): Promise<void> {
    if (!name.trim() || creating || apiKeys.length >= 5) return;
    setCreating(true);
    setError('');
    try {
      const created = await createConsumerApiKey(name);
      onChange([...apiKeys, created]);
      setName('');
    } catch (err) {
      setError((err as Error).message || t('apiKeys.createFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(apiKey: ConsumerApiKeyDto): Promise<void> {
    if (!window.confirm(t('apiKeys.deleteConfirm', { name: apiKey.name }))) return;
    setDeletingId(apiKey.id);
    setError('');
    try {
      await deleteConsumerApiKey(apiKey.id);
      onChange(apiKeys.filter((item) => item.id !== apiKey.id));
    } catch (err) {
      setError((err as Error).message || t('apiKeys.deleteFailed'));
    } finally {
      setDeletingId('');
    }
  }

  async function onToggleFreeze(apiKey: ConsumerApiKeyDto): Promise<void> {
    if (
      !apiKey.frozen
      && !window.confirm(t('apiKeys.freezeConfirm', { name: apiKey.name }))
    ) return;
    setFreezingId(apiKey.id);
    setError('');
    try {
      const updated = apiKey.frozen
        ? await unfreezeConsumerApiKey(apiKey.id)
        : await freezeConsumerApiKey(apiKey.id);
      onChange(apiKeys.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError((err as Error).message || t('apiKeys.freezeFailed'));
    } finally {
      setFreezingId('');
    }
  }

  async function copy(apiKey: ConsumerApiKeyDto): Promise<void> {
    await navigator.clipboard.writeText(apiKey.key);
    setCopiedId(apiKey.id);
    window.setTimeout(() => setCopiedId(''), 1400);
  }

  function toggleVisible(id: string): void {
    setVisibleIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${styles.modal}`} onClick={(event) => event.stopPropagation()}>
        <h3>{t('apiKeys.title')}</h3>
        <p className="muted">{t('apiKeys.description')}</p>
        <section className={styles.freezeRules}>
          <strong>{t('apiKeys.freezeRulesTitle')}</strong>
          <ul>
            <li>{t('apiKeys.freezeRuleWindow')}</li>
            <li>{t('apiKeys.freezeRulePermanent')}</li>
            <li>{t('apiKeys.freezeRuleManual')}</li>
          </ul>
        </section>

        <div className={styles.createRow}>
          <label>
            {t('apiKeys.name')}
            <input
              value={name}
              maxLength={20}
              placeholder={t('apiKeys.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void onCreate();
              }}
            />
          </label>
          <button
            type="button"
            disabled={!name.trim() || creating || apiKeys.length >= 5}
            onClick={() => void onCreate()}
          >
            {creating ? t('apiKeys.creating') : t('apiKeys.create')}
          </button>
        </div>

        <div className="hint">
          {t('apiKeys.count', { count: apiKeys.length })}
          {apiKeys.length >= 5 ? ` · ${t('apiKeys.limitReached')}` : ''}
        </div>
        {error ? <div className="hint err">{error}</div> : null}

        <div className={styles.keyList}>
          {apiKeys.length === 0 ? (
            <div className={styles.empty}>{t('apiKeys.empty')}</div>
          ) : (
            apiKeys.map((apiKey) => {
              const visible = visibleIds.has(apiKey.id);
              return (
                <div className={styles.keyRow} key={apiKey.id}>
                  <div className={styles.keyMeta}>
                    <span className={styles.keyName}>
                      {apiKey.name}
                      {apiKey.frozen ? (
                        <span className={styles.frozenBadge}>
                          {apiKey.freezeReason === 'inactive'
                            ? t('apiKeys.frozenInactive')
                            : t('apiKeys.frozen')}
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.keyDate}>
                      {new Date(apiKey.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <code className={styles.keyValue}>
                    {visible ? apiKey.key : `${apiKey.key.slice(0, 8)}${'•'.repeat(24)}`}
                  </code>
                  <div className={styles.actions}>
                    <button type="button" className="secondary" onClick={() => toggleVisible(apiKey.id)}>
                      {visible ? t('apiKeys.hide') : t('apiKeys.show')}
                    </button>
                    <button type="button" className="secondary" onClick={() => void copy(apiKey)}>
                      {copiedId === apiKey.id ? t('consumer.copied') : t('consumer.copy')}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={freezingId === apiKey.id}
                      onClick={() => void onToggleFreeze(apiKey)}
                    >
                      {freezingId === apiKey.id
                        ? t('apiKeys.freezeUpdating')
                        : apiKey.frozen
                          ? t('apiKeys.unfreeze')
                          : t('apiKeys.freeze')}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={deletingId === apiKey.id}
                      onClick={() => void onDelete(apiKey)}
                    >
                      {deletingId === apiKey.id ? t('apiKeys.deleting') : t('apiKeys.delete')}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
