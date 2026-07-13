import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  token: 'token' as string | null,
  clear: vi.fn(),
  toError: vi.fn(async (res: Response) => ({ message: 'request failed', status: res.status })),
}));
vi.mock('@/lib/client/auth-session', () => ({
  getAccessToken: () => mocks.token,
  clearAccessToken: mocks.clear,
  toAuthError: mocks.toError,
}));

import {
  createConsumerApiKey, deleteConsumerApiKey, freezeConsumerApiKey, loadConsumerApiKeys,
  loadMessages, unfreezeConsumerApiKey,
} from '@/lib/client/auth-api-keys';
import {
  followUser, loadFollowingUsers, loadFollowStatus, loadRatingStatuses, loadUserSummaries,
  rateUser, unfollowUser,
} from '@/lib/client/auth-social';
import {
  cancelWithdrawal, createInviteCode, createRechargeOrder, createWithdrawal, deleteInviteCode,
  getRechargeOrder, loadInviteCodes, loadReferralPayouts, loadReferrals, loadWithdrawals, syncRechargeOrder,
} from '@/lib/client/auth-commerce';

describe('authenticated API clients', () => {
  afterEach(() => {
    mocks.token = 'token';
    vi.unstubAllGlobals();
  });

  it('fails mutations that require login before fetching', async () => {
    mocks.token = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(createConsumerApiKey('name')).rejects.toEqual({ message: 'Missing bearer token.', status: 401 });
    await expect(followUser('u')).rejects.toEqual({ message: 'Missing bearer token.', status: 401 });
    await expect(createRechargeOrder(10)).rejects.toEqual({ message: 'Missing bearer token.', status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads message/key collections and defaults absent arrays', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'm' }] }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ apiKeys: [{ id: 'k' }] }))
      .mockResolvedValueOnce(Response.json({})));
    await expect(loadMessages()).resolves.toEqual([{ id: 'm' }]);
    await expect(loadMessages()).resolves.toEqual([]);
    await expect(loadConsumerApiKeys()).resolves.toEqual([{ id: 'k' }]);
    await expect(loadConsumerApiKeys()).resolves.toEqual([]);
  });

  it.each([
    ['create', () => createConsumerApiKey('name'), '/api/me/api-keys', 'POST'],
    ['delete', () => deleteConsumerApiKey('id/1'), '/api/me/api-keys/id%2F1', 'DELETE'],
    ['freeze', () => freezeConsumerApiKey('id/1'), '/api/me/api-keys/id%2F1/freeze', 'POST'],
    ['unfreeze', () => unfreezeConsumerApiKey('id/1'), '/api/me/api-keys/id%2F1/freeze', 'DELETE'],
  ])('%s API key calls the expected endpoint', async (_name, call, url, method) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'key' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(call()).resolves.toEqual({ id: 'key' });
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method }));
  });

  it('deduplicates user summary/rating requests and maps results by publisher', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ users: [{ userId: 'u1', username: 'one' }] }))
      .mockResolvedValueOnce(Response.json({ ratings: [{ publisherUserId: 'u1', rating: 5 }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await loadUserSummaries(['u1', '', 'u1'])).get('u1')).toMatchObject({ username: 'one' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ userIds: ['u1'] });
    expect((await loadRatingStatuses(['u1', 'u1'])).get('u1')).toMatchObject({ rating: 5 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ publisherUserIds: ['u1'] });
  });

  it('short-circuits anonymous social reads with stable defaults', async () => {
    mocks.token = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadUserSummaries(['u'])).resolves.toEqual(new Map());
    await expect(loadFollowStatus('u')).resolves.toBeNull();
    await expect(loadFollowingUsers(2, 5)).resolves.toEqual({ users: [], limit: 500, page: 2, pageSize: 5, total: 0 });
    await expect(loadRatingStatuses(['u'])).resolves.toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults partial following pages and invokes social mutations', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ total: 2 }))
      .mockImplementation(async () => Response.json({ following: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadFollowingUsers(3, 4)).resolves.toEqual({ users: [], limit: 500, page: 3, pageSize: 4, total: 2 });
    await followUser('u/1');
    await unfollowUser('u/1');
    await rateUser('u/1', 4);
    expect(fetchMock.mock.calls.slice(1).map(([url, init]) => [url, init.method])).toEqual([
      ['/api/social/follows/u%2F1', 'POST'], ['/api/social/follows/u%2F1', 'DELETE'], ['/api/social/ratings/u%2F1', 'POST'],
    ]);
  });

  it('clears the token and returns social defaults on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 401 })));
    await expect(loadFollowStatus('u')).resolves.toBeNull();
    expect(mocks.clear).toHaveBeenCalled();
  });

  it('covers commerce endpoints, URL encoding, query strings, and request bodies', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid' });
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await createWithdrawal({ amountCredits: '1', payoutAccount: 'a', payoutRecipientName: 'n' });
    await loadWithdrawals(2, 3);
    await cancelWithdrawal('w/1');
    await createRechargeOrder(5);
    await getRechargeOrder('trade/1');
    await syncRechargeOrder('trade/1');
    await createInviteCode({ expiresAt: null });
    await loadInviteCodes();
    await deleteInviteCode('invite/1');
    await loadReferrals();
    await loadReferralPayouts(10, 20);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/withdrawals', '/api/withdrawals?page=2&pageSize=3', '/api/withdrawals/w%2F1/cancel',
      '/api/credits/recharges', '/api/credits/recharges/trade%2F1', '/api/credits/recharges/trade%2F1/sync',
      '/api/me/invite-codes', '/api/me/invite-codes', '/api/me/invite-codes/invite%2F1',
      '/api/me/referrals', '/api/me/referrals/payouts?limit=10&offset=20',
    ]);
    expect(fetchMock.mock.calls[0][1].headers['idempotency-key']).toBe('uuid');
  });

  it('defaults absent invite and referral arrays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({})));
    await expect(loadInviteCodes()).resolves.toEqual([]);
    await expect(loadReferrals()).resolves.toEqual([]);
  });

  it('clears auth and surfaces normalized errors on failed authenticated calls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 401 })));
    await expect(loadConsumerApiKeys()).rejects.toEqual({ message: 'request failed', status: 401 });
    expect(mocks.clear).toHaveBeenCalled();
    expect(mocks.toError).toHaveBeenCalled();
  });
});
