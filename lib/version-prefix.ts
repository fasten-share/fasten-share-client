import type { Protocol } from './server/types';

export const DEFAULT_VERSION_PREFIXES: Record<Protocol, string> = {
  openai: '/v1',
  'openai-response': '/v1',
  gemini: '/v1beta',
  anthropic: '/v1',
  'azure-openai': '/openai',
  ollama: '/v1',
};

/** Normalize a producer-advertised upstream version path prefix. */
export function normalizeVersionPrefix(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/[?#\\]/.test(trimmed)) return undefined;

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash === '/' ? '/' : withLeadingSlash.replace(/\/+$/, '');
  if (normalized === '/') return '/';
  const segments = normalized.slice(1).split('/');
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        !/^[A-Za-z0-9._~!$&'()*+,;=:@-]+$/.test(segment),
    )
  ) {
    return undefined;
  }

  return normalized;
}

export function defaultVersionPrefix(protocol: string): string {
  return DEFAULT_VERSION_PREFIXES[protocol as Protocol] ?? '/';
}

export function versionPrefixOrDefault(value: unknown, protocol: string): string {
  return normalizeVersionPrefix(value) ?? defaultVersionPrefix(protocol);
}
