import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { apiKeyAad, type EncryptedApiKey } from '../api-key-crypto-types';

const encode = (value: Buffer): string => value.toString('base64url');
const decode = (value: string): Buffer => Buffer.from(value, 'base64url');

export function generateApiKeyEncryptionKey(): string {
  return encode(randomBytes(32));
}

export function encryptApiKey(
  apiKey: string, encryptionKey: string, backendId: string, direction: 'request' | 'response',
): EncryptedApiKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', decode(encryptionKey), iv);
  cipher.setAAD(Buffer.from(apiKeyAad(backendId, direction), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { version: 1, iv: encode(iv), ciphertext: encode(ciphertext) };
}

export function decryptApiKey(
  encrypted: EncryptedApiKey, encryptionKey: string, backendId: string, direction: 'request' | 'response',
): string {
  if (encrypted.version !== 1) throw new Error('unsupported encrypted API key version');
  const iv = decode(encrypted.iv);
  const payload = decode(encrypted.ciphertext);
  if (iv.length !== 12 || payload.length < 16) throw new Error('invalid encrypted API key');
  const decipher = createDecipheriv('aes-256-gcm', decode(encryptionKey), iv);
  decipher.setAAD(Buffer.from(apiKeyAad(backendId, direction), 'utf8'));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  return Buffer.concat([decipher.update(payload.subarray(0, -16)), decipher.final()]).toString('utf8');
}
