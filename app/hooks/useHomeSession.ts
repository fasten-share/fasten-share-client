'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  forceDeviceLogout,
  loadConsumerApiKeys,
  loadMe,
  logout,
  renewAccessTokenIfNeeded,
  setAuthNotice,
  startAccessTokenRenewal,
  type AuthError,
  type ConsumerApiKeyDto,
  type UserDto,
} from '@/lib/client/auth';
import { useI18n } from '@/lib/i18n/context';

const USER_REFRESH_INTERVAL_MS = 15 * 60_000;

export function useHomeSession() {
  const router = useRouter();
  const { t } = useI18n();
  const [user, setUser] = useState<UserDto | null>(null);
  const [apiKeys, setApiKeys] = useState<ConsumerApiKeyDto[]>([]);
  const [selectedApiKeyId, setSelectedApiKeyId] = useState('');
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeysError, setApiKeysError] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const refreshInFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    let stopRenewal: (() => void) | undefined;
    void (async () => {
      try {
        await renewAccessTokenIfNeeded();
      } catch (error) {
        if ((error as AuthError).status === 401 || (error as AuthError).status === 403) throw error;
      }
      return loadMe();
    })()
      .then((nextUser) => {
        if (!alive) return;
        setUser(nextUser);
        if (!nextUser) return router.replace('/login');
        stopRenewal = startAccessTokenRenewal((error) => {
          if (!alive) return;
          if (error?.status === 403) setAuthNotice(error.message);
          setUser(null);
          router.replace('/login');
        });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const authError = error as AuthError;
        if (authError.status === 403) setAuthNotice(authError.message);
        setUser(null);
        router.replace('/login');
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
    if (!user?.id) return;
    let alive = true;
    window.queueMicrotask(() => {
      if (!alive) return;
      setApiKeysLoading(true);
      setApiKeysError('');
    });
    void loadConsumerApiKeys()
      .then((keys) => {
        if (!alive) return;
        setApiKeys(keys);
        setSelectedApiKeyId((current) => selectedKey(current, keys));
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
    return () => { alive = false; };
  }, [t, user?.id]);

  const updateApiKeys = useCallback((keys: ConsumerApiKeyDto[]) => {
    setApiKeys(keys);
    setApiKeysError('');
    setSelectedApiKeyId((current) => selectedKey(current, keys));
  }, []);

  const refreshUser = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const next = await loadMe();
      if (next) setUser(next);
      else {
        setUser(null);
        router.replace('/login');
      }
    } catch {
      // Keep the last known balance when a background refresh fails temporarily.
    } finally {
      refreshInFlight.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (!user?.id) return;
    const timer = window.setInterval(() => void refreshUser(), USER_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshUser, user?.id]);

  useEffect(() => {
    const forced = () => {
      forceDeviceLogout();
      window.alert('该设备因账号设备节点超过数量上限，已退出登录。');
      router.replace('/login');
    };
    window.addEventListener('fs:forced-logout', forced);
    return () => window.removeEventListener('fs:forced-logout', forced);
  }, [router]);

  const onLogout = useCallback(async () => {
    await logout();
    setUser(null);
    setApiKeys([]);
    setSelectedApiKeyId('');
    router.replace('/login');
  }, [router]);

  return {
    user, setUser, apiKeys, selectedApiKeyId, setSelectedApiKeyId,
    apiKeysLoading, apiKeysError, authLoading, updateApiKeys, refreshUser, onLogout,
  };
}

function selectedKey(current: string, keys: ConsumerApiKeyDto[]): string {
  return keys.some((key) => key.id === current && !key.frozen)
    ? current
    : keys.find((key) => !key.frozen)?.id ?? '';
}
