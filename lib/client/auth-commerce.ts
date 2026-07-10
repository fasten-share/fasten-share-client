import { clearAccessToken, getAccessToken, toAuthError } from './auth-session';
import type {
  AuthError,
  InviteCodeDto,
  RechargeOrder,
  ReferralDto,
  ReferralPayoutPageDto,
} from './auth-types';

export async function createRechargeOrder(amountYuan: number): Promise<RechargeOrder> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/credits/recharges', {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ amountYuan }),
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as RechargeOrder;
}

export async function getRechargeOrder(outTradeNo: string): Promise<RechargeOrder> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/credits/recharges/${encodeURIComponent(outTradeNo)}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as RechargeOrder;
}

export async function syncRechargeOrder(outTradeNo: string): Promise<RechargeOrder> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/credits/recharges/${encodeURIComponent(outTradeNo)}/sync`, {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as RechargeOrder;
}


export async function createInviteCode(body: { expiresAt?: string | null } = {}): Promise<InviteCodeDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/me/invite-codes', {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as InviteCodeDto;
}

export async function loadInviteCodes(): Promise<InviteCodeDto[]> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/me/invite-codes', {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as { inviteCodes?: InviteCodeDto[] };
  return data.inviteCodes ?? [];
}

export async function deleteInviteCode(code: string): Promise<InviteCodeDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/me/invite-codes/${encodeURIComponent(code)}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as InviteCodeDto;
}

export async function loadReferrals(): Promise<ReferralDto[]> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/me/referrals', {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as { referrals?: ReferralDto[] };
  return data.referrals ?? [];
}

export async function loadReferralPayouts(limit = 30, offset = 0): Promise<ReferralPayoutPageDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const res = await fetch(`/api/me/referrals/payouts?${params}`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as ReferralPayoutPageDto;
}
