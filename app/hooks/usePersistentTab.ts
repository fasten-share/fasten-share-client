'use client';

import { useCallback, useEffect, useState } from 'react';
import { TAB_STORAGE_KEY, type Tab } from '../home-utils';

export function usePersistentTab() {
  const [tab, setTabState] = useState<Tab>('consumer');
  useEffect(() => {
    const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
    if (saved === 'consumer' || saved === 'producer') window.queueMicrotask(() => setTabState(saved));
  }, []);
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    window.localStorage.setItem(TAB_STORAGE_KEY, next);
  }, []);
  return [tab, setTab] as const;
}
