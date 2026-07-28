import type { Protocol } from './server/types';

const SUPPORTED = new Map<string, readonly Protocol[]>([
  ['openai', ['openai-response']],
]);

export function protocolConversionTargets(sourceProtocol: string): Protocol[] {
  return [...(SUPPORTED.get(sourceProtocol) ?? [])];
}

export function normalizeProtocolConversions(value: unknown, sourceProtocol: string): Protocol[] {
  const allowed = protocolConversionTargets(sourceProtocol);
  if (!Array.isArray(value)) return [];
  return allowed.filter((protocol) => value.includes(protocol));
}

export function consumerToolProtocol(value: unknown, sourceProtocol: string): Protocol {
  return normalizeProtocolConversions(value, sourceProtocol)[0] ?? sourceProtocol;
}

export function convertsTo(value: unknown, sourceProtocol: string, targetProtocol: string): boolean {
  return normalizeProtocolConversions(value, sourceProtocol).includes(targetProtocol);
}
