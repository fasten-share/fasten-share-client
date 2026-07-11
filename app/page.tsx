'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { control, loadBackends, saveBackends, type Status } from '@/lib/control-client';
import {
  loadMe,
  loadConsumerApiKeys,
  logout,
  renewAccessTokenIfNeeded,
  setAuthNotice,
  startAccessTokenRenewal,
  type AuthError,
  type ConsumerApiKeyDto,
  type UserDto,
} from '@/lib/client/auth';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ConsumerInfo } from './components/ConsumerInfo';
import { ProducerForm } from './components/ProducerForm';
import { ProducerBridge } from './components/ProducerBridge';
import { RechargeModal } from './components/RechargeModal';
import { ReferralModal } from './components/ReferralModal';
import { SettingsModal } from './components/SettingsModal';
import { MessageBox } from './components/MessageBox';
import type { DiscoverFn, ProducerBridgeHandle } from '@/lib/client/status-link';
import { useI18n } from '@/lib/i18n/context';
import {
  AUTO_SHARE_KEY,
  formatCreditBalance,
  prepareAutoShare,
  TAB_STORAGE_KEY,
  type Tab,
} from './home-utils';
import styles from './page.module.css';

export default function Home() {
  const router = useRouter();
  const { t, lang, setLang } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  // Auto-share preference. Persisted in localStorage, default ON. Not rendered
  // during SSR (the modal is closed), so a lazy initializer is hydration-safe.
  const [autoShare, setAutoShareState] = useState<boolean>(() =>
    typeof window === 'undefined' ? true : window.localStorage.getItem(AUTO_SHARE_KEY) !== 'false',
  );
  const setAutoShare = useCallback((next: boolean) => {
    setAutoShareState(next);
    window.localStorage.setItem(AUTO_SHARE_KEY, String(next));
  }, []);
  const [autoShareNotice, setAutoShareNotice] = useState('');
  // Remember the last tab the user selected (defaults to consumer). Read lazily
  // so we don't touch localStorage during SSR.
  const [tab, setTabState] = useState<Tab>('consumer');
  useEffect(() => {
    const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
    if (saved === 'consumer' || saved === 'producer') {
      window.queueMicrotask(() => setTabState(saved));
    }
  }, []);
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    window.localStorage.setItem(TAB_STORAGE_KEY, next);
  }, []);
  const [status, setStatus] = useState<Status | null>(null);
  const [user, setUser] = useState<UserDto | null>(null);
  const [apiKeys, setApiKeys] = useState<ConsumerApiKeyDto[]>([]);
  const [selectedApiKeyId, setSelectedApiKeyId] = useState('');
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeysError, setApiKeysError] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [signalUrl, setSignalUrl] = useState('');

  useEffect(() => {
    let alive = true;
    let stopRenewal: (() => void) | undefined;

    void (async () => {
      try {
        await renewAccessTokenIfNeeded();
      } catch (error) {
        if ((error as AuthError).status === 401 || (error as AuthError).status === 403) throw error;
        // A temporary refresh failure must not discard a still-valid session.
      }

      return loadMe();
    })()
      .then((u) => {
        if (!alive) return;
        setUser(u);
        if (!u) {
          router.replace('/login');
          return;
        }
        stopRenewal = startAccessTokenRenewal((error) => {
          if (!alive) return;
          if (error?.status === 403) setAuthNotice(error.message);
          setUser(null);
          bridgeRef.current?.stop();
          bridgeRef.current = null;
          router.replace('/login');
        });
      })
      .catch((error: unknown) => {
        if (alive) {
          const authError = error as AuthError;
          if (authError.status === 403) setAuthNotice(authError.message);
          setUser(null);
          router.replace('/login');
        }
      })
      .finally(() => {
        if (alive) setAuthLoading(false);
      });
    return () => {
      alive = false;
      stopRenewal?.();
    };
  }, [router]);

  useEffect(() => {
    if (!user?.id) {
      setApiKeys([]);
      setSelectedApiKeyId('');
      setApiKeysLoading(false);
      setApiKeysError('');
      return;
    }

    let alive = true;
    setApiKeysLoading(true);
    setApiKeysError('');
    void loadConsumerApiKeys()
      .then((keys) => {
        if (!alive) return;
        setApiKeys(keys);
        setSelectedApiKeyId((current) =>
          keys.some((key) => key.id === current && !key.frozen)
            ? current
            : keys.find((key) => !key.frozen)?.id ?? '',
        );
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setApiKeys([]);
        setSelectedApiKeyId('');
        setApiKeysError((error as Error).message || t('apiKeys.loadFailed'));
      })
      .finally(() => {
        if (alive) setApiKeysLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [t, user?.id]);

  const updateApiKeys = useCallback((keys: ConsumerApiKeyDto[]) => {
    setApiKeys(keys);
    setApiKeysError('');
    setSelectedApiKeyId((current) =>
      keys.some((key) => key.id === current && !key.frozen)
        ? current
        : keys.find((key) => !key.frozen)?.id ?? '',
    );
  }, []);

  const onLogout = useCallback(async () => {
    await logout();
    setUser(null);
    setApiKeys([]);
    setSelectedApiKeyId('');
    bridgeRef.current?.stop();
    bridgeRef.current = null;
    router.replace('/login');
  }, [router]);

  // Status is pushed by the local producer bridge (no polling). Seed the URL input
  // once from the signaling URL the bridge learns from Node.
  const onStatus = useCallback((s: Status) => {
    setStatus(s);
    setSignalUrl((cur) => (cur === '' ? s.config.signalUrl : cur));
  }, []);

  // Auto-share once on load == "start all": if enabled and backend configs are
  // stored locally, force every saved backend on (enabled=true) and (health-gated)
  // start sharing them — ignoring any per-backend stop from a previous session.
  // Failed health checks are surfaced per-backend in the Producer form.
  const autoShareDoneRef = useRef(false);
  useEffect(() => {
    if (!autoShare || autoShareDoneRef.current) return;
    if (!status || !status.signaling.connected || status.producer.running) return;
    if (!user?.id) return;
    const stored = loadBackends(user.id);
    if (!stored.some((b) => b.models.length > 0)) return;
    autoShareDoneRef.current = true;
    const prepared = prepareAutoShare(stored);
    const backends = prepared.backends;
    saveBackends(user.id, backends); // persist the "all enabled" state for the form
    if (prepared.duplicate) {
      setAutoShareNotice(t('producer.autoShareDuplicateSkipped', { offering: prepared.duplicate }));
    }
    void (async () => {
      try {
        const s = await control({ action: 'setBackends', backends });
        onStatus(s);
        const failed = s.producer.backends.filter((b) => b.lastHealth && !b.lastHealth.ok);
        if (failed.length) {
          setAutoShareNotice(
            t('producer.autoShareFailed', {
              reason: failed[0].lastHealth?.reason ?? t('producer.healthReasonUnknown'),
            }),
          );
        }
      } catch {
        setAutoShareNotice(
          t('producer.autoShareFailed', { reason: t('producer.healthReasonUnknown') }),
        );
      }
    })();
  }, [autoShare, status, onStatus, t, user?.id]);

  // Transport dropped (tab/bridge disconnect) -> Node stopped the producer
  // (core.ts disconnect handler). Re-arm the one-shot auto-share so sharing
  // resumes automatically once the transport reconnects (subject to the switch).
  useEffect(() => {
    if (status && !status.transport.ready) autoShareDoneRef.current = false;
  }, [status]);

  // The bridge (which owns the signaling socket) drives discovery for the
  // Consumer search. Stable wrapper so ConsumerInfo doesn't re-render needlessly.
  const bridgeRef = useRef<ProducerBridgeHandle | null>(null);
  const discover = useCallback<DiscoverFn>(
    (keyword, protocol, publisherUserIds, page, pageSize) =>
      bridgeRef.current
        ? bridgeRef.current.discover(keyword, protocol, publisherUserIds, page, pageSize)
        : Promise.resolve({ candidates: [], page: page ?? 1, pageSize: pageSize ?? 20, total: 0 }),
    [],
  );

  const connected = status?.signaling.connected ?? false;

  return (
    <div className={styles.app}>
      {user && <ProducerBridge onStatus={onStatus} onHandle={(h) => (bridgeRef.current = h)} />}
      <div className={styles.topbar}>
        <h1>{t('app.title')}</h1>
        <span className="badge">
          {connected ? t('topbar.signalingOnline') : t('topbar.offline')}
        </span>
        <span className="muted">
          <span className={`${styles.dot} ${connected ? styles.online : styles.offline}`} />
          {status?.signaling.peerId ? status.signaling.peerId.slice(0, 8) : '—'}
        </span>
        <div className={styles.spacer} />
        <span className="muted" style={{ fontFamily: 'monospace' }}>
          {t('topbar.signalUrl')}: {signalUrl || '—'}
        </span>
        {authLoading ? (
          <span className="muted">{t('auth.accountLoading')}</span>
        ) : user ? (
          <div className={styles.accountPill}>
            <span title={user.id}>{user.displayName || t('auth.userFallback', { id: user.id })}</span>
            <span
              className={styles.creditBalance}
              title={t('auth.availableCreditsTitle', {
                balance: `${user.consumerAvailable} / ${user.producerAvailable}`,
              })}
            >
              {t('auth.consumerCredits', {
                balance: formatCreditBalance(user.consumerAvailable),
              })}
              {' · '}
              {t('auth.producerCredits', {
                balance: formatCreditBalance(user.producerAvailable),
              })}
            </span>
            <button type="button" className={styles.rechargeButton} onClick={() => setRechargeOpen(true)}>
              {t('recharge.entry')}
            </button>
            <button type="button" className={styles.inviteButton} onClick={() => setReferralOpen(true)}>
              {t('referral.entry')}
            </button>
            <button type="button" onClick={() => setApiKeysOpen(true)}>
              {t('apiKeys.entry')}
            </button>
            <button type="button" onClick={onLogout}>
              {t('auth.logout')}
            </button>
          </div>
        ) : (
          <Link className={styles.loginLink} href="/login">
            {t('auth.loginRegister')}
          </Link>
        )}
        {user ? <MessageBox userId={user.id} /> : null}
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('settings.title')}
          title={t('settings.title')}
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
      </div>

      <div className={styles.tabs}>
        <div
          className={`${styles.tab} ${tab === 'consumer' ? styles.activeTab : ''}`}
          onClick={() => setTab('consumer')}
        >
          {t('tab.consumer')}
        </div>
        <div
          className={`${styles.tab} ${tab === 'producer' ? styles.activeTab : ''}`}
          onClick={() => setTab('producer')}
        >
          {t('tab.producer')}
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.content}>
          {!status ? (
            <div className="card">
              <p className="muted">{t('app.connecting')}</p>
            </div>
          ) : tab === 'consumer' ? (
            <ConsumerInfo
              status={status}
              origin={`${signalUrl.replace(/\/+$/, '')}/api/v1/inference`}
              discover={discover}
              currentUserId={user?.id ?? ''}
              apiKeys={apiKeys}
              selectedApiKeyId={selectedApiKeyId}
              onSelectApiKey={setSelectedApiKeyId}
              apiKeysLoading={apiKeysLoading}
              apiKeysError={apiKeysError}
            />
          ) : (
            <ProducerForm status={status} onChanged={setStatus} notice={autoShareNotice} currentUserId={user?.id ?? ''} />
          )}
        </div>
      </div>

      <footer className={styles.footer}>
        <span>{t('footer.contact')}</span>
        <a href="mailto:fastenshare@qq.com">fastenshare@qq.com</a>
        <span aria-hidden="true">·</span>
        <a
          href="https://github.com/fasten-share/fasten-share-client/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('footer.reportIssue')}
        </a>
      </footer>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          lang={lang}
          setLang={setLang}
          autoShare={autoShare}
          setAutoShare={setAutoShare}
        />
      )}
      {referralOpen && <ReferralModal onClose={() => setReferralOpen(false)} />}
      {apiKeysOpen && (
        <ApiKeyModal
          apiKeys={apiKeys}
          onChange={updateApiKeys}
          onClose={() => setApiKeysOpen(false)}
        />
      )}
      {rechargeOpen && (
        <RechargeModal
          onClose={() => setRechargeOpen(false)}
          onPaid={(nextUser) => setUser(nextUser)}
        />
      )}
    </div>
  );
}
