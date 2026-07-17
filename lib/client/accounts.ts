import type { UserDto } from './auth-types';
import { setAccessToken } from './auth-session';
import { setApiKeyEncryptionKey } from './api-key-crypto';

export interface LocalAccount {
  user: UserDto;
  lastUsedAt: number;
  state: 'active' | 'reauth-required' | 'signed-out';
  running: boolean;
}

export async function loadLocalAccounts(): Promise<LocalAccount[]> {
  const response = await fetch('/api/accounts', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Account list failed (${response.status})`);
  return ((await response.json()) as { accounts: LocalAccount[] }).accounts;
}

export async function removeLocalAccount(userId: string): Promise<void> {
  const response = await fetch(`/api/accounts/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Account removal failed (${response.status})`);
}

export async function deleteLocalProfile(userId: string): Promise<void> {
  const response = await fetch(`/api/accounts/${encodeURIComponent(userId)}?profile=true`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Profile removal failed (${response.status})`);
}

export async function switchLocalAccount(userId: string): Promise<UserDto> {
  const response = await fetch(`/api/accounts/${encodeURIComponent(userId)}`, { method: 'POST' });
  if (!response.ok) throw Object.assign(new Error('ACCOUNT_REAUTH_REQUIRED'), { status: response.status });
  const data = await response.json() as { accessToken: string; encryptionKey: string; user: UserDto };
  setAccessToken(data.accessToken);
  setApiKeyEncryptionKey(data.encryptionKey);
  return data.user;
}
