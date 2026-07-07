/**
 * Minimal typed event emitter — a browser-friendly replacement for Node's
 * `events.EventEmitter`. The whole client runs in the renderer, so we avoid
 * pulling Node builtins (or their webpack polyfills) into the bundle.
 */
type AnyListener = (...args: never[]) => void;

export class Emitter<E extends Record<string, AnyListener>> {
  private listeners = new Map<keyof E, Set<AnyListener>>();

  on<K extends keyof E>(event: K, listener: E[K]): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off<K extends keyof E>(event: K, listener: E[K]): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit<K extends keyof E>(event: K, ...args: Parameters<E[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy so a listener can safely unsubscribe during emit.
    for (const l of [...set]) (l as (...a: Parameters<E[K]>) => void)(...args);
  }
}
