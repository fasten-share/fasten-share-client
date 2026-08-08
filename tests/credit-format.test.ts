import { describe, expect, it } from 'vitest';
import { formatCredits } from '@/app/components/consumer-utils';
import { formatCreditBalance } from '@/app/home-utils';

describe('formatCredits', () => {
  it('floors fractional values instead of rounding up', () => {
    expect(formatCredits(99.9)).toBe('99');
    expect(formatCredits(99.1)).toBe('99');
    expect(formatCredits(99.999)).toBe('99');
    expect(formatCredits(0.5)).toBe('0');
  });

  it('formats integers with thousands separators', () => {
    expect(formatCredits(99)).toBe('99');
    expect(formatCredits(1000)).toBe('1,000');
    expect(formatCredits(10_000)).toBe('10,000');
    expect(formatCredits(0)).toBe('0');
  });
});

describe('formatCreditBalance', () => {
  it('floors positive fractional balances', () => {
    expect(formatCreditBalance('99.9')).toBe('99');
    expect(formatCreditBalance('99.0')).toBe('99');
    expect(formatCreditBalance('0.5')).toBe('0');
    expect(formatCreditBalance('0.0')).toBe('0');
  });

  it('floors balances into compact units without rounding up', () => {
    expect(formatCreditBalance('99997000000')).toBe('99.99G');
    expect(formatCreditBalance('99900000000')).toBe('99.9G');
    expect(formatCreditBalance('0')).toBe('0');
  });

  it('floors negative fractional balances', () => {
    expect(formatCreditBalance('-99.9')).toBe('-100');
    expect(formatCreditBalance('-0.5')).toBe('-1');
  });

  it('returns 0 for empty or invalid input', () => {
    expect(formatCreditBalance(null)).toBe('0');
    expect(formatCreditBalance(undefined)).toBe('0');
    expect(formatCreditBalance('')).toBe('0');
    expect(formatCreditBalance('abc')).toBe('0');
  });
});
