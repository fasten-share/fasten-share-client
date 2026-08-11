// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from '../app/components/ConfirmDialogProvider';
import { ToastProvider } from '../app/components/ToastProvider';
import { useAsyncAction, type AsyncAction, type AsyncActionOptions } from '../app/components/useAsyncAction';
import { I18nProvider } from '../lib/i18n/context';

beforeEach(() => {
  // Opt in to act() support so the assertion on console.error below only sees
  // real React warnings, not environment complaints.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  window.localStorage.clear();
  document.body.replaceChildren();
});

/** Mounts the hook inside the real providers and hands the caller its API. */
async function mountAction<A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
  options: AsyncActionOptions<A, R> = {},
): Promise<{ current: () => AsyncAction<A, R>; unmount: () => Promise<void> }> {
  let latest: AsyncAction<A, R> | undefined;

  function Probe() {
    latest = useAsyncAction(action, options);
    return null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const wrap = (children: ReactNode) =>
    createElement(I18nProvider, null,
      createElement(ToastProvider, null,
        createElement(ConfirmDialogProvider, null, children)));

  await act(async () => {
    root.render(wrap(createElement(Probe)));
  });

  return {
    current: () => {
      if (!latest) throw new Error('hook did not render');
      return latest;
    },
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}

function toastText(): string {
  return Array.from(document.querySelectorAll('[role="status"], [role="alert"]'))
    .map((node) => node.textContent ?? '')
    .join('|');
}

describe('useAsyncAction', () => {
  it('runs the action and announces success', async () => {
    const action = vi.fn(async (id: string) => `done:${id}`);
    const onSuccess = vi.fn();
    const handle = await mountAction(action, { success: 'Saved.', onSuccess });

    let result: string | undefined;
    await act(async () => {
      result = await handle.current().run('a1');
    });

    expect(action).toHaveBeenCalledWith('a1');
    expect(result).toBe('done:a1');
    expect(onSuccess).toHaveBeenCalledWith('done:a1', 'a1');
    expect(toastText()).toContain('Saved.');
    expect(handle.current().pending).toBe(false);
    await handle.unmount();
  });

  it('derives messages from the call arguments', async () => {
    const handle = await mountAction(async (name: string) => name, {
      success: (name: string) => `Removed ${name}.`,
    });

    await act(async () => {
      await handle.current().run('backend-7');
    });

    expect(toastText()).toContain('Removed backend-7.');
    await handle.unmount();
  });

  it('reports pending while the action is in flight', async () => {
    let release: (() => void) | undefined;
    const handle = await mountAction(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    let running: Promise<unknown> | undefined;
    await act(async () => {
      running = handle.current().run();
    });
    expect(handle.current().pending).toBe(true);

    await act(async () => {
      release?.();
      await running;
    });
    expect(handle.current().pending).toBe(false);
    await handle.unmount();
  });

  it('toasts failures with the underlying error message appended', async () => {
    const handle = await mountAction(async () => {
      throw new Error('upstream refused');
    }, { failure: 'Could not save.' });

    let result: unknown = 'unset';
    await act(async () => {
      result = await handle.current().run();
    });

    expect(result).toBeUndefined();
    expect(toastText()).toContain('Could not save. upstream refused');
    expect(handle.current().error).toBe('');
    await handle.unmount();
  });

  it('keeps errors inline when asked, and clears them on demand', async () => {
    const handle = await mountAction(async () => {
      throw new Error('bad prefix');
    }, { failure: 'Invalid.', inlineErrors: true });

    await act(async () => {
      await handle.current().run();
    });

    expect(handle.current().error).toBe('Invalid. bad prefix');
    expect(toastText()).not.toContain('bad prefix');

    await act(async () => handle.current().clearError());
    expect(handle.current().error).toBe('');
    await handle.unmount();
  });

  it('skips the action when the confirm gate is declined', async () => {
    const action = vi.fn(async () => 'ran');
    const handle = await mountAction(action, {
      confirm: { message: 'Remove it?' },
      success: 'Removed.',
    });

    let result: Promise<string | undefined> | undefined;
    await act(async () => {
      result = handle.current().run();
    });
    expect(document.querySelector('dialog')?.textContent).toContain('Remove it?');

    await act(async () => {
      document.querySelector<HTMLButtonElement>('dialog button')?.click();
    });

    expect(await result).toBeUndefined();
    expect(action).not.toHaveBeenCalled();
    expect(toastText()).not.toContain('Removed.');
    await handle.unmount();
  });

  it('does not update state after unmount', async () => {
    let release: ((value: string) => void) | undefined;
    const handle = await mountAction(async () => new Promise<string>((resolve) => {
      release = resolve;
    }));

    let running: Promise<unknown> | undefined;
    await act(async () => {
      running = handle.current().run();
    });

    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
    await handle.unmount();
    await act(async () => {
      release?.('late');
      await running;
    });
    spy.mockRestore();

    expect(errors).toEqual([]);
  });
});
