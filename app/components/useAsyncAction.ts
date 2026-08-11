'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirmDialog, type ConfirmDialogOptions } from './ConfirmDialogProvider';
import { useToast } from './ToastProvider';

/** Resolved eagerly from the call arguments so messages can name the subject. */
type Derived<A extends unknown[], T> = T | ((...args: A) => T);

export interface AsyncActionOptions<A extends unknown[], R> {
  /**
   * Guard shown before the work starts; declining resolves to `undefined`.
   * Returning `undefined` from the callback skips the gate, so an action can
   * confirm only its destructive direction (freeze, but not unfreeze).
   */
  confirm?: Derived<A, ConfirmDialogOptions | undefined>;
  /** Toast on success. Omit for actions whose result is already visible. */
  success?: Derived<A, string>;
  /**
   * Failure message. The thrown error's own message is appended so backend
   * detail is never swallowed, which is what the old inline hints did badly.
   */
  failure?: Derived<A, string>;
  /** Keep the message inline (field validation) instead of raising a toast. */
  inlineErrors?: boolean;
  onSuccess?: (result: R, ...args: A) => void;
}

export interface AsyncAction<A extends unknown[], R> {
  run: (...args: A) => Promise<R | undefined>;
  pending: boolean;
  error: string;
  clearError: () => void;
}

function resolve<A extends unknown[], T>(value: Derived<A, T>, args: A): T {
  return typeof value === 'function' ? (value as (...a: A) => T)(...args) : value;
}

/**
 * One place where "an operation ran" becomes user-visible feedback: a confirm
 * gate, a pending flag for the button, a success toast, and an error that is
 * either toasted or surfaced inline. Callers stop hand-rolling try/finally and
 * ad-hoc message state for every mutation.
 */
export function useAsyncAction<A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
  options: AsyncActionOptions<A, R> = {},
): AsyncAction<A, R> {
  const { showToast } = useToast();
  const { confirmAction } = useConfirmDialog();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  // Options are usually inline literals; a ref keeps `run` stable so callers can
  // safely list it in dependency arrays.
  const latest = useRef({ action, options });
  useEffect(() => {
    latest.current = { action, options };
  });

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    const { action: current, options: config } = latest.current;
    const gate = config.confirm ? resolve(config.confirm, args) : undefined;
    if (gate && !(await confirmAction(gate))) return undefined;
    if (alive.current) {
      setPending(true);
      setError('');
    }
    try {
      const result = await current(...args);
      if (config.success) showToast(resolve(config.success, args), { tone: 'success' });
      config.onSuccess?.(result, ...args);
      return result;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const prefix = config.failure ? resolve(config.failure, args) : '';
      const message = prefix && detail ? `${prefix} ${detail}` : prefix || detail;
      if (config.inlineErrors) {
        if (alive.current) setError(message);
      } else {
        showToast(message, { tone: 'error' });
      }
      return undefined;
    } finally {
      if (alive.current) setPending(false);
    }
  }, [confirmAction, showToast]);

  const clearError = useCallback(() => setError(''), []);

  return { run, pending, error, clearError };
}
