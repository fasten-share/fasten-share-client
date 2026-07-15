const CREDITS_PER_FEN = 1_000n;
export const MIN_WITHDRAWAL_CREDITS = 20_000_000n;

export type WithdrawalValidationError =
  | 'amountRequired'
  | 'amountPositiveInteger'
  | 'amountMinimum'
  | 'amountIncrement'
  | 'amountExceedsBalance'
  | 'accountRequired'
  | 'accountTooLong'
  | 'accountInvalid'
  | 'recipientRequired'
  | 'recipientTooLong'
  | 'recipientInvalid';

export type WithdrawalEstimate = {
  amountYuan: string | null;
  validationError: Extract<WithdrawalValidationError, 'amountPositiveInteger' | 'amountIncrement'> | null;
};

export function estimateWithdrawalAmount(input: string): WithdrawalEstimate {
  const normalized = input.trim();
  if (!normalized) return { amountYuan: null, validationError: null };
  if (!/^\d+$/.test(normalized)) {
    return { amountYuan: null, validationError: 'amountPositiveInteger' };
  }

  const credits = BigInt(normalized);
  if (credits % CREDITS_PER_FEN !== 0n) {
    return { amountYuan: null, validationError: 'amountIncrement' };
  }

  const amountFen = credits / CREDITS_PER_FEN;
  return {
    amountYuan: `${amountFen / 100n}.${(amountFen % 100n).toString().padStart(2, '0')}`,
    validationError: null,
  };
}

export function validateWithdrawalInput(input: {
  amountCredits: string;
  availableCredits: string;
  payoutAccount: string;
  payoutRecipientName: string;
}): WithdrawalValidationError | null {
  const amount = input.amountCredits.trim();
  if (!amount) return 'amountRequired';
  if (!/^[1-9]\d*$/.test(amount)) return 'amountPositiveInteger';

  const credits = BigInt(amount);
  if (credits < MIN_WITHDRAWAL_CREDITS) return 'amountMinimum';
  if (credits % CREDITS_PER_FEN !== 0n) return 'amountIncrement';
  if (/^\d+$/.test(input.availableCredits) && credits > BigInt(input.availableCredits)) return 'amountExceedsBalance';

  const accountError = validateText(input.payoutAccount, 128, 'account');
  if (accountError) return accountError;
  return validateText(input.payoutRecipientName, 64, 'recipient');
}

function validateText(value: string, maxLength: number, field: 'account' | 'recipient'): WithdrawalValidationError | null {
  const normalized = value.trim();
  if (!normalized) return field === 'account' ? 'accountRequired' : 'recipientRequired';
  if (normalized.length > maxLength) return field === 'account' ? 'accountTooLong' : 'recipientTooLong';
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return field === 'account' ? 'accountInvalid' : 'recipientInvalid';
  return null;
}
