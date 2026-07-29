'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelWechatLogin,
  completeWechatRegistration,
  consumeAuthNotice,
  createWechatLoginSession,
  exchangeWechatLogin,
  replaceDevice,
  type WechatLoginSession,
} from '@/lib/client/auth';
import type { DeviceLimitResult } from '@/lib/client/auth-types';
import { useI18n } from '@/lib/i18n/context';
import { UserAgreementModal } from './UserAgreementModal';
import styles from './page.module.css';

const SESSION_STORAGE_KEY = 'fs.wechatLoginSession.v2';
const LEGACY_SESSION_STORAGE_KEY = 'fs.wechatLoginSession';
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
  sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as WechatLoginSession;
    if (
      !session.sessionId
      || !session.clientToken
      || !session.wxLogin
      || new Date(session.expiresAt).getTime() <= Date.now()
    ) {
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
  const initialized = useRef(false);
  const [inviteCode, setInviteCode] = useState(() => search.get('inviteCode') || '');
  const [error, setError] = useState(() => consumeAuthNotice());
  const [loading, setLoading] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [agreementRequired, setAgreementRequired] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [registrationRequired, setRegistrationRequired] = useState(false);
  const [finishingRegistration, setFinishingRegistration] = useState(false);
  const [session, setSession] = useState<WechatLoginSession | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [deviceLimit, setDeviceLimit] = useState<DeviceLimitResult | null>(null);

  const clearSession = useCallback(async () => {
    const current = session;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
    if (current) await cancelWechatLogin(current.sessionId, current.clientToken).catch(() => undefined);
  }, [session]);

  const startSession = useCallback(async () => {
    setLoading(true);
    setError('');
    setAgreementRequired(false);
    setRegistrationRequired(false);
    setFinishingRegistration(false);
    setDeviceLimit(null);
    try {
      await clearSession();
      const created = await createWechatLoginSession({
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
  }, [clearSession, lang, search, t]);

  useEffect(() => {
    if (initialized.current) return;
    const timer = window.setTimeout(() => {
      if (initialized.current) return;
      initialized.current = true;
      const restored = readStoredSession();
      if (restored) setSession(restored);
      else void startSession();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [startSession]);

  useEffect(() => {
    if (!session) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session || registrationRequired || finishingRegistration || !scriptReady || !window.WxLogin) return;
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
  }, [finishingRegistration, registrationRequired, scriptReady, session]);

  useEffect(() => {
    if (!session || registrationRequired || deviceLimit) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await exchangeWechatLogin(session.sessionId, session.clientToken, agreementAccepted);
        if (stopped) return;
        if ('status' in result) {
          if (result.expiresAt && result.expiresAt !== session.expiresAt) {
            const updated = { ...session, expiresAt: result.expiresAt };
            sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
            setSession(updated);
          }
          if (result.status === 'registration_required') {
            setAgreementRequired(false);
            setRegistrationRequired(true);
            setFinishingRegistration(false);
            setError('');
            return;
          }
          if (result.status === 'agreement_required') {
            setAgreementRequired(true);
            if (!agreementAccepted) return;
          }
          timer = window.setTimeout(poll, POLL_MS);
          return;
        }
        if ('replacementToken' in result) {
          setDeviceLimit(result);
          return;
        }
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        router.push(safeNext(result.next || search.get('next')));
        router.refresh();
      } catch (err) {
        if (stopped) return;
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        setSession(null);
        setRegistrationRequired(false);
        setFinishingRegistration(false);
        setError(err instanceof Error ? err.message : t('login.failure'));
      }
    };
    void poll();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [agreementAccepted, deviceLimit, registrationRequired, router, search, session, t]);

  const onReplaceDevice = useCallback(async (deviceId: string) => {
    if (!deviceLimit) return;
    setLoading(true);
    setError('');
    try {
      const result = await replaceDevice(deviceLimit.replacementToken, deviceId);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      router.push(safeNext(result.next || search.get('next')));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failure'));
      setDeviceLimit(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [deviceLimit, router, search, t]);

  async function onRegistrationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!agreementAccepted) {
      setError(t('login.agreementRequired'));
      return;
    }
    if (!session) return;
    setLoading(true);
    try {
      await completeWechatRegistration(session.sessionId, session.clientToken, {
        agreementAccepted: true,
        inviteCode: inviteCode.trim() || undefined,
      });
      setRegistrationRequired(false);
      setFinishingRegistration(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failure'));
    } finally {
      setLoading(false);
    }
  }

  const agreementControl = (
    <div className={styles.agreement}>
      <input
        id="user-agreement"
        type="checkbox"
        checked={agreementAccepted}
        onChange={(event) => setAgreementAccepted(event.target.checked)}
      />
      <label htmlFor="user-agreement">{t('login.agreementPrefix')}</label>
      <button type="button" onClick={() => setAgreementOpen(true)}>{t('login.agreementLink')}</button>
    </div>
  );

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
        <h1>{registrationRequired ? t('login.registrationTitle') : t('login.wechatTitle')}</h1>
        <p className="muted">
          {registrationRequired ? t('login.registrationDescription') : t('login.wechatDescription')}
        </p>

        {deviceLimit ? (
          <div className={styles.qrStep}>
            <h2>设备数量已达上限</h2>
            <p className={styles.hint}>此账号最多可登录 {deviceLimit.maxDevices} 台设备，请选择一台设备下线。</p>
            <div className={styles.deviceList}>
              {deviceLimit.devices.map((device) => (
                <button key={device.deviceId} type="button" disabled={loading} onClick={() => void onReplaceDevice(device.deviceId)}>
                  <strong>{device.deviceName}</strong>
                  <span>{device.online ? '在线' : '离线'} · 节点 {device.nodeId.slice(0, 8)} · 最近在线 {new Date(device.lastSeenAt).toLocaleString()}</span>
                </button>
              ))}
            </div>
            {error && <div className={styles.error}>{error}</div>}
          </div>
        ) : registrationRequired ? (
          <form className={styles.form} onSubmit={onRegistrationSubmit}>
            <label>
              {t('login.inviteCode')}
              <input
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                placeholder={t('login.inviteCodePlaceholder')}
                maxLength={32}
                autoFocus
              />
            </label>
            <p className={styles.hint}>{t('login.inviteHint')}</p>
            {error && <div className={styles.error}>{error}</div>}
            {agreementControl}
            <button className={styles.submit} type="submit" disabled={loading || !agreementAccepted}>
              {loading ? t('login.registrationSubmitting') : t('login.registrationSubmit')}
            </button>
            <div className={styles.qrActions}>
              <button type="button" disabled={loading} onClick={() => void startSession()}>{t('login.restartScan')}</button>
            </div>
          </form>
        ) : (
          <div className={styles.qrStep}>
            {finishingRegistration ? (
              <div className={styles.qrPlaceholder}>{t('login.registrationFinishing')}</div>
            ) : session ? (
              <>
                <div id="wechat-login-container" className={styles.qrContainer} />
                {scriptFailed ? (
                  <a className={styles.fallback} href={session.authorizeUrl} target="_blank" rel="noreferrer">
                    {t('login.openWechat')}
                  </a>
                ) : null}
                <p className={remaining > 0 ? styles.hint : styles.expired}>
                  {remaining > 0 ? t('login.expiresIn', { seconds: remaining }) : t('login.expired')}
                </p>
              </>
            ) : (
              <div className={styles.qrPlaceholder}>{loading ? t('login.preparingQr') : t('login.qrUnavailable')}</div>
            )}
            {agreementRequired && !agreementAccepted ? <p className={styles.agreementPrompt}>{t('login.agreementPending')}</p> : null}
            {agreementControl}
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.qrActions}>
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
