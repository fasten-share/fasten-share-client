import type { ToolId } from '../tool-support';
import type { Protocol } from '@fasten-share/contracts/producer';
export type { Candidate, Offering, Protocol } from '@fasten-share/contracts/producer';

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
  deviceId: string;
  deviceName: string;
  serverUrl: string;
  autoShare: boolean;
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
  checking: boolean;
  lastHealth?: { ok: boolean; reason?: string; at: number };
}

export interface ProducerStatus {
  running: boolean;
  registered: boolean;
  backends: BackendStatus[];
}
