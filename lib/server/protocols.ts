/**
 * Per-protocol adapters. A backend's baseUrl excludes the API version path.
 * Health checks prepend the configured versionPrefix, while consumer requests
 * already carry their full upstream path. The protocol adapter owns:
 *   - which auth header carries the producer's credential, and
 *   - the minimal conversation request used to probe availability.
 * This module centralizes both so producer.ts stays protocol-neutral.
 */
import type { BackendConfig } from './types';

export const DEFAULT_AZURE_API_VERSION = '2024-10-21';
const ANTHROPIC_VERSION = '2023-06-01';

type Headers = Record<string, string>;
const HEALTH_PROMPT = 'Please just say "hi" to me';

export interface HealthRequest {
  path: string;
  headers: Headers;
  body: string;
}

export interface ProtocolAdapter {
  /** Inbound header names this scheme owns — stripped before injecting our own. */
  authHeaderNames: string[];
  /** Credential headers to inject when forwarding. `{}` when no apiKey is set. */
  authHeaders(cfg: BackendConfig): Headers;
  /** Minimal conversation request used to probe the backend's availability. */
  health(cfg: BackendConfig): HealthRequest;
}

/** Shared OpenAI-compatible shape: `Authorization: Bearer` + `/chat/completions`. */
const bearer: ProtocolAdapter = {
  authHeaderNames: ['authorization'],
  authHeaders: (cfg): Headers => (cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
  health: (cfg): HealthRequest => ({
    path: '/chat/completions',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.models[0],
      messages: [{ role: 'user', content: HEALTH_PROMPT }],
    }),
  }),
};

export const adapters: Record<string, ProtocolAdapter> = {
  openai: bearer,

  'openai-response': {
    authHeaderNames: ['authorization'],
    authHeaders: (cfg): Headers => (cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    health: (cfg): HealthRequest => ({
      path: '/responses',
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: cfg.models[0], input: HEALTH_PROMPT }),
    }),
  },

  ollama: {
    // Ollama is usually keyless locally; still forward a Bearer if one is set
    // (covers OpenAI-compatible gateways in front of it). Uses Ollama's
    // Uses Ollama's OpenAI-compatible endpoint.
    authHeaderNames: ['authorization'],
    authHeaders: (cfg): Headers => (cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    health: (cfg): HealthRequest => ({
      path: '/chat/completions',
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.models[0],
        messages: [{ role: 'user', content: HEALTH_PROMPT }],
      }),
    }),
  },

  anthropic: {
    authHeaderNames: ['x-api-key', 'authorization'],
    authHeaders: (cfg): Headers =>
      cfg.apiKey ? { 'x-api-key': cfg.apiKey, 'anthropic-version': ANTHROPIC_VERSION } : {},
    health: (cfg): HealthRequest => ({
      path: '/messages',
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: cfg.models[0],
        max_tokens: 5,
        messages: [{ role: 'user', content: HEALTH_PROMPT }],
      }),
    }),
  },

  gemini: {
    authHeaderNames: ['x-goog-api-key', 'authorization'],
    authHeaders: (cfg): Headers => (cfg.apiKey ? { 'x-goog-api-key': cfg.apiKey } : {}),
    health: (cfg): HealthRequest => ({
      path: `/models/${encodeURIComponent(cfg.models[0] ?? '')}:generateContent`,
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { 'x-goog-api-key': cfg.apiKey } : {}),
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: HEALTH_PROMPT }] }],
      }),
    }),
  },

  'azure-openai': {
    authHeaderNames: ['api-key', 'authorization'],
    authHeaders: (cfg): Headers => (cfg.apiKey ? { 'api-key': cfg.apiKey } : {}),
    health: (cfg): HealthRequest => {
      const ver = cfg.apiVersion || DEFAULT_AZURE_API_VERSION;
      return {
        path: `/deployments/${encodeURIComponent(cfg.models[0] ?? '')}/chat/completions?api-version=${encodeURIComponent(ver)}`,
        headers: {
          'content-type': 'application/json',
          ...(cfg.apiKey ? { 'api-key': cfg.apiKey } : {}),
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: HEALTH_PROMPT }],
        }),
      };
    },
  },
};

/** Adapter for a protocol; unknown protocols fall back to the OpenAI shape. */
export function adapterFor(protocol: string): ProtocolAdapter {
  return adapters[protocol] ?? adapters.openai;
}
