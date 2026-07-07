'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadMessages, type SystemMessageDto } from '@/lib/client/auth';
import { useI18n } from '@/lib/i18n/context';
import styles from './MessageBox.module.css';

const READ_STORAGE_PREFIX = 'fs.messages.read.';
const MAX_STORED_READ_IDS = 500;
const REFRESH_INTERVAL_MS = 60_000;

export function MessageBox({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SystemMessageDto[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    window.queueMicrotask(() => {
      if (!alive) return;
      setLoading(true);
      setError('');
      setMessages([]);
      setSelectedId(null);
      setReadIds(readStoredIds(userId));
    });
    void loadMessages()
      .then((next) => {
        if (!alive) return;
        setMessages(next);
      })
      .catch((err) => {
        if (alive) setError((err as { message?: string }).message || t('messages.loadFailed'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [t, userId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadMessages()
        .then((next) => {
          setMessages(next);
          setSelectedId((current) =>
            current && next.some((message) => message.id === current)
              ? current
              : null,
          );
        })
        .catch(() => {
          // The initial request already surfaces errors; background refresh is silent.
        });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [userId]);

  const selected = useMemo(
    () => messages.find((message) => message.id === selectedId) ?? null,
    [messages, selectedId],
  );
  const unreadCount = messages.reduce(
    (count, message) => count + (readIds.has(message.id) ? 0 : 1),
    0,
  );

  function markRead(ids: string[]): void {
    setReadIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      storeReadIds(userId, next);
      return next;
    });
  }

  function selectMessage(message: SystemMessageDto): void {
    setSelectedId(message.id);
    if (!readIds.has(message.id)) markRead([message.id]);
  }

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-label={t('messages.title')}
        title={t('messages.title')}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">✉</span>
        {unreadCount > 0 ? (
          <span className={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        ) : null}
      </button>

      {open ? (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div
            className={`modal ${styles.modal}`}
            role="dialog"
            aria-modal="true"
            aria-label={t('messages.title')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.header}>
              <div>
                <h3>{t('messages.title')}</h3>
                <p className="muted">{t('messages.unreadCount', { count: unreadCount })}</p>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={unreadCount === 0}
                onClick={() => markRead(messages.map((message) => message.id))}
              >
                {t('messages.markAllRead')}
              </button>
            </div>

            {loading ? <div className={styles.state}>{t('messages.loading')}</div> : null}
            {error ? <div className={`err ${styles.state}`}>{error}</div> : null}
            {!loading && !error && messages.length === 0 ? (
              <div className={styles.state}>{t('messages.empty')}</div>
            ) : null}

            {messages.length > 0 ? (
              <div className={styles.layout}>
                <div className={styles.list}>
                  {messages.map((message) => {
                    const unread = !readIds.has(message.id);
                    return (
                      <button
                        type="button"
                        key={message.id}
                        className={`${styles.item} ${selectedId === message.id ? styles.selected : ''}`}
                        onClick={() => selectMessage(message)}
                      >
                        <span className={styles.itemTitle}>
                          {unread ? <i className={styles.unreadDot} aria-label={t('messages.unread')} /> : null}
                          {message.title}
                        </span>
                        <time>{formatDate(message.createdAt)}</time>
                      </button>
                    );
                  })}
                </div>
                <article className={styles.detail}>
                  {selected ? (
                    <>
                      <h4>{selected.title}</h4>
                      <time>{formatDate(selected.createdAt)}</time>
                      <p>{selected.content}</p>
                    </>
                  ) : <div className={styles.detailState}>{t('messages.select')}</div>}
                </article>
              </div>
            ) : null}

            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setOpen(false)}>
                {t('settings.close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function storageKey(userId: string): string {
  return `${READ_STORAGE_PREFIX}${userId}`;
}

function readStoredIds(userId: string): Set<string> {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? '[]');
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function storeReadIds(userId: string, ids: Set<string>): void {
  const values = Array.from(ids).slice(-MAX_STORED_READ_IDS);
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(values));
  } catch {
    // Keep the in-memory read state when storage is unavailable or full.
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, { hour12: false });
}
