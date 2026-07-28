import type { Protocol } from './server/types';

const SUPPORTED = new Map<string, Protocol[]>([
  ['openai', ['openai-response']],
]);

export function normalizeProtocolConversions(value: unknown, sourceProtocol: string): Protocol[] {
  const allowed = SUPPORTED.get(sourceProtocol) ?? [];
  if (!Array.isArray(value)) return [];
  return allowed.filter((protocol) => value.includes(protocol));
}

export function convertsTo(value: unknown, sourceProtocol: string, targetProtocol: string): boolean {
  return normalizeProtocolConversions(value, sourceProtocol).includes(targetProtocol);
}
