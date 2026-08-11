// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toTraySummary, useTrayStatus } from '../app/hooks/useTrayStatus';
import type { BackendHealth, BackendView, Status } from '../lib/control-client';

const control = vi.hoisted(() => vi.fn());
vi.mock('@/lib/control-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/control-client')>()),
  control,
}));

function backendView(overrides: Partial<BackendView> = {}): BackendView {
  return {
    id: 'b1', baseUrl: 'http://localhost:11434', protocol: 'openai',
    models: ['llama3'], apiKey: '', enabled: true, ...overrides,
  };
}

function backendHealth(overrides: Partial<BackendHealth> = {}): BackendHealth {
  return {
    id: 'b1', protocol: 'openai', models: ['llama3'],
    enabled: true, advertised: true, checking: false, ...overrides,
  };
}

function status(overrides: Partial<Status> = {}): Status {
  return {
    userId: 'u1',
    configRevision: 1,
    transport: { ready: true, wsPort: 8087 },
    signaling: { connected: true },
    producer: {
      running: true, registered: true, backends: [backendHealth()],
      traffic: { recent: [], buckets: [], totals: { success: 0, failure: 0, bytes: 0, since: 0 } },
    },
    config: { signalUrl: '', autoShare: true, backends: [backendView()] },
    connectedProducers: [],
    ...overrides,
  };
}

interface Bridge {
  sendTrayStatus: ReturnType<typeof vi.fn>;
  onTrayCommand: ReturnType<typeof vi.fn>;
}

let bridge: Bridge;
let emitCommand: (command: unknown) => void;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function installBridge(): void {
  emitCommand = () => {};
  bridge = {
    sendTrayStatus: vi.fn(),
    onTrayCommand: vi.fn((listener: (command: unknown) => void) => {
      emitCommand = listener;
      return () => { emitCommand = () => {}; };
    }),
  };
  (window as unknown as { fastenShareDesktop?: Bridge }).fastenShareDesktop = bridge;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installBridge();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  delete (window as unknown as { fastenShareDesktop?: Bridge }).fastenShareDesktop;
  vi.clearAllMocks();
  document.body.replaceChildren();
});

function Harness({ status: current, onChanged }: {
  status: Status | null; onChanged: (next: Status) => void;
}) {
  useTrayStatus(current, onChanged);
  return null;
}

async function render(current: Status | null, onChanged = vi.fn()): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { status: current, onChanged }));
  });
}

describe('toTraySummary', () => {
  it('describes a node that has nothing yet', () => {
    expect(toTraySummary(null)).toEqual({
      connected: false, sharing: 0, configured: 0, served: 0,
    });
  });

  it('counts only the backends actually on the air', () => {
    const summary = toTraySummary(status({
      producer: {
        running: true, registered: true,
        backends: [
          backendHealth({ id: 'b1', advertised: true }),
          backendHealth({ id: 'b2', advertised: false }),
        ],
        traffic: { recent: [], buckets: [], totals: { success: 7, failure: 2, bytes: 0, since: 0 } },
      },
      config: {
        signalUrl: '', autoShare: true,
        backends: [backendView({ id: 'b1' }), backendView({ id: 'b2' })],
      },
    }));
    expect(summary).toEqual({
      connected: true, sharing: 1, configured: 2, served: 7, failing: undefined,
    });
  });

  it('surfaces the reason a health check failed', () => {
    const summary = toTraySummary(status({
      producer: {
        running: true, registered: true,
        backends: [backendHealth({ lastHealth: { ok: false, reason: 'refused', at: 1 } })],
        traffic: { recent: [], buckets: [], totals: { success: 0, failure: 0, bytes: 0, since: 0 } },
      },
    }));
    expect(summary.failing).toBe('refused');
  });

  it('reports no failure when the health check passed', () => {
    const summary = toTraySummary(status({
      producer: {
        running: true, registered: true,
        backends: [backendHealth({ lastHealth: { ok: true, at: 1 } })],
        traffic: { recent: [], buckets: [], totals: { success: 0, failure: 0, bytes: 0, since: 0 } },
      },
    }));
    expect(summary.failing).toBeUndefined();
  });
});

describe('useTrayStatus', () => {
  it('reports the current state to the shell', async () => {
    await render(status());
    expect(bridge.sendTrayStatus).toHaveBeenCalledWith(
      expect.objectContaining({ connected: true, sharing: 1, configured: 1 }),
    );
  });

  it('sends nothing again while the summary is unchanged', async () => {
    const first = status();
    await render(first);
    expect(bridge.sendTrayStatus).toHaveBeenCalledTimes(1);

    // Status is pushed continuously; only real changes deserve an IPC hop,
    // and a repeat would re-trigger the tray's notifications.
    await render(status({ configRevision: 2 }));
    expect(bridge.sendTrayStatus).toHaveBeenCalledTimes(1);
  });

  it('sends again once something meaningful moves', async () => {
    await render(status());
    await render(status({
      producer: {
        running: true, registered: true, backends: [backendHealth({ advertised: false })],
        traffic: { recent: [], buckets: [], totals: { success: 0, failure: 0, bytes: 0, since: 0 } },
      },
    }));
    expect(bridge.sendTrayStatus).toHaveBeenCalledTimes(2);
    expect(bridge.sendTrayStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ sharing: 0 }),
    );
  });

  it('does nothing at all in a plain browser', async () => {
    delete (window as unknown as { fastenShareDesktop?: Bridge }).fastenShareDesktop;
    await render(status());
    expect(bridge.sendTrayStatus).not.toHaveBeenCalled();
  });

  it('stops the producer when the tray asks', async () => {
    const next = status();
    const onChanged = vi.fn();
    control.mockResolvedValueOnce(next);
    await render(status(), onChanged);

    await act(async () => emitCommand('stopSharing'));
    expect(control).toHaveBeenCalledWith({ action: 'stopProducer' });
    expect(onChanged).toHaveBeenCalledWith(next);
  });

  it('enables the disabled backends before starting', async () => {
    const onChanged = vi.fn();
    control.mockResolvedValue(status());
    await render(status({
      config: {
        signalUrl: '', autoShare: true,
        backends: [backendView({ id: 'b1', enabled: false }), backendView({ id: 'b2' })],
      },
    }), onChanged);

    await act(async () => emitCommand('startSharing'));
    // b2 is already enabled, so only b1 needs changing.
    expect(control).toHaveBeenCalledWith({ action: 'setBackendEnabled', id: 'b1', enabled: true });
    expect(control).not.toHaveBeenCalledWith({ action: 'setBackendEnabled', id: 'b2', enabled: true });
    expect(control).toHaveBeenCalledWith({ action: 'startProducer' });
  });

  it('does not try to start with nothing configured', async () => {
    await render(status({ config: { signalUrl: '', autoShare: true, backends: [] } }));
    await act(async () => emitCommand('startSharing'));
    expect(control).not.toHaveBeenCalled();
  });

  it('ignores a command it does not recognise', async () => {
    await render(status());
    await act(async () => emitCommand('selfDestruct'));
    expect(control).not.toHaveBeenCalled();
  });

  it('acts on the newest status, not the one from the first render', async () => {
    const onChanged = vi.fn();
    control.mockResolvedValue(status());
    await render(status({ config: { signalUrl: '', autoShare: true, backends: [] } }), onChanged);

    // The subscription is set up once; it must still see later props.
    await render(status({
      config: { signalUrl: '', autoShare: true, backends: [backendView({ id: 'b9', enabled: false })] },
    }), onChanged);

    await act(async () => emitCommand('startSharing'));
    expect(control).toHaveBeenCalledWith({ action: 'setBackendEnabled', id: 'b9', enabled: true });
  });

  it('subscribes once across re-renders', async () => {
    await render(status());
    await render(status({ configRevision: 2 }));
    await render(status({ configRevision: 3 }));
    expect(bridge.onTrayCommand).toHaveBeenCalledTimes(1);
  });

  it('keeps the page alive when a command fails', async () => {
    control.mockRejectedValueOnce(new Error('daemon unreachable'));
    const onChanged = vi.fn();
    await render(status(), onChanged);

    await act(async () => emitCommand('stopSharing'));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
