import type { ToolId } from '../tool-support';

export type Protocol =
  | 'openai'
  | 'openai-response'
  | 'gemini'
  | 'anthropic'
  | 'azure-openai'
  | 'ollama'
  | string;

export interface Offering {
  protocol: Protocol;
  models: string[];
  costMultipliers?: Record<string, number>;
  /** Per-model free credit quota granted to each consumer. Absent model = 0. */
  freeCredits?: Record<string, number>;
  supportedTools?: Record<string, ToolId[]>;
  versionPrefixes?: Record<string, string>;
  maxConcurrency?: Record<string, number>;
}

export interface Candidate {
  peerId: string;
  models: string[];
  protocol: Protocol;
  rttToServer: number;
  onlineMs: number;
  userId: string;
  costMultipliers?: Record<string, number>;
  freeCredits?: Record<string, number>;
  creditThresholds?: Record<string, number>;
  creditThresholdMet?: Record<string, boolean>;
  supportedTools?: Record<string, ToolId[]>;
  versionPrefixes?: Record<string, string>;
}

export interface BackendConfig {
  id: string;
  baseUrl: string;
  apiKey?: string;
  protocol: Protocol;
  models: string[];
  costMultiplier?: number;
  /** Free credit quota per consumer for every model on this backend (credits). */
  freeCredits?: number;
  maxConcurrency?: number;
  apiVersion?: string;
  enabled?: boolean;
  supportedTools?: ToolId[];
  versionPrefix?: string;
  /** Additional consumer-facing protocols synthesized from this upstream. */
  protocolConversions?: Protocol[];
}

export interface BackendStatus {
  id: string;
  protocol: Protocol;
  models: string[];
  costMultiplier: number;
  enabled: boolean;
  advertised: boolean;
  checking: boolean;
  lastHealth?: { ok: boolean; reason?: string; at: number };
}

/** One served inference request, as shown in the live producer feed. */
export interface RequestSample {
  requestId: string;
  backendId: string;
  protocol: Protocol;
  model: string;
  /** Wall-clock finish time (ms since epoch). */
  at: number;
  /** End-to-end duration in ms. */
  durationMs: number;
  /** Response bytes streamed back to the consumer. */
  bytes: number;
  ok: boolean;
  /** Present when `ok` is false. */
  reason?: 'AUTH' | 'QUOTA' | 'HTTP' | 'NETWORK' | 'CANCELLED';
  /** HTTP status returned by the upstream, when one was received. */
  status?: number;
}

/** Per-minute rollup backing the producer sparkline. */
export interface TrafficBucket {
  /** Unix minute index (epoch ms / 60000). */
  minute: number;
  success: number;
  failure: number;
  bytes: number;
}

export interface ProducerTraffic {
  /** Newest first, capped. */
  recent: RequestSample[];
  buckets: TrafficBucket[];
  totals: { success: number; failure: number; bytes: number; since: number };
}

export interface ProducerStatus {
  running: boolean;
  registered: boolean;
  backends: BackendStatus[];
  traffic: ProducerTraffic;
}
