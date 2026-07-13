import { authJson } from './auth-request';
import type { ConsumerApiKeyDto, SystemMessageDto } from './auth-types';

export async function loadMessages(): Promise<SystemMessageDto[]> {
  const data = await authJson<{ messages?: SystemMessageDto[] }>('/api/messages');
  return data.messages ?? [];
}

export async function loadConsumerApiKeys(): Promise<ConsumerApiKeyDto[]> {
  const data = await authJson<{ apiKeys?: ConsumerApiKeyDto[] }>('/api/me/api-keys');
  return data.apiKeys ?? [];
}

export async function createConsumerApiKey(name: string): Promise<ConsumerApiKeyDto> {
  return authJson<ConsumerApiKeyDto>('/api/me/api-keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteConsumerApiKey(id: string): Promise<ConsumerApiKeyDto> {
  return authJson<ConsumerApiKeyDto>(`/api/me/api-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
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
  return authJson<ConsumerApiKeyDto>(`/api/me/api-keys/${encodeURIComponent(id)}/freeze`, {
    method: frozen ? 'POST' : 'DELETE',
  });
}
