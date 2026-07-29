'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useI18n } from '@/lib/i18n/context';
import styles from './ToastProvider.module.css';

type ToastTone = 'success' | 'info' | 'warning' | 'error';

interface ToastOptions {
  tone?: ToastTone;
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => number;
  dismissToast: (id: number) => void;
}

const DEFAULT_DURATION_MS = 4200;
const MAX_VISIBLE_TOASTS = 3;
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, options: ToastOptions = {}) => {
    const id = nextId.current++;
    const toast: ToastItem = {
      id,
      message,
      tone: options.tone ?? 'info',
      duration: options.duration ?? DEFAULT_DURATION_MS,
    };
    setToasts((current) => [...current.slice(-(MAX_VISIBLE_TOASTS - 1)), toast]);
    return id;
  }, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section className={styles.viewport} aria-label={t('toast.notifications')}>
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} dismiss={dismissToast} dismissLabel={t('toast.dismiss')} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}

function ToastCard({
  toast,
  dismiss,
  dismissLabel,
}: {
  toast: ToastItem;
  dismiss: (id: number) => void;
  dismissLabel: string;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.duration, toast.id]);

  const progressStyle = { animationDuration: `${toast.duration}ms` } as CSSProperties;
  const role = toast.tone === 'error' ? 'alert' : 'status';

  return (
    <div className={`${styles.toast} ${styles[toast.tone]}`} role={role}>
      <span className={styles.icon} aria-hidden="true"><ToneIcon tone={toast.tone} /></span>
      <p className={styles.message}>{toast.message}</p>
      <button
        type="button"
        className={styles.dismiss}
        aria-label={dismissLabel}
        onClick={() => dismiss(toast.id)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m8 8 8 8M16 8l-8 8" />
        </svg>
      </button>
      <span className={styles.progress} style={progressStyle} aria-hidden="true" />
    </div>
  );
}

function ToneIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') {
    return <svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg>;
  }
  if (tone === 'warning') {
    return <svg viewBox="0 0 24 24"><path d="M12 7.5v5.25M12 16.5h.01" /></svg>;
  }
  if (tone === 'error') {
    return <svg viewBox="0 0 24 24"><path d="m8 8 8 8M16 8l-8 8" /></svg>;
  }
  return <svg viewBox="0 0 24 24"><path d="M12 11v6M12 7h.01" /></svg>;
}
