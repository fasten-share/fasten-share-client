import type { BackendInput, BackendView } from '@/lib/control-client';

export type Tab = 'consumer' | 'producer';

export const TAB_STORAGE_KEY = 'fs.tab';

export function formatCreditBalance(balance: string | null | undefined): string {
  const raw = balance?.trim();
  if (!raw) return '0';

  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return '0';

  const [, sign, integer, fraction = ''] = match;
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '');
  if (normalizedInteger === '0' && !/[1-9]/.test(fraction)) return '0';
  if (sign === '-' && /[1-9]/.test(fraction)) {
    return `-${BigInt(normalizedInteger) + 1n}`;
  }

  return `${sign}${normalizedInteger}`;
}

export function prepareAutoShare(backends: BackendView[]): {
  backends: BackendInput[];
  duplicate?: string;
} {
  const offerings = new Set<string>();
  let duplicate: string | undefined;
  const preparedBackends = backends.map((backend) => {
    const protocol = backend.protocol.trim();
    const keys = backend.models.map((rawModel) => {
      const model = rawModel.trim();
      return { key: `${protocol}\0${model}`, offering: `${protocol}/${model}` };
    });
    const backendOfferings = new Set<string>();
    const conflict = keys.find(({ key }) => {
      if (offerings.has(key) || backendOfferings.has(key)) return true;
      backendOfferings.add(key);
      return false;
    });
    if (conflict) {
      duplicate ??= conflict.offering;
      return { ...backend, apiKey: undefined, enabled: false };
    }
    keys.forEach(({ key }) => offerings.add(key));
    return { ...backend, apiKey: undefined, enabled: true };
  });
  return { backends: preparedBackends, duplicate };
}
