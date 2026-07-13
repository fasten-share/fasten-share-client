import type { BackendConfig } from './types';
import { sanitizeHeaders } from './headers';
import { adapterFor } from './protocols';
import { normalizeMaxConcurrency } from '../concurrency';
import { ProducerConnection, type ProducerEvent } from './producer-connection';
import { joinUrl } from './producer-health';

const MAX_CHUNK_BYTES = 64 * 1024;
const MAX_CONCURRENCY_MESSAGE = 'This producer node has reached its maximum concurrency limit.';

export class ProducerRequestRouter {
  private readonly activeRequests = new Map<string, Set<symbol>>();
  private readonly inbound = new Map<string, { controller: ReadableStreamDefaultController<Uint8Array>; abort: AbortController }>();

  constructor(
    private readonly connection: ProducerConnection,
    private readonly candidates: () => Iterable<BackendConfig>,
    private readonly isAdvertised: (backendId: string) => boolean,
    private readonly onQuota: (backendId: string) => void,
  ) {}

  abortAll(reason: string): void {
    for (const active of this.inbound.values()) {
      active.abort.abort();
      try { active.controller.error(new Error(reason)); } catch { /* already closed */ }
    }
  }

  handle(event: ProducerEvent): void {
    if (event.type === 'request.start') {
      void this.start(event).catch((error: unknown) => this.connection.respond({
        type: 'response.error', requestId: event.requestId,
        data: { message: error instanceof Error ? error.message : String(error), code: 'UPSTREAM_ERROR', status: 502 },
      }));
    } else if (event.type === 'request.chunk' && event.chunk) {
      try { this.inbound.get(event.requestId)?.controller.enqueue(event.chunk); } catch { /* late chunk */ }
    } else if (event.type === 'request.end') {
      try { this.inbound.get(event.requestId)?.controller.close(); } catch { /* duplicate end */ }
    } else if (event.type === 'request.cancel') {
      const active = this.inbound.get(event.requestId);
      active?.abort.abort();
      try { active?.controller.error(new Error('request cancelled')); } catch { /* closed */ }
    }
  }

  private selectBackend(protocol: string, model: string): BackendConfig | undefined {
    const matching = [...this.candidates()].filter((backend) => backend.protocol === protocol && backend.enabled !== false && this.isAdvertised(backend.id));
    return model ? matching.find((backend) => backend.models.includes(model)) : matching.length === 1 ? matching[0] : undefined;
  }

  private acquire(backend: BackendConfig): symbol | undefined {
    const active = this.activeRequests.get(backend.id) ?? new Set<symbol>();
    if (active.size >= normalizeMaxConcurrency(backend.maxConcurrency)) return undefined;
    const token = Symbol(backend.id); active.add(token); this.activeRequests.set(backend.id, active); return token;
  }

  private release(backendId: string, token: symbol): void {
    const active = this.activeRequests.get(backendId);
    active?.delete(token);
    if (active?.size === 0) this.activeRequests.delete(backendId);
  }

  private async start(event: ProducerEvent): Promise<void> {
    const data = event.data ?? {};
    const protocol = String(data.protocol ?? ''); const model = String(data.model ?? '');
    const method = String(data.method ?? 'POST').toUpperCase(); const path = String(data.path ?? '/');
    const rawHeaders = data.headers && typeof data.headers === 'object' ? data.headers as Record<string, string> : {};
    const send = (type: string, extra: Record<string, unknown> = {}) => {
      if (!this.connection.respond({ type, requestId: event.requestId, ...extra })) throw new Error('server connection not open');
    };
    const backend = this.selectBackend(protocol, model);
    if (!backend) return send('response.error', { data: { message: `no backend for '${protocol}'/'${model}'`, code: 'BACKEND_NOT_FOUND' } });
    const adapter = adapterFor(backend.protocol); const headers = sanitizeHeaders(rawHeaders);
    for (const name of adapter.authHeaderNames) delete headers[name];
    for (const [name, value] of Object.entries(adapter.authHeaders(backend))) {
      if (name !== 'anthropic-version' || !headers['anthropic-version']) headers[name] = value;
    }
    const slot = this.acquire(backend);
    if (!slot) return send('response.error', { data: { message: MAX_CONCURRENCY_MESSAGE, code: 'PRODUCER_MAX_CONCURRENCY', status: 429 } });
    const abort = new AbortController(); let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (value) => { controller = value; } });
    this.inbound.set(event.requestId, { controller, abort });
    let responseStatus: number | undefined;
    try {
      const init: RequestInit & { duplex?: 'half' } = { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body, signal: abort.signal, duplex: 'half' };
      const response = await fetch(joinUrl(backend.baseUrl, path), init); responseStatus = response.status;
      const responseHeaders: Record<string, string> = {}; response.headers.forEach((value, name) => { responseHeaders[name] = value; });
      send('response.head', { data: { status: response.status, headers: sanitizeHeaders(responseHeaders) } });
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          for (let offset = 0; offset < value.length; offset += MAX_CHUNK_BYTES) {
            if (!await this.connection.respondChunk(event.requestId, value.subarray(offset, offset + MAX_CHUNK_BYTES))) throw new Error('server connection not open');
          }
        }
      }
      send('response.end');
    } catch (error) {
      if (!abort.signal.aborted) try { send('response.error', { data: { message: String((error as Error)?.message ?? error), code: 'UPSTREAM_ERROR' } }); } catch { /* socket closed */ }
    } finally {
      this.inbound.delete(event.requestId); this.release(backend.id, slot);
    }
    if (responseStatus === 402 || responseStatus === 429) this.onQuota(backend.id);
  }
}
