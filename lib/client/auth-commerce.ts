import { authJson } from './auth-request';
import type {
  InviteCodeDto,
  RechargeOrder,
  ReferralDto,
  ReferralPayoutPageDto,
  WithdrawalDto,
  WithdrawalPageDto,
} from './auth-types';

export async function createWithdrawal(body: {
  amountCredits: string;
  payoutAccount: string;
  payoutRecipientName: string;
}): Promise<WithdrawalDto> {
  return authJson<WithdrawalDto>('/api/withdrawals', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

export async function loadWithdrawals(page = 1, pageSize = 20): Promise<WithdrawalPageDto> {
  return authJson<WithdrawalPageDto>(`/api/withdrawals?page=${page}&pageSize=${pageSize}`);
}

export async function cancelWithdrawal(id: string): Promise<WithdrawalDto> {
  return authJson<WithdrawalDto>(`/api/withdrawals/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });
}

export async function createRechargeOrder(amountYuan: number): Promise<RechargeOrder> {
  return authJson<RechargeOrder>('/api/credits/recharges', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountYuan }),
  });
}

export async function getRechargeOrder(outTradeNo: string): Promise<RechargeOrder> {
  return authJson<RechargeOrder>(`/api/credits/recharges/${encodeURIComponent(outTradeNo)}`);
}

export async function syncRechargeOrder(outTradeNo: string): Promise<RechargeOrder> {
  return authJson<RechargeOrder>(`/api/credits/recharges/${encodeURIComponent(outTradeNo)}/sync`, {
    method: 'POST',
  });
}

export async function createInviteCode(
  body: { expiresAt?: string | null } = {},
): Promise<InviteCodeDto> {
  return authJson<InviteCodeDto>('/api/me/invite-codes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function loadInviteCodes(): Promise<InviteCodeDto[]> {
  const data = await authJson<{ inviteCodes?: InviteCodeDto[] }>('/api/me/invite-codes');
  return data.inviteCodes ?? [];
}

export async function deleteInviteCode(code: string): Promise<InviteCodeDto> {
  return authJson<InviteCodeDto>(`/api/me/invite-codes/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  });
}

export async function loadReferrals(): Promise<ReferralDto[]> {
  const data = await authJson<{ referrals?: ReferralDto[] }>('/api/me/referrals');
  return data.referrals ?? [];
}

export async function loadReferralPayouts(
  limit = 30,
  offset = 0,
): Promise<ReferralPayoutPageDto> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return authJson<ReferralPayoutPageDto>(`/api/me/referrals/payouts?${params}`);
}
