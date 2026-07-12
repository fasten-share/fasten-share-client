'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import {
  cancelWechatLogin,
  consumeAuthNotice,
  createWechatLoginSession,
  exchangeWechatLogin,
  type WechatLoginSession,
} from '@/lib/client/auth';
import { useI18n } from '@/lib/i18n/context';
import { UserAgreementModal } from './UserAgreementModal';
import styles from './page.module.css';

const SESSION_STORAGE_KEY = 'fs.wechatLoginSession';
const POLL_MS = 1500;

declare global {
  interface Window {
    WxLogin?: new (options: {
      self_redirect: boolean;
      id: string;
      appid: string;
      scope: string;
      redirect_uri: string;
      state: string;
      stylelite: number;
      color_scheme: string;
      lang: string;
    }) => unknown;
  }
}

function readStoredSession(): WechatLoginSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as WechatLoginSession;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function safeNext(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function LoginContent() {
  const router = useRouter();
  const search = useSearchParams();
  const { lang, t } = useI18n();
  const [inviteCode, setInviteCode] = useState(() => search.get('inviteCode') || '');
  const [error, setError] = useState(() => consumeAuthNotice());
  const [loading, setLoading] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [session, setSession] = useState<WechatLoginSession | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const restored = readStoredSession();
      if (restored?.inviteCode) setInviteCode(restored.inviteCode);
      setSession(restored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!session) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session || !scriptReady || !window.WxLogin) return;
    const element = document.getElementById('wechat-login-container');
    if (element) element.replaceChildren();
    new window.WxLogin({
      self_redirect: session.wxLogin.selfRedirect,
      id: 'wechat-login-container',
      appid: session.wxLogin.appid,
      scope: session.wxLogin.scope,
      redirect_uri: session.wxLogin.redirectUri,
      state: session.wxLogin.state,
      stylelite: session.wxLogin.stylelite,
      color_scheme: session.wxLogin.colorScheme,
      lang: session.wxLogin.lang,
    });
  }, [scriptReady, session]);

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await exchangeWechatLogin(session.sessionId, session.clientToken);
        if (stopped) return;
        if (result) {
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
          router.push(safeNext(result.next || search.get('next')));
          router.refresh();
          return;
        }
      } catch (err) {
        if (stopped) return;
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        setSession(null);
        setError(err instanceof Error ? err.message : t('login.failure'));
        return;
      }
      timer = window.setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [router, search, session, t]);

  const clearSession = useCallback(async () => {
    const current = session;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
    if (current) await cancelWechatLogin(current.sessionId, current.clientToken).catch(() => undefined);
  }, [session]);

  const startSession = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await clearSession();
      const created = await createWechatLoginSession({
        agreementAccepted: true,
        inviteCode: inviteCode.trim() || undefined,
        next: safeNext(search.get('next')),
        lang: lang === 'zh' ? 'cn' : 'en',
      });
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(created));
      setSession(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failure'));
    } finally {
      setLoading(false);
    }
  }, [clearSession, inviteCode, lang, search, t]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!agreementAccepted) {
      setError(t('login.agreementRequired'));
      return;
    }
    await startSession();
  }

  return (
    <main className={styles.page}>
      <Script
        src="https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setScriptFailed(true)}
      />
      <section className={styles.card}>
        <div className={styles.kicker}>{t('login.kicker')}</div>
        <h1>{t('login.wechatTitle')}</h1>
        <p className="muted">{session ? t('login.scanDescription') : t('login.wechatDescription')}</p>

        {!session ? (
          <form className={styles.form} onSubmit={onSubmit}>
            <label>
              {t('login.inviteCode')}
              <input
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                placeholder={t('login.inviteCodePlaceholder')}
                maxLength={32}
              />
            </label>
            <p className={styles.hint}>{t('login.inviteHint')}</p>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.agreement}>
              <input id="user-agreement" type="checkbox" checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)} />
              <label htmlFor="user-agreement">{t('login.agreementPrefix')}</label>
              <button type="button" onClick={() => setAgreementOpen(true)}>{t('login.agreementLink')}</button>
            </div>
            <button className={styles.submit} type="submit" disabled={loading || !agreementAccepted}>
              {loading ? t('login.submitLoading') : t('login.wechatSubmit')}
            </button>
          </form>
        ) : (
          <div className={styles.qrStep}>
            <div id="wechat-login-container" className={styles.qrContainer} />
            {scriptFailed ? <a className={styles.fallback} href={session.authorizeUrl} target="_blank" rel="noreferrer">{t('login.openWechat')}</a> : null}
            <p className={remaining > 0 ? styles.hint : styles.expired}>
              {remaining > 0 ? t('login.expiresIn', { seconds: remaining }) : t('login.expired')}
            </p>
            <p className={styles.hint}>{t('login.inviteLocked', { code: session.inviteCode || t('login.noInvite') })}</p>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.qrActions}>
              <button type="button" onClick={() => void clearSession()}>{t('login.modifyInvite')}</button>
              <button type="button" disabled={loading} onClick={() => void startSession()}>{t('login.refreshQr')}</button>
            </div>
          </div>
        )}

        <p className={styles.privacy}>{t('login.profileNotice')}</p>
        <Link className={styles.back} href="/">{t('login.backHome')}</Link>
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
  return <Suspense fallback={<LoginFallback />}><LoginContent /></Suspense>;
}
