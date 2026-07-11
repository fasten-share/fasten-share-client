'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { consumeAuthNotice, submitAuth } from '@/lib/client/auth';
import { useI18n } from '@/lib/i18n/context';
import { UserAgreementModal } from './UserAgreementModal';
import styles from './page.module.css';

type Mode = 'login' | 'register';

function LoginContent() {
  const router = useRouter();
  const search = useSearchParams();
  const { t } = useI18n();
  const initialMode: Mode = search.get('mode') === 'register' ? 'register' : 'login';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(() => search.get('inviteCode') || '');
  const [error, setError] = useState(() => consumeAuthNotice());
  const [loading, setLoading] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (!agreementAccepted) {
      setError(t('login.agreementRequired'));
      return;
    }
    setLoading(true);
    try {
      await submitAuth(mode, {
        email,
        password,
        agreementAccepted: true,
        displayName: mode === 'register' ? displayName : undefined,
        inviteCode: mode === 'register' ? inviteCode || undefined : undefined,
      });
      router.push(search.get('next') || '/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : (err as { message?: string }).message ?? t('login.failure'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.kicker}>{t('login.kicker')}</div>
        <h1>{mode === 'login' ? t('login.titleLogin') : t('login.titleRegister')}</h1>
        <p className="muted">{t('login.description')}</p>

        <div className={styles.switch} role="tablist" aria-label={t('login.switchAria')}>
          <button
            type="button"
            className={mode === 'login' ? styles.active : ''}
            onClick={() => setMode('login')}
          >
            {t('login.tabLogin')}
          </button>
          <button
            type="button"
            className={mode === 'register' ? styles.active : ''}
            onClick={() => setMode('register')}
          >
            {t('login.tabRegister')}
          </button>
        </div>

        <form className={styles.form} onSubmit={onSubmit}>
          {mode === 'register' && (
            <label>
              {t('login.displayName')}
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('login.displayNamePlaceholder')}
                maxLength={80}
              />
            </label>
          )}
          {mode === 'register' && (
            <label>
              {t('login.inviteCode')}
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder={t('login.inviteCodePlaceholder')}
                maxLength={16}
              />
            </label>
          )}
          <label>
            {t('login.email')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label>
            {t('login.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </label>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.submitRow}>
            <button className={styles.submit} type="submit" disabled={loading || !agreementAccepted}>
              {loading ? t('login.submitLoading') : mode === 'login' ? t('login.tabLogin') : t('login.createAccount')}
            </button>
            <div className={styles.agreement}>
              <input
                id="user-agreement"
                type="checkbox"
                checked={agreementAccepted}
                onChange={(event) => setAgreementAccepted(event.target.checked)}
              />
              <label htmlFor="user-agreement">{t('login.agreementPrefix')}</label>
              <button type="button" onClick={() => setAgreementOpen(true)}>
                {t('login.agreementLink')}
              </button>
            </div>
          </div>
        </form>

        <Link className={styles.back} href="/">
          {t('login.backHome')}
        </Link>
      </section>
      {agreementOpen ? <UserAgreementModal onClose={() => setAgreementOpen(false)} /> : null}
    </main>
  );
}

function LoginFallback() {
  const { t } = useI18n();
  return <main className={styles.page}>{t('login.loading')}</main>;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginContent />
    </Suspense>
  );
}
