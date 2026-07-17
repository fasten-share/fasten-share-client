import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UserDto } from '../client/auth-types';
import type { BackendConfig } from './types';
import { DATA_DIR, writeAtomic } from './config';

const ACCOUNTS_PATH = join(DATA_DIR, 'accounts.v2.json');
const PROFILES_DIR = join(DATA_DIR, 'profiles-v2');
export const MAX_ACTIVE_ACCOUNTS = 5;

export interface AccountProfile {
  version: 2;
  userId: string;
  autoShare: boolean;
  selectedTab: 'consumer' | 'producer';
  backends: BackendConfig[];
  user?: UserDto;
}

interface StoredAccount {
  user: UserDto;
  token: string;
  encryptionKey: string;
  lastUsedAt: number;
  state: 'active' | 'reauth-required';
}

interface EncryptedFile { version: 2; iv: string; tag: string; ciphertext: string }

function masterKey(): Buffer {
  const raw = process.env.FS_CREDENTIAL_KEY?.trim();
  if (raw) return createHash('sha256').update(raw).digest();
  const path = join(DATA_DIR, 'credential-key.v2');
  try { return Buffer.from(readFileSync(path, 'utf8').trim(), 'base64url'); } catch {
    mkdirSync(DATA_DIR, { recursive: true });
    const generated = randomBytes(32);
    writeFileSync(path, generated.toString('base64url'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(path, 0o600);
    console.warn('[accounts] FS_CREDENTIAL_KEY is unset; using a machine-local protected key file');
    return generated;
  }
}

function encrypt(value: unknown): EncryptedFile {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { version: 2, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}

function decrypt(value: EncryptedFile): StoredAccount[] {
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(value.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64url')), decipher.final(),
  ]).toString('utf8')) as StoredAccount[];
}

function readAccounts(): StoredAccount[] {
  if (!existsSync(ACCOUNTS_PATH)) return [];
  return decrypt(JSON.parse(readFileSync(ACCOUNTS_PATH, 'utf8')) as EncryptedFile);
}

let accounts = readAccounts();

function saveAccounts(): void { writeAtomic(ACCOUNTS_PATH, encrypt(accounts)); }
function validUserId(userId: string): void { if (!/^\d+$/.test(userId)) throw new Error('invalid user id'); }
function profilePath(userId: string): string { validUserId(userId); return join(PROFILES_DIR, `${userId}.json`); }

export const accountStore = {
  accounts(): ReadonlyArray<StoredAccount> { return accounts; },
  account(userId: string): StoredAccount | undefined { return accounts.find((item) => item.user.id === userId); },
  saveAccount(user: UserDto, token: string, encryptionKey: string): void {
    const current = this.account(user.id);
    if (!current && accounts.filter((item) => item.state === 'active').length >= MAX_ACTIVE_ACCOUNTS) {
      throw Object.assign(new Error('ACCOUNT_LIMIT_EXCEEDED'), { code: 'ACCOUNT_LIMIT_EXCEEDED' });
    }
    const next: StoredAccount = { user, token, encryptionKey, lastUsedAt: Date.now(), state: 'active' };
    accounts = [...accounts.filter((item) => item.user.id !== user.id), next];
    saveAccounts();
    this.saveProfile({ ...this.readProfile(user.id), user });
  },
  updateToken(userId: string, token: string): void {
    accounts = accounts.map((item) => item.user.id === userId ? { ...item, token } : item);
    saveAccounts();
  },
  requireReauth(userId: string): void {
    accounts = accounts.map((item) => item.user.id === userId ? { ...item, token: '', state: 'reauth-required' } : item);
    saveAccounts();
  },
  logout(userId: string): void {
    accounts = accounts.filter((item) => item.user.id !== userId);
    saveAccounts();
  },
  readProfile(userId: string): AccountProfile {
    try {
      const value = JSON.parse(readFileSync(profilePath(userId), 'utf8')) as AccountProfile;
      if (value.version === 2 && value.userId === userId) return value;
    } catch {}
    return { version: 2, userId, autoShare: true, selectedTab: 'consumer', backends: [] };
  },
  saveProfile(profile: AccountProfile): void {
    validUserId(profile.userId);
    mkdirSync(PROFILES_DIR, { recursive: true });
    writeAtomic(profilePath(profile.userId), profile);
  },
  deleteProfile(userId: string): void { rmSync(profilePath(userId), { force: true }); },
  profileUserIds(): string[] {
    try { return readdirSync(PROFILES_DIR).flatMap((name) => /^(\d+)\.json$/.exec(name)?.[1] ?? []); } catch { return []; }
  },
};
