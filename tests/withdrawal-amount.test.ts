import { describe, expect, it } from 'vitest';
import { estimateWithdrawalAmount, validateWithdrawalInput } from '@/lib/client/withdrawal-amount';

describe('withdrawal amount estimate', () => {
  it('converts credits to an exact yuan amount', () => {
    expect(estimateWithdrawalAmount('20000000')).toEqual({
      amountYuan: '200.00',
      validationError: null,
    });
    expect(estimateWithdrawalAmount('20123000')).toEqual({
      amountYuan: '201.23',
      validationError: null,
    });
  });

  it('uses bigint arithmetic for balances above the safe integer limit', () => {
    expect(estimateWithdrawalAmount('900719925474100000')).toEqual({
      amountYuan: '9007199254741.00',
      validationError: null,
    });
  });

  it('does not estimate malformed or sub-cent amounts', () => {
    expect(estimateWithdrawalAmount('')).toEqual({ amountYuan: null, validationError: null });
    expect(estimateWithdrawalAmount('12.5')).toEqual({ amountYuan: null, validationError: 'amountPositiveInteger' });
    expect(estimateWithdrawalAmount('1234')).toEqual({
      amountYuan: null,
      validationError: 'amountIncrement',
    });
  });

  it('validates all locally knowable submission rules before the request', () => {
    const valid = {
      amountCredits: '20000000', availableCredits: '30000000',
      payoutAccount: 'user@example.com', payoutRecipientName: '张三',
    };
    expect(validateWithdrawalInput(valid)).toBeNull();
    expect(validateWithdrawalInput({ ...valid, amountCredits: '' })).toBe('amountRequired');
    expect(validateWithdrawalInput({ ...valid, amountCredits: '0' })).toBe('amountPositiveInteger');
    expect(validateWithdrawalInput({ ...valid, amountCredits: '19999000' })).toBe('amountMinimum');
    expect(validateWithdrawalInput({ ...valid, amountCredits: '20000001' })).toBe('amountIncrement');
    expect(validateWithdrawalInput({ ...valid, amountCredits: '40000000' })).toBe('amountExceedsBalance');
    expect(validateWithdrawalInput({ ...valid, payoutAccount: ' ' })).toBe('accountRequired');
    expect(validateWithdrawalInput({ ...valid, payoutAccount: 'abc\n123' })).toBe('accountInvalid');
    expect(validateWithdrawalInput({ ...valid, payoutRecipientName: ' ' })).toBe('recipientRequired');
    expect(validateWithdrawalInput({ ...valid, payoutRecipientName: '张\u007f三' })).toBe('recipientInvalid');
  });
});
