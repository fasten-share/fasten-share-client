'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMe } from '@/lib/client/auth';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ConsumerInfo } from './components/ConsumerInfo';
import { ProducerForm } from './components/ProducerForm';
import { ProducerBridge } from './components/ProducerBridge';
import { RechargeModal } from './components/RechargeModal';
import { ReferralModal } from './components/ReferralModal';
import { WithdrawalModal } from './components/WithdrawalModal';
import { SettingsModal } from './components/SettingsModal';
import { MessageBox } from './components/MessageBox';
import { useI18n } from '@/lib/i18n/context';
import { formatCreditBalance } from './home-utils';
import { useHomeProducer } from './hooks/useHomeProducer';
import { useHomeSession } from './hooks/useHomeSession';
import { usePersistentTab } from './hooks/usePersistentTab';
import styles from './page.module.css';

export default function Home() {
  const { t, lang, setLang } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  const { user, setUser, apiKeys, selectedApiKeyId, setSelectedApiKeyId,
    apiKeysLoading, apiKeysError, authLoading, updateApiKeys, refreshUser, onLogout } = useHomeSession();
  const [tab, setTab] = usePersistentTab(user?.id);
  const { status, setStatus, signalUrl, setBridgeHandle, autoShareNotice,
    onStatus, setAutoShare, discover } = useHomeProducer();

  const closeAccountMenu = useCallback(() => {
    accountMenuRef.current?.removeAttribute('open');
  }, []);

  const openFromAccountMenu = useCallback(
    (open: () => void) => {
      closeAccountMenu();
      open();
    },
    [closeAccountMenu],
  );

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) closeAccountMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAccountMenu();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [closeAccountMenu]);

  const connected = status?.signaling.connected ?? false;

  return (
    <div className={styles.app}>
      {user && <ProducerBridge onStatus={onStatus} onHandle={setBridgeHandle} />}
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
          <div
            className={styles.accountPill}
            onClick={(event) => {
              // Dropdown actions are outside the clickable account summary area.
              if ((event.target as HTMLElement).closest(`.${styles.accountMenuPanel}`)) return;
              void refreshUser();
            }}
          >
            <span title={user.id}>{user.displayName || t('auth.userFallback', { id: user.id })}</span>
            <span
              className={styles.creditBalance}
              title={t('auth.availableCreditsTitle', {
                balance: `${user.consumerAvailable} / ${user.producerAvailable}`,
              })}
            >
              <span>
                {t('auth.consumerCredits', {
                  balance: formatCreditBalance(user.consumerAvailable),
                })}
              </span>
              <span>
                {t('auth.producerCredits', {
                  balance: formatCreditBalance(user.producerAvailable),
                })}
              </span>
            </span>
            <details className={styles.accountMenu} ref={accountMenuRef}>
              <summary aria-label={t('auth.accountMenu')} title={t('auth.accountMenu')}>⋯</summary>
              <div className={styles.accountMenuPanel}>
                <button type="button" onClick={() => openFromAccountMenu(() => setRechargeOpen(true))}>
                  {t('recharge.entry')}
                </button>
                <button type="button" onClick={() => openFromAccountMenu(() => setWithdrawalOpen(true))}>
                  {t('withdrawal.entry')}
                </button>
                <button type="button" onClick={() => openFromAccountMenu(() => setReferralOpen(true))}>
                  {t('referral.entry')}
                </button>
                <button type="button" onClick={() => openFromAccountMenu(() => setApiKeysOpen(true))}>
                  {t('apiKeys.entry')}
                </button>
                <div className={styles.accountMenuDivider} />
                <button type="button" className={styles.logoutMenuItem} onClick={() => void onLogout()}>
                  {t('auth.logout')}
                </button>
              </div>
            </details>
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
            <ProducerForm key={user?.id ?? ''} status={status} onChanged={setStatus} notice={autoShareNotice} />
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
          autoShare={status?.config.autoShare ?? true}
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
      {withdrawalOpen && user && (
        <WithdrawalModal
          user={user}
          onClose={() => setWithdrawalOpen(false)}
          onChanged={async () => { const next = await loadMe(); if (next) setUser(next); }}
        />
      )}
    </div>
  );
}
