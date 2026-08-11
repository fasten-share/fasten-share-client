// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from '../app/components/ConfirmDialogProvider';
import { ToastProvider } from '../app/components/ToastProvider';
import { ProducerForm } from '../app/components/ProducerForm';
import { I18nProvider } from '../lib/i18n/context';
import type { BackendHealth, BackendView, Status } from '../lib/control-client';

const control = vi.hoisted(() => vi.fn());
vi.mock('@/lib/control-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/control-client')>()),
  control,
}));

function backendView(overrides: Partial<BackendView> = {}): BackendView {
  return {
    id: 'b1',
    baseUrl: 'http://localhost:11434',
    protocol: 'openai',
    models: ['llama3'],
    apiKey: '',
    enabled: true,
    ...overrides,
  };
}

function backendHealth(overrides: Partial<BackendHealth> = {}): BackendHealth {
  return {
    id: 'b1',
    protocol: 'openai',
    models: ['llama3'],
    enabled: false,
    advertised: false,
    checking: false,
    ...overrides,
  };
}

const emptyTraffic = () => ({
  recent: [],
  buckets: [],
  totals: { success: 0, failure: 0, bytes: 0, since: 0 },
});

function status(overrides: Partial<Status> = {}): Status {
  return {
    userId: 'u1',
    configRevision: 1,
    transport: { ready: true, wsPort: 8087 },
    signaling: { connected: true },
    producer: { running: true, registered: true, backends: [], traffic: emptyTraffic() },
    config: { signalUrl: '', autoShare: true, backends: [backendView()] },
    connectedProducers: [],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
  window.localStorage.setItem('fs.producerDisclaimerAccepted.v1', 'true');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  window.localStorage.clear();
  document.body.replaceChildren();
});

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(
      createElement(I18nProvider, null,
        createElement(ToastProvider, null,
          createElement(ConfirmDialogProvider, null, node))),
    );
  });
}

function toastText(): string {
  return Array.from(document.querySelectorAll('[role="status"], [role="alert"]'))
    .map((node) => node.textContent ?? '')
    .join('|');
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button'))
    .find((node) => node.textContent?.trim() === text);
}

describe('ProducerForm', () => {
  it('renders backends pushed from the server without a mirroring effect', async () => {
    await render(createElement(ProducerForm, { status: status(), onChanged: vi.fn() }));
    expect(container.textContent).toContain('openai/llama3');

    // A backend added on another device arrives purely as new props.
    const next = status({
      config: {
        signalUrl: '', autoShare: true,
        backends: [backendView(), backendView({ id: 'b2', models: ['mistral'] })],
      },
    });
    await render(createElement(ProducerForm, { status: next, onChanged: vi.fn() }));
    expect(container.textContent).toContain('openai/mistral');
  });

  it('keeps an unsaved edit while the server pushes an unrelated update', async () => {
    // Fields are locked while a backend is on the air, so edit a stopped one.
    const stopped = () => status({
      config: { signalUrl: '', autoShare: true, backends: [backendView({ enabled: false })] },
    });
    await render(createElement(ProducerForm, { status: stopped(), onChanged: vi.fn() }));

    const models = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(models?.value).toBe('llama3');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value',
      )?.set;
      setter?.call(models, 'llama3, phi3');
      models?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('llama3, phi3');

    // A push that does not touch this backend must not clobber the edit.
    await render(createElement(ProducerForm, {
      status: { ...stopped(), configRevision: 2 },
      onChanged: vi.fn(),
    }));
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('llama3, phi3');
  });

  it('confirms before removing a backend and reports the result', async () => {
    const onChanged = vi.fn();
    control.mockResolvedValueOnce(status({
      config: { signalUrl: '', autoShare: true, backends: [] },
    }));
    await render(createElement(ProducerForm, { status: status(), onChanged }));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Remove"]')?.click();
    });
    expect(document.querySelector('dialog')?.textContent).toContain('Remove backend');

    await act(async () => {
      document.querySelector<HTMLButtonElement>('dialog button[type="submit"]')?.click();
    });

    expect(control).toHaveBeenCalledWith({ action: 'removeBackend', id: 'b1' });
    expect(onChanged).toHaveBeenCalled();
    expect(toastText()).toContain('Backend removed.');
  });

  it('does not remove anything when the confirmation is declined', async () => {
    await render(createElement(ProducerForm, { status: status(), onChanged: vi.fn() }));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Remove"]')?.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('dialog button[type="button"]')?.click();
    });

    expect(control).not.toHaveBeenCalled();
    expect(container.textContent).toContain('openai/llama3');
  });

  it('announces a failed health gate once the daemon settles', async () => {
    control.mockResolvedValueOnce(status());
    await render(createElement(ProducerForm, { status: status(), onChanged: vi.fn() }));

    await act(async () => buttonByText('Save & start sharing')?.click());
    expect(control).toHaveBeenCalledWith(expect.objectContaining({ action: 'updateBackend' }));

    // The gate reports back through pushed status, not the click handler.
    await render(createElement(ProducerForm, {
      status: status({
        producer: {
          running: true,
          registered: true,
          backends: [backendHealth({
            checking: false,
            lastHealth: { ok: false, reason: 'refused', at: 1 },
          })],
          traffic: emptyTraffic(),
        },
      }),
      onChanged: vi.fn(),
    }));

    expect(toastText()).toContain('refused');
  });

  it('surfaces a backend taken off the air by the health gate', async () => {
    await render(createElement(ProducerForm, { status: status(), onChanged: vi.fn() }));

    await act(async () => {
      window.dispatchEvent(new CustomEvent('fs:backend-down', { detail: 'upstream gone' }));
    });

    expect(toastText()).toContain('upstream gone');
  });
});
