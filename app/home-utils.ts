import type { BackendInput, BackendView } from '@/lib/control-client';

export type Tab = 'consumer' | 'producer';

export const TAB_STORAGE_KEY = 'fs.tab';

const CREDIT_BALANCE_UNITS = ['', 'K', 'M', 'G', 'T', 'P', 'E'] as const;
const CREDIT_BALANCE_DECIMAL_SCALE = 100n;

export function formatCreditBalance(balance: string | null | undefined): string {
  const raw = balance?.trim();
  if (!raw) return '0';

  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return '0';

  const [, sign, integer, fraction = ''] = match;
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '');
  if (normalizedInteger === '0' && !/[1-9]/.test(fraction)) return '0';

  const hasFraction = /[1-9]/.test(fraction);
  const absoluteBalance = BigInt(normalizedInteger) + (sign === '-' && hasFraction ? 1n : 0n);
  let unitIndex = 0;
  let divisor = 1n;
  while (absoluteBalance >= divisor * 1_000n && unitIndex < CREDIT_BALANCE_UNITS.length - 1) {
    divisor *= 1_000n;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${sign}${absoluteBalance}`;
  }

  let scaled = (absoluteBalance * CREDIT_BALANCE_DECIMAL_SCALE + divisor / 2n) / divisor;
  if (scaled >= 1_000n * CREDIT_BALANCE_DECIMAL_SCALE && unitIndex < CREDIT_BALANCE_UNITS.length - 1) {
    divisor *= 1_000n;
    unitIndex += 1;
    scaled = (absoluteBalance * CREDIT_BALANCE_DECIMAL_SCALE + divisor / 2n) / divisor;
  }

  const whole = scaled / CREDIT_BALANCE_DECIMAL_SCALE;
  const decimals = (scaled % CREDIT_BALANCE_DECIMAL_SCALE)
    .toString()
    .padStart(2, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}${decimals ? `.${decimals}` : ''}${CREDIT_BALANCE_UNITS[unitIndex]}`;
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
