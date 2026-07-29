// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider, useConfirmDialog } from '../app/components/ConfirmDialogProvider';
import { I18nProvider } from '../lib/i18n/context';

beforeEach(() => {
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

describe('ConfirmDialogProvider', () => {
  it('resolves the selected action and restores focus', async () => {
    let confirmAction: ReturnType<typeof useConfirmDialog>['confirmAction'] | undefined;

    function Probe() {
      confirmAction = useConfirmDialog().confirmAction;
      return null;
    }

    const trigger = document.createElement('button');
    const container = document.createElement('div');
    document.body.append(trigger, container);
    trigger.focus();

    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(ConfirmDialogProvider, null, createElement(Probe))),
      );
    });

    let result: Promise<boolean> | undefined;
    await act(async () => {
      result = confirmAction?.({ message: 'Delete this key?', confirmLabel: 'Delete', tone: 'danger' });
    });

    const dialog = document.querySelector('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain('Delete this key?');
    expect(document.activeElement?.textContent).toBe('Cancel');

    const confirmButton = Array.from(dialog?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent === 'Delete');
    await act(async () => confirmButton?.click());
    await expect(result).resolves.toBe(true);
    expect(document.activeElement).toBe(trigger);

    await act(async () => root.unmount());
  });

  it('treats Escape as cancellation', async () => {
    let confirmAction: ReturnType<typeof useConfirmDialog>['confirmAction'] | undefined;
    function Probe() {
      confirmAction = useConfirmDialog().confirmAction;
      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(ConfirmDialogProvider, null, createElement(Probe))),
      );
    });

    let result: Promise<boolean> | undefined;
    await act(async () => {
      result = confirmAction?.({ message: 'Freeze this key?', tone: 'warning' });
    });
    await act(async () => {
      document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    });

    await expect(result).resolves.toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
    await act(async () => root.unmount());
  });
});
