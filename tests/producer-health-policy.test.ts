import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProducerDaemon } from '@/lib/server/producer';
import {
  ProducerRequestRouter,
  type BackendRequestResult,
} from '@/lib/server/producer-request-router';
import type { ProducerConnection, ProducerEvent } from '@/lib/server/producer-connection';
import type { BackendConfig, ProducerStatus } from '@/lib/server/types';

const backend: BackendConfig = {
  id: 'backend-a',
  baseUrl: 'https://api.example',
  apiKey: 'secret',
  protocol: 'openai',
  models: ['model-a'],
};

function connection(overrides: Partial<ProducerConnection> = {}): ProducerConnection {
  return {
    on: vi.fn(),
    off: vi.fn(),
    register: vi.fn(() => true),
    deregister: vi.fn(),
    heartbeat: vi.fn(),
    respond: vi.fn(() => true),
    respondChunk: vi.fn(async () => true),
    ...overrides,
  } as unknown as ProducerConnection;
}

type TestDaemon = {
  addBackend(backend: BackendConfig): void;
  status(): ProducerStatus;
  check(): Promise<void>;
  recordRequestResult(backendId: string, result: BackendRequestResult): void;
};

function request(requestId = 'request-1'): ProducerEvent {
  return {
    type: 'request.start',
    requestId,
    data: { protocol: 'openai', model: 'model-a', method: 'GET', path: '/v1/models' },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('producer adaptive health policy', () => {
  it('probes unknown and failed backends, but uses request counts while healthy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const daemon = new ProducerDaemon(connection()) as unknown as TestDaemon;

    daemon.addBackend(backend);
    await vi.waitFor(() => expect(daemon.status().backends[0]?.lastHealth?.ok).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await daemon.check();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(daemon.status().backends[0]?.lastHealth?.ok).toBe(true);

    daemon.recordRequestResult(backend.id, { ok: true });
    daemon.recordRequestResult(backend.id, { ok: false, reason: 'HTTP' });
    await daemon.check();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(daemon.status().backends[0]?.lastHealth?.ok).toBe(true);

    daemon.recordRequestResult(backend.id, { ok: false, reason: 'HTTP' });
    await daemon.check();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(daemon.status().backends[0]?.lastHealth?.ok).toBe(true);

    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    daemon.recordRequestResult(backend.id, { ok: false, reason: 'NETWORK' });
    await daemon.check();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(daemon.status().backends[0]?.lastHealth).toEqual(expect.objectContaining({ ok: false, reason: 'HTTP' }));

    await daemon.check();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(daemon.status().backends[0]?.lastHealth?.ok).toBe(true);
  });

  it('immediately marks authentication and quota responses unhealthy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    const daemon = new ProducerDaemon(connection()) as unknown as TestDaemon;
    daemon.addBackend(backend);
    await vi.waitFor(() => expect(daemon.status().backends[0]?.lastHealth?.ok).toBe(true));

    daemon.recordRequestResult(backend.id, { ok: false, reason: 'AUTH' });
    expect(daemon.status().backends[0]?.lastHealth).toEqual(expect.objectContaining({ ok: false, reason: 'AUTH' }));

    daemon.recordRequestResult(backend.id, { ok: false, reason: 'QUOTA' });
    expect(daemon.status().backends[0]?.lastHealth).toEqual(expect.objectContaining({ ok: false, reason: 'QUOTA' }));
  });
});

describe('producer request result tracking', () => {
  function router(onResult: (backendId: string, result: BackendRequestResult) => void, conn = connection()) {
    return new ProducerRequestRouter(conn, () => [backend], () => true, onResult);
  }

  it('records a completed 2xx response as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
    const onResult = vi.fn();
    router(onResult).handle(request());

    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(backend.id, { ok: true }));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 'HTTP'],
    [401, 'AUTH'],
    [403, 'AUTH'],
    [402, 'QUOTA'],
    [429, 'QUOTA'],
    [500, 'HTTP'],
  ] as const)('records HTTP %s as %s failure', async (status, reason) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    const onResult = vi.fn();
    router(onResult).handle(request(`request-${status}`));

    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(backend.id, { ok: false, reason }));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('records fetch and upstream response-stream failures', async () => {
    const onFetchFailure = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    router(onFetchFailure).handle(request('fetch-failure'));
    await vi.waitFor(() => expect(onFetchFailure).toHaveBeenCalledWith(backend.id, { ok: false, reason: 'NETWORK' }));

    const onStreamFailure = vi.fn();
    const body = new ReadableStream({ pull: () => { throw new Error('stream failed'); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    router(onStreamFailure).handle(request('stream-failure'));
    await vi.waitFor(() => expect(onStreamFailure).toHaveBeenCalledWith(backend.id, { ok: false, reason: 'NETWORK' }));
  });

  it('converts a Responses request and Chat Completions response at the producer exit', async () => {
    const chunks: string[] = [];
    const conn = connection({
      respondChunk: vi.fn(async (_requestId: string, chunk: Uint8Array) => {
        chunks.push(Buffer.from(chunk).toString());
        return true;
      }),
    });
    const convertedBackend = { ...backend, protocolConversions: ['openai-response'] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'chatcmpl-test',
      choices: [{ finish_reason: 'stop', message: { content: 'done' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onResult = vi.fn();
    const requestRouter = new ProducerRequestRouter(conn, () => [convertedBackend], () => true, onResult);
    requestRouter.handle({
      type: 'request.start',
      requestId: 'converted',
      data: { protocol: 'openai-response', model: 'model-a', method: 'POST', path: '/v1/responses' },
    });
    requestRouter.handle({
      type: 'request.chunk',
      requestId: 'converted',
      chunk: Buffer.from(JSON.stringify({ model: 'model-a', input: 'hello' })),
    });
    requestRouter.handle({ type: 'request.end', requestId: 'converted' });

    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(convertedBackend.id, { ok: true }));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(chunks.join(''))).toEqual(expect.objectContaining({
      object: 'response',
      status: 'completed',
      output: [expect.objectContaining({ type: 'message' })],
    }));
  });

  it('converts Chat Completions SSE into a Responses event stream', async () => {
    const chunks: string[] = [];
    const conn = connection({
      respondChunk: vi.fn(async (_requestId: string, chunk: Uint8Array) => {
        chunks.push(Buffer.from(chunk).toString());
        return true;
      }),
    });
    const convertedBackend = { ...backend, protocolConversions: ['openai-response'] };
    const upstream = [
      'data: {"id":"chatcmpl-stream","model":"model-a","choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const fetchMock = vi.fn().mockResolvedValue(new Response(upstream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onResult = vi.fn();
    const requestRouter = new ProducerRequestRouter(conn, () => [convertedBackend], () => true, onResult);
    requestRouter.handle({
      type: 'request.start',
      requestId: 'converted-stream',
      data: { protocol: 'openai-response', model: 'model-a', method: 'POST', path: '/v1/responses' },
    });
    requestRouter.handle({
      type: 'request.chunk',
      requestId: 'converted-stream',
      chunk: Buffer.from(JSON.stringify({ input: 'hello', stream: true, store: false })),
    });
    requestRouter.handle({ type: 'request.end', requestId: 'converted-stream' });

    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(convertedBackend.id, { ok: true }));
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody).toEqual(expect.objectContaining({
      stream: true,
      stream_options: { include_usage: true },
    }));
    const output = chunks.join('');
    expect(output).toContain('event: response.created');
    expect(output).toContain('event: response.output_text.delta');
    expect(output).toContain('event: response.completed');
    expect(output).toContain('"total_tokens":4');
  });

  it('does not count an invalid converted request as a backend failure', async () => {
    const convertedBackend = { ...backend, protocolConversions: ['openai-response'] };
    const onResult = vi.fn();
    const conn = connection();
    const requestRouter = new ProducerRequestRouter(conn, () => [convertedBackend], () => true, onResult);
    requestRouter.handle({
      type: 'request.start',
      requestId: 'invalid-converted',
      data: { protocol: 'openai-response', model: 'model-a', method: 'POST', path: '/v1/responses' },
    });
    requestRouter.handle({
      type: 'request.chunk',
      requestId: 'invalid-converted',
      chunk: Buffer.from('{'),
    });
    requestRouter.handle({ type: 'request.end', requestId: 'invalid-converted' });

    await vi.waitFor(() => expect(conn.respond).toHaveBeenCalledWith(expect.objectContaining({
      type: 'response.error',
      data: expect.objectContaining({ status: 400 }),
    })));
    expect(onResult).not.toHaveBeenCalled();
  });

  it('ignores consumer cancellation and downstream transport failures', async () => {
    const onCancelled = vi.fn();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const cancellationRouter = router(onCancelled);
    cancellationRouter.handle(request('cancelled'));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    cancellationRouter.handle({ type: 'request.cancel', requestId: 'cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCancelled).not.toHaveBeenCalled();

    const onDownstreamFailure = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
    const failedConnection = connection({ respond: vi.fn(() => false) as ProducerConnection['respond'] });
    router(onDownstreamFailure, failedConnection).handle(request('downstream-failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onDownstreamFailure).not.toHaveBeenCalled();
  });
});
