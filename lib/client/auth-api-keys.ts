import { clearAccessToken, getAccessToken, toAuthError } from './auth-session';
import type { AuthError, ConsumerApiKeyDto, SystemMessageDto } from './auth-types';

export async function loadMessages(): Promise<SystemMessageDto[]> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/messages', {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as { messages?: SystemMessageDto[] };
  return data.messages ?? [];
}

export async function loadConsumerApiKeys(): Promise<ConsumerApiKeyDto[]> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/me/api-keys', {
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  const data = (await res.json()) as { apiKeys?: ConsumerApiKeyDto[] };
  return data.apiKeys ?? [];
}

export async function createConsumerApiKey(name: string): Promise<ConsumerApiKeyDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch('/api/me/api-keys', {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as ConsumerApiKeyDto;
}

export async function deleteConsumerApiKey(id: string): Promise<ConsumerApiKeyDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/me/api-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as ConsumerApiKeyDto;
}

export async function freezeConsumerApiKey(id: string): Promise<ConsumerApiKeyDto> {
  return setConsumerApiKeyFrozen(id, true);
}

export async function unfreezeConsumerApiKey(id: string): Promise<ConsumerApiKeyDto> {
  return setConsumerApiKeyFrozen(id, false);
}

async function setConsumerApiKeyFrozen(
  id: string,
  frozen: boolean,
): Promise<ConsumerApiKeyDto> {
  const token = getAccessToken();
  if (!token) throw { message: 'Missing bearer token.', status: 401 } satisfies AuthError;

  const res = await fetch(`/api/me/api-keys/${encodeURIComponent(id)}/freeze`, {
    method: frozen ? 'POST' : 'DELETE',
    cache: 'no-store',
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) clearAccessToken();
  if (!res.ok) throw await toAuthError(res);
  return (await res.json()) as ConsumerApiKeyDto;
}

