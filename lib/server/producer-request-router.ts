import {
  AdapterError,
  ChatSseToResponses,
  convertChatResponse,
  convertResponsesRequest,
  type AdapterContext,
} from '../adapter/openai-responses-adapter';
import type { BackendConfig } from './types';
import { sanitizeHeaders } from './headers';
import { adapterFor } from './protocols';
import { normalizeMaxConcurrency } from '../concurrency';
import { convertsTo } from '../protocol-conversions';
import { versionPrefixOrDefault } from '../version-prefix';
import { ProducerConnection, type ProducerEvent } from './producer-connection';
import { joinUrl } from './producer-health';

const MAX_CHUNK_BYTES = 64 * 1024;
const MAX_ADAPTER_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_CONCURRENCY_MESSAGE = 'This producer node has reached its maximum concurrency limit.';

export type BackendRequestResult = {
  ok: boolean;
  reason?: 'AUTH' | 'QUOTA' | 'HTTP' | 'NETWORK';
};

class DownstreamError extends Error {}

type NativeInbound = {
  kind: 'native';
  controller: ReadableStreamDefaultController<Uint8Array>;
  abort: AbortController;
};

type ConvertedInbound = {
  kind: 'converted';
  abort: AbortController;
  backend: BackendConfig;
  model: string;
  slot: symbol;
  rawHeaders: Record<string, string>;
  chunks: Uint8Array[];
  bytes: number;
  ended: boolean;
};

type Inbound = NativeInbound | ConvertedInbound;

export class ProducerRequestRouter {
  private readonly activeRequests = new Map<string, Set<symbol>>();
  private readonly inbound = new Map<string, Inbound>();

  constructor(
    private readonly connection: ProducerConnection,
    private readonly candidates: () => Iterable<BackendConfig>,
    private readonly isAdvertised: (backendId: string) => boolean,
    private readonly onResult: (backendId: string, result: BackendRequestResult) => void,
  ) {}

  abortAll(reason: string): void {
    for (const [requestId, active] of this.inbound) {
      active.abort.abort();
      if (active.kind === 'native') {
        try { active.controller.error(new Error(reason)); } catch { /* already closed */ }
      } else {
        this.release(active.backend.id, active.slot);
      }
      this.inbound.delete(requestId);
    }
  }

  handle(event: ProducerEvent): void {
    if (event.type === 'request.start') {
      void this.start(event).catch((error: unknown) => this.sendError(event.requestId, error));
      return;
    }
    const active = this.inbound.get(event.requestId);
    if (!active) return;
    if (event.type === 'request.chunk' && event.chunk) {
      if (active.kind === 'native') {
        try { active.controller.enqueue(event.chunk); } catch { /* late chunk */ }
      } else if (!active.ended) {
        active.bytes += event.chunk.length;
        if (active.bytes > MAX_ADAPTER_REQUEST_BYTES) {
          active.ended = true;
          void this.failConverted(event.requestId, active, new AdapterError('Responses request body is too large.'));
        } else {
          active.chunks.push(event.chunk);
        }
      }
    } else if (event.type === 'request.end') {
      if (active.kind === 'native') {
        try { active.controller.close(); } catch { /* duplicate end */ }
      } else if (!active.ended) {
        active.ended = true;
        void this.forwardConverted(event.requestId, active);
      }
    } else if (event.type === 'request.cancel') {
      active.abort.abort();
      if (active.kind === 'native') {
        try { active.controller.error(new Error('request cancelled')); } catch { /* closed */ }
      } else {
        this.inbound.delete(event.requestId);
        this.release(active.backend.id, active.slot);
      }
    }
  }

  private selectBackend(protocol: string, model: string): { backend: BackendConfig; convert: boolean } | undefined {
    const available = [...this.candidates()].filter((backend) =>
      backend.enabled !== false && this.isAdvertised(backend.id));
    const pick = (matching: BackendConfig[]) => model
      ? matching.find((backend) => backend.models.includes(model))
      : matching.length === 1 ? matching[0] : undefined;
    const native = pick(available.filter((backend) => backend.protocol === protocol));
    if (native) return { backend: native, convert: false };
    const converted = pick(available.filter((backend) =>
      convertsTo(backend.protocolConversions, backend.protocol, protocol)));
    return converted ? { backend: converted, convert: true } : undefined;
  }

  private acquire(backend: BackendConfig): symbol | undefined {
    const active = this.activeRequests.get(backend.id) ?? new Set<symbol>();
    if (active.size >= normalizeMaxConcurrency(backend.maxConcurrency)) return undefined;
    const token = Symbol(backend.id);
    active.add(token);
    this.activeRequests.set(backend.id, active);
    return token;
  }

  private release(backendId: string, token: symbol): void {
    const active = this.activeRequests.get(backendId);
    active?.delete(token);
    if (active?.size === 0) this.activeRequests.delete(backendId);
  }

  private async start(event: ProducerEvent): Promise<void> {
    const data = event.data ?? {};
    const protocol = String(data.protocol ?? '');
    const model = String(data.model ?? '');
    const method = String(data.method ?? 'POST').toUpperCase();
    const path = String(data.path ?? '/');
    const rawHeaders = data.headers && typeof data.headers === 'object'
      ? data.headers as Record<string, string>
      : {};
    const selected = this.selectBackend(protocol, model);
    if (!selected) {
      this.respond({
        type: 'response.error',
        requestId: event.requestId,
        data: { message: `no backend for '${protocol}'/'${model}'`, code: 'BACKEND_NOT_FOUND', status: 404 },
      });
      return;
    }
    const slot = this.acquire(selected.backend);
    if (!slot) {
      this.respond({
        type: 'response.error',
        requestId: event.requestId,
        data: { message: MAX_CONCURRENCY_MESSAGE, code: 'PRODUCER_MAX_CONCURRENCY', status: 429 },
      });
      return;
    }
    if (selected.convert) {
      if (method !== 'POST' || !path.split('?')[0].replace(/\/+$/, '').endsWith('/responses')) {
        this.release(selected.backend.id, slot);
        throw new AdapterError('The converted protocol only accepts POST requests to /responses.');
      }
      this.inbound.set(event.requestId, {
        kind: 'converted',
        abort: new AbortController(),
        backend: selected.backend,
        model,
        slot,
        rawHeaders,
        chunks: [],
        bytes: 0,
        ended: false,
      });
      return;
    }
    await this.forwardNative(event.requestId, selected.backend, slot, method, path, rawHeaders);
  }

  private async forwardNative(
    requestId: string,
    backend: BackendConfig,
    slot: symbol,
    method: string,
    path: string,
    rawHeaders: Record<string, string>,
  ): Promise<void> {
    const adapter = adapterFor(backend.protocol);
    const headers = sanitizeHeaders(rawHeaders);
    for (const name of adapter.authHeaderNames) delete headers[name];
    for (const [name, value] of Object.entries(adapter.authHeaders(backend))) {
      if (name !== 'anthropic-version' || !headers['anthropic-version']) headers[name] = value;
    }
    const abort = new AbortController();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (value) => { controller = value; } });
    this.inbound.set(requestId, { kind: 'native', controller, abort });
    let recorded = false;
    const record = (result: BackendRequestResult) => {
      if (recorded) return;
      recorded = true;
      this.onResult(backend.id, result);
    };
    try {
      const init: RequestInit & { duplex?: 'half' } = {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        signal: abort.signal,
        duplex: 'half',
      };
      const response = await fetch(joinUrl(backend.baseUrl, path), init);
      if (!response.ok) record({ ok: false, reason: this.failureReason(response.status) });
      await this.streamRawResponse(requestId, response);
      if (response.ok) record({ ok: true });
    } catch (error) {
      if (!abort.signal.aborted && !(error instanceof DownstreamError)) record({ ok: false, reason: 'NETWORK' });
      if (!abort.signal.aborted) this.sendError(requestId, error);
    } finally {
      this.inbound.delete(requestId);
      this.release(backend.id, slot);
    }
  }

  private async forwardConverted(requestId: string, active: ConvertedInbound): Promise<void> {
    let recorded = false;
    const record = (result: BackendRequestResult) => {
      if (recorded) return;
      recorded = true;
      this.onResult(active.backend.id, result);
    };
    try {
      const rawBody = Buffer.concat(active.chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
      let input: unknown;
      try { input = JSON.parse(rawBody); } catch { throw new AdapterError('Responses request body must be valid JSON.'); }
      const selectedModel = active.backend.models.includes(active.model) ? active.model : active.backend.models[0];
      if (!selectedModel) throw new AdapterError('No model is configured for this backend.');
      const { body, context } = convertResponsesRequest(input, selectedModel);
      const adapter = adapterFor(active.backend.protocol);
      const headers = sanitizeHeaders(active.rawHeaders);
      for (const name of adapter.authHeaderNames) delete headers[name];
      Object.assign(headers, adapter.authHeaders(active.backend), {
        'content-type': 'application/json',
        'accept-encoding': 'identity',
      });
      const upstreamPath = joinVersionPath(
        versionPrefixOrDefault(active.backend.versionPrefix, active.backend.protocol),
        '/chat/completions',
      );
      const response = await fetch(joinUrl(active.backend.baseUrl, upstreamPath), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: active.abort.signal,
      });
      if (!response.ok) {
        record({ ok: false, reason: this.failureReason(response.status) });
        await this.streamRawResponse(requestId, response);
        return;
      }
      await this.streamConvertedResponse(requestId, response, context);
      record({ ok: true });
    } catch (error) {
      if (!active.abort.signal.aborted) {
        if (!(error instanceof AdapterError && error.status < 500) && !(error instanceof DownstreamError)) {
          record({ ok: false, reason: 'NETWORK' });
        }
        this.sendError(requestId, error);
      }
    } finally {
      this.inbound.delete(requestId);
      this.release(active.backend.id, active.slot);
    }
  }

  private async failConverted(requestId: string, active: ConvertedInbound, error: Error): Promise<void> {
    this.sendError(requestId, error);
    active.abort.abort();
    this.inbound.delete(requestId);
    this.release(active.backend.id, active.slot);
  }

  private async streamRawResponse(requestId: string, response: Response): Promise<void> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => { headers[name] = value; });
    this.respond({ type: 'response.head', requestId, data: { status: response.status, headers: sanitizeHeaders(headers) } });
    await this.streamBody(requestId, response.body);
    this.respond({ type: 'response.end', requestId });
  }

  private async streamConvertedResponse(requestId: string, response: Response, context: AdapterContext): Promise<void> {
    if (context.stream) {
      if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        throw new AdapterError(
          'Upstream did not return a Chat Completions event stream.',
          'RESPONSES_ADAPTER_UPSTREAM_PROTOCOL',
          502,
        );
      }
      this.respond({
        type: 'response.head',
        requestId,
        data: { status: response.status, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
      });
      const converter = new ChatSseToResponses(context);
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of converter.push(value)) await this.sendBytes(requestId, Buffer.from(event));
        }
      }
      for (const event of converter.finish()) await this.sendBytes(requestId, Buffer.from(event));
    } else {
      let json: unknown;
      try { json = await response.json(); } catch {
        throw new AdapterError(
          'Upstream returned invalid Chat Completions JSON.',
          'RESPONSES_ADAPTER_UPSTREAM_PROTOCOL',
          502,
        );
      }
      const converted = convertChatResponse(json, context);
      this.respond({
        type: 'response.head',
        requestId,
        data: { status: response.status, headers: { 'content-type': 'application/json' } },
      });
      await this.sendBytes(requestId, Buffer.from(JSON.stringify(converted)));
    }
    this.respond({ type: 'response.end', requestId });
  }

  private async streamBody(requestId: string, body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (!body) return;
    const reader = body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      await this.sendBytes(requestId, value);
    }
  }

  private async sendBytes(requestId: string, value: Uint8Array): Promise<void> {
    for (let offset = 0; offset < value.length; offset += MAX_CHUNK_BYTES) {
      if (!await this.connection.respondChunk(requestId, value.subarray(offset, offset + MAX_CHUNK_BYTES))) {
        throw new DownstreamError('server connection not open');
      }
    }
  }

  private respond(value: Record<string, unknown>): void {
    if (!this.connection.respond(value)) throw new DownstreamError('server connection not open');
  }

  private sendError(requestId: string, error: unknown): void {
    const adapterError = error instanceof AdapterError ? error : undefined;
    try {
      this.connection.respond({
        type: 'response.error',
        requestId,
        data: {
          message: error instanceof Error ? error.message : String(error),
          code: adapterError?.code ?? 'UPSTREAM_ERROR',
          status: adapterError?.status ?? 502,
        },
      });
    } catch { /* socket closed */ }
  }

  private failureReason(status: number): BackendRequestResult['reason'] {
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 402 || status === 429) return 'QUOTA';
    return 'HTTP';
  }
}

function joinVersionPath(prefix: string, endpoint: string): string {
  const left = prefix === '/' ? '' : prefix.replace(/\/+$/, '');
  return `${left}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}
