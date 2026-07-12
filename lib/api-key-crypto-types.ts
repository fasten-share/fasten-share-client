export interface EncryptedApiKey {
  version: 1;
  iv: string;
  ciphertext: string;
}

export const ENCRYPTION_SESSION_EXPIRED = 'ENCRYPTION_SESSION_EXPIRED';
export const INVALID_ENCRYPTED_API_KEY = 'INVALID_ENCRYPTED_API_KEY';

export function apiKeyAad(backendId: string, direction: 'request' | 'response'): string {
  return `fasten-share:producer-api-key:v1:${direction}:${backendId}`;
}
