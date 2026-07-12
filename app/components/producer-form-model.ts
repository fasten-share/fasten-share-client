import type { BackendInput, BackendView } from '@/lib/control-client';
import { normalizeMaxConcurrency } from '@/lib/concurrency';
import { normalizeCostMultiplier } from '@/lib/cost';
import { normalizeSupportedTools, type ToolId } from '@/lib/tool-support';
import {
  defaultVersionPrefix,
  normalizeVersionPrefix,
  versionPrefixOrDefault,
} from '@/lib/version-prefix';

export const LOCAL_PRESET = 'http://localhost:11434';
export const ONLINE_PRESET = 'https://api.openai.com';
export const DISCLAIMER_ACCEPTED_KEY = 'fs.producerDisclaimerAccepted.v1';

export interface Draft {
  baseUrl: string;
  protocol: string;
  apiVersion: string;
  modelsText: string;
  costMultiplier: number;
  maxConcurrency: number;
  apiKey: string;
  supportedTools: ToolId[];
  versionPrefix: string;
}

export interface Card extends Draft {
  id: string;
  enabled: boolean;
}

export const emptyDraft = (): Draft => ({
  baseUrl: LOCAL_PRESET,
  protocol: 'openai',
  apiVersion: '',
  modelsText: '',
  costMultiplier: 1,
  maxConcurrency: 5,
  apiKey: '',
  supportedTools: ['curl'],
  versionPrefix: defaultVersionPrefix('openai'),
});

export function toCard(backend: BackendView): Card {
  return {
    id: backend.id,
    baseUrl: backend.baseUrl,
    protocol: backend.protocol,
    apiVersion: backend.apiVersion ?? '',
    modelsText: backend.models.join(', '),
    costMultiplier: normalizeCostMultiplier(backend.costMultiplier),
    maxConcurrency: normalizeMaxConcurrency(backend.maxConcurrency),
    apiKey: backend.apiKey ?? '',
    enabled: backend.enabled !== false,
    supportedTools: normalizeSupportedTools(backend.supportedTools, backend.protocol),
    versionPrefix: versionPrefixOrDefault(backend.versionPrefix, backend.protocol),
  };
}

export function parseModels(text: string): string[] {
  return text.split(/[,\n]/).map((model) => model.trim()).filter(Boolean);
}

export function toInput(card: Card): BackendInput {
  return {
    id: card.id,
    baseUrl: card.baseUrl.trim().replace(/\/+$/, ''),
    protocol: card.protocol.trim(),
    models: parseModels(card.modelsText),
    costMultiplier: normalizeCostMultiplier(card.costMultiplier),
    maxConcurrency: normalizeMaxConcurrency(card.maxConcurrency),
    apiKey: card.apiKey && card.apiKey !== '***' ? card.apiKey : undefined,
    apiVersion: card.protocol === 'azure-openai' ? card.apiVersion.trim() || undefined : undefined,
    enabled: card.enabled,
    supportedTools: normalizeSupportedTools(card.supportedTools, card.protocol),
    versionPrefix: normalizeVersionPrefix(card.versionPrefix) ?? card.versionPrefix.trim(),
  };
}
