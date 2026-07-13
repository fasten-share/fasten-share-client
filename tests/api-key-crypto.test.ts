// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiKeyAad } from '@/lib/api-key-crypto-types';
import { decryptApiKey, encryptApiKey, generateApiKeyEncryptionKey } from '@/lib/server/api-key-crypto';
import {
  clearApiKeyEncryptionKey,
  decryptApiKeyFromNode,
  encryptApiKeyForNode,
  getApiKeyEncryptionKey,
  setApiKeyEncryptionKey,
} from '@/lib/client/api-key-crypto';

beforeAll(() => Object.defineProperty(window, 'crypto', { configurable: true, value: webcrypto }));
beforeEach(() => localStorage.clear());

describe('API key encryption', () => {
  it('generates 256-bit base64url keys', () => {
    const first = generateApiKeyEncryptionKey();
    const second = generateApiKeyEncryptionKey();
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(first).not.toBe(second);
  });

  it('binds AAD to backend id and direction', () => {
    expect(apiKeyAad('backend', 'request')).not.toBe(apiKeyAad('backend', 'response'));
    expect(apiKeyAad('backend', 'request')).not.toBe(apiKeyAad('other', 'request'));
  });

  it('round trips server-side and rejects altered context or payload', () => {
    const key = generateApiKeyEncryptionKey();
    const encrypted = encryptApiKey('sk-secret-密钥', key, 'b1', 'request');
    expect(decryptApiKey(encrypted, key, 'b1', 'request')).toBe('sk-secret-密钥');
    expect(() => decryptApiKey(encrypted, key, 'b2', 'request')).toThrow();
    expect(() => decryptApiKey({ ...encrypted, version: 2 as 1 }, key, 'b1', 'request')).toThrow('unsupported');
    expect(() => decryptApiKey({ ...encrypted, iv: 'AA' }, key, 'b1', 'request')).toThrow('invalid');
  });

  it('is interoperable from browser request to Node server', async () => {
    const key = generateApiKeyEncryptionKey();
    setApiKeyEncryptionKey(key);
    const encrypted = await encryptApiKeyForNode('browser-secret', 'b1');
    expect(decryptApiKey(encrypted, key, 'b1', 'request')).toBe('browser-secret');
  });

  it('is interoperable from Node response to browser', async () => {
    const key = generateApiKeyEncryptionKey();
    setApiKeyEncryptionKey(key);
    const encrypted = encryptApiKey('node-secret', key, 'b1', 'response');
    await expect(decryptApiKeyFromNode(encrypted, 'b1')).resolves.toBe('node-secret');
    await expect(decryptApiKeyFromNode(encrypted, 'other')).rejects.toThrow();
  });

  it('stores and clears the browser encryption session', async () => {
    expect(getApiKeyEncryptionKey()).toBeNull();
    setApiKeyEncryptionKey('value');
    expect(getApiKeyEncryptionKey()).toBe('value');
    clearApiKeyEncryptionKey();
    expect(getApiKeyEncryptionKey()).toBeNull();
    await expect(encryptApiKeyForNode('x', 'b')).rejects.toThrow('missing API key encryption session');
  });
});
