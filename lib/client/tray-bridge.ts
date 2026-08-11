/**
 * Client half of the desktop tray bridge.
 *
 * The same bundle also runs in a plain browser, where no bridge exists, so
 * every call here is best-effort and silent when the shell is absent.
 */

export interface TraySummary {
  connected: boolean;
  sharing: number;
  configured: number;
  served: number;
  failing?: string;
}

export type TrayCommand = 'startSharing' | 'stopSharing';

interface TrayBridge {
  sendTrayStatus?: (summary: TraySummary) => void;
  onTrayCommand?: (listener: (command: unknown) => void) => () => void;
}

type DesktopWindow = Window & { fastenShareDesktop?: TrayBridge };

function getBridge(): TrayBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as DesktopWindow).fastenShareDesktop;
}

export function isDesktopShell(): boolean {
  return typeof getBridge()?.sendTrayStatus === 'function';
}

export function sendTrayStatus(summary: TraySummary): void {
  try {
    getBridge()?.sendTrayStatus?.(summary);
  } catch {
    // A broken bridge must never take the page down with it.
  }
}

export function subscribeToTrayCommands(listener: (command: TrayCommand) => void): () => void {
  const subscribe = getBridge()?.onTrayCommand;
  if (!subscribe) return () => undefined;
  try {
    return subscribe((command) => {
      if (command === 'startSharing' || command === 'stopSharing') listener(command);
    });
  } catch {
    return () => undefined;
  }
}

export function sameSummary(left: TraySummary, right: TraySummary): boolean {
  return left.connected === right.connected
    && left.sharing === right.sharing
    && left.configured === right.configured
    && left.served === right.served
    && left.failing === right.failing;
}
