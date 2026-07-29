'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '@/lib/i18n/context';
import styles from './ConfirmDialogProvider.module.css';

export type ConfirmDialogTone = 'primary' | 'warning' | 'danger';

export interface ConfirmDialogOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
}

interface ConfirmDialogContextValue {
  confirmAction: (options: ConfirmDialogOptions) => Promise<boolean>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [request, setRequest] = useState<ConfirmDialogOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  const confirmAction = useCallback((options: ConfirmDialogOptions) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setRequest(options);
  }), []);

  useEffect(() => () => {
    resolver.current?.(false);
    resolver.current = null;
  }, []);

  const value = useMemo(() => ({ confirmAction }), [confirmAction]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      {request ? (
        <ConfirmDialog
          options={request}
          defaultTitle={t('confirm.title')}
          defaultConfirmLabel={t('confirm.confirm')}
          defaultCancelLabel={t('confirm.cancel')}
          onResolve={settle}
        />
      ) : null}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog(): ConfirmDialogContextValue {
  const context = useContext(ConfirmDialogContext);
  if (!context) throw new Error('useConfirmDialog must be used within a ConfirmDialogProvider');
  return context;
}

function ConfirmDialog({
  options,
  defaultTitle,
  defaultConfirmLabel,
  defaultCancelLabel,
  onResolve,
}: {
  options: ConfirmDialogOptions;
  defaultTitle: string;
  defaultConfirmLabel: string;
  defaultCancelLabel: string;
  onResolve: (confirmed: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const tone = options.tone ?? 'primary';

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles[tone]}`}
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      onCancel={(event) => {
        event.preventDefault();
        onResolve(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onResolve(false);
      }}
    >
      <form
        method="dialog"
        className={styles.panel}
        onSubmit={(event) => {
          event.preventDefault();
          onResolve(true);
        }}
      >
        <div className={styles.heading}>
          <span className={styles.icon} aria-hidden="true"><ToneIcon tone={tone} /></span>
          <h2 id="confirm-dialog-title" className={styles.title}>{options.title ?? defaultTitle}</h2>
        </div>
        <p id="confirm-dialog-message" className={styles.message}>{options.message}</p>
        <div className={styles.actions}>
          <button ref={cancelRef} type="button" className={styles.cancel} onClick={() => onResolve(false)}>
            {options.cancelLabel ?? defaultCancelLabel}
          </button>
          <button type="submit" className={styles.confirm}>
            {options.confirmLabel ?? defaultConfirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function ToneIcon({ tone }: { tone: ConfirmDialogTone }) {
  if (tone === 'warning') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7.5v5.25" />
        <path d="M12 16.5h.01" />
      </svg>
    );
  }
  if (tone === 'danger') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m8 8 8 8M16 8l-8 8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6.5 12.5 3.5 3.5 7.5-8" />
    </svg>
  );
}
