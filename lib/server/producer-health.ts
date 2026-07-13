import { normalizeCostMultiplier } from '../cost';
import { normalizeSupportedTools } from '../tool-support';
import { versionPrefixOrDefault } from '../version-prefix';
import { adapterFor } from './protocols';
import type { BackendConfig, Offering } from './types';
import { normalizeMaxConcurrency } from '../concurrency';

export type HealthResult = { ok: boolean; reason?: string };
const HEALTH_TIMEOUT_MS = 10_000;

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return base + normalizedPath;
}

function joinVersionPath(versionPrefix: string, endpointPath: string): string {
  const prefix = versionPrefix === '/' ? '' : versionPrefix.replace(/\/+$/, '');
  const endpoint = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  return `${prefix}${endpoint}`;
}

export async function probeHealth(config: BackendConfig): Promise<HealthResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const { path, headers, body } = adapterFor(config.protocol).health(config);
    const versionPrefix = versionPrefixOrDefault(config.versionPrefix, config.protocol);
    const response = await fetch(joinUrl(config.baseUrl, joinVersionPath(versionPrefix, path)), {
      method: 'POST', headers, body, signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'AUTH' };
    if (response.status === 402 || response.status === 429) return { ok: false, reason: 'QUOTA' };
    return response.ok ? { ok: true } : { ok: false, reason: 'HTTP' };
  } catch {
    return { ok: false, reason: 'NETWORK' };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildAdvertisedOfferings(
  backends: Iterable<BackendConfig>,
  advertise: ReadonlyMap<string, boolean>,
): Offering[] {
  const byProtocol = new Map<string, Omit<Offering, 'protocol'>>();
  for (const backend of backends) {
    if (backend.enabled === false || advertise.get(backend.id) !== true) continue;
    const entry = byProtocol.get(backend.protocol) ?? {
      models: [], costMultipliers: {}, supportedTools: {}, versionPrefixes: {}, maxConcurrency: {},
    };
    const multiplier = normalizeCostMultiplier(backend.costMultiplier);
    const tools = normalizeSupportedTools(backend.supportedTools, backend.protocol);
    for (const model of backend.models) {
      if (!entry.models.includes(model)) entry.models.push(model);
      entry.costMultipliers![model] ??= multiplier;
      entry.supportedTools![model] = normalizeSupportedTools(
        [...(entry.supportedTools?.[model] ?? []), ...tools], backend.protocol,
      );
      entry.versionPrefixes![model] ??= versionPrefixOrDefault(backend.versionPrefix, backend.protocol);
      entry.maxConcurrency![model] ??= normalizeMaxConcurrency(backend.maxConcurrency);
    }
    byProtocol.set(backend.protocol, entry);
  }
  return [...byProtocol].map(([protocol, offering]) => ({ protocol, ...offering }));
}
