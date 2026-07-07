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
  supportedTools?: Record<string, ToolId[]>;
  versionPrefixes?: Record<string, string>;
}

export interface Candidate {
  peerId: string;
  models: string[];
  protocol: Protocol;
  rttToServer: number;
  onlineMs: number;
  userId: string;
  costMultipliers?: Record<string, number>;
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
  maxConcurrency?: number;
  apiVersion?: string;
  enabled?: boolean;
  supportedTools?: ToolId[];
  versionPrefix?: string;
}

export interface NodeConfig {
  serverUrl: string;
  producerIds: Record<string, string>;
  producerIdsServerIssued: boolean;
  backendOwnerUserId?: string;
  backends: BackendConfig[];
}

export interface BackendStatus {
  id: string;
  protocol: Protocol;
  models: string[];
  costMultiplier: number;
  enabled: boolean;
  advertised: boolean;
  lastHealth?: { ok: boolean; reason?: string; at: number };
}

export interface ProducerStatus {
  running: boolean;
  registered: boolean;
  backends: BackendStatus[];
}
