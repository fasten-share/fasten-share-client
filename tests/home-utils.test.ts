import { describe, expect, it } from 'vitest';
import { formatCreditBalance } from '@/app/home-utils';

describe('credit balance formatting', () => {
  it('keeps balances below one thousand unchanged', () => {
    expect(formatCreditBalance('0')).toBe('0');
    expect(formatCreditBalance('999')).toBe('999');
    expect(formatCreditBalance('00042')).toBe('42');
  });

  it('uses compact thousand-based units with at most two decimal places', () => {
    expect(formatCreditBalance('1000')).toBe('1K');
    expect(formatCreditBalance('1200')).toBe('1.2K');
    expect(formatCreditBalance('12345')).toBe('12.34K');
    expect(formatCreditBalance('123456789')).toBe('123.45M');
  });

  it('floors values and never rounds up into the next unit', () => {
    expect(formatCreditBalance('999999')).toBe('999.99K');
    expect(formatCreditBalance('99997000000')).toBe('99.99G');
  });

  it('supports all units without converting large balances to Number', () => {
    expect(formatCreditBalance('1000000000')).toBe('1G');
    expect(formatCreditBalance('1000000000000')).toBe('1T');
    expect(formatCreditBalance('1000000000000000')).toBe('1P');
    expect(formatCreditBalance('1000000000000000000')).toBe('1E');
    expect(formatCreditBalance('9223372036854775807')).toBe('9.22E');
  });

  it('preserves the previous normalization and invalid-value behavior', () => {
    expect(formatCreditBalance('-1234.1')).toBe('-1.23K');
    expect(formatCreditBalance('12.9')).toBe('12');
    expect(formatCreditBalance(undefined)).toBe('0');
    expect(formatCreditBalance('not-a-balance')).toBe('0');
  });
});
