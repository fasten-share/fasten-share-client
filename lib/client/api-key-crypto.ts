'use client';

import { apiKeyAad, type EncryptedApiKey } from '../api-key-crypto-types';

const ENCRYPTION_KEY_STORAGE_KEY = 'fs.apiKeyEncryptionKey';

function decode(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

function encode(value: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(value));
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function getApiKeyEncryptionKey(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(ENCRYPTION_KEY_STORAGE_KEY);
}

export function setApiKeyEncryptionKey(key: string): void {
  window.localStorage.setItem(ENCRYPTION_KEY_STORAGE_KEY, key);
}

export function clearApiKeyEncryptionKey(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(ENCRYPTION_KEY_STORAGE_KEY);
}

async function cryptoKey(): Promise<CryptoKey> {
  const stored = getApiKeyEncryptionKey();
  if (!stored) throw new Error('missing API key encryption session');
  return window.crypto.subtle.importKey('raw', decode(stored), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptApiKeyForNode(apiKey: string, backendId: string): Promise<EncryptedApiKey> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(apiKeyAad(backendId, 'request')) },
    await cryptoKey(),
    new TextEncoder().encode(apiKey),
  );
  return { version: 1, iv: encode(iv.buffer), ciphertext: encode(ciphertext) };
}

export async function decryptApiKeyFromNode(encrypted: EncryptedApiKey, backendId: string): Promise<string> {
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(encrypted.iv), additionalData: new TextEncoder().encode(apiKeyAad(backendId, 'response')) },
    await cryptoKey(),
    decode(encrypted.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
