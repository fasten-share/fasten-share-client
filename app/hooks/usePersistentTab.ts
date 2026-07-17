'use client';

import { useCallback, useEffect, useState } from 'react';
import { TAB_STORAGE_KEY, type Tab } from '../home-utils';

export function usePersistentTab(userId?: string) {
  const storageKey = userId ? `${TAB_STORAGE_KEY}.${userId}` : TAB_STORAGE_KEY;
  const [tab, setTabState] = useState<Tab>('consumer');
  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === 'consumer' || saved === 'producer') window.queueMicrotask(() => setTabState(saved));
  }, [storageKey]);
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    window.localStorage.setItem(storageKey, next);
  }, [storageKey]);
  return [tab, setTab] as const;
}
