import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserDto } from '@/lib/client/auth-types';

const directories: string[] = [];

function user(id: string): UserDto {
  return { id, displayName: `User ${id}` } as UserDto;
}

async function freshStore() {
  const directory = mkdtempSync(join(tmpdir(), 'fasten-accounts-'));
  directories.push(directory);
  process.env.FS_DATA_DIR = directory;
  process.env.FS_CREDENTIAL_KEY = 'test-only-master-key';
  vi.resetModules();
  return { directory, ...(await import('@/lib/server/account-store')) };
}

afterEach(() => {
  delete process.env.FS_DATA_DIR;
  delete process.env.FS_CREDENTIAL_KEY;
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('multi-account store', () => {
  it('encrypts credentials and keeps profiles isolated by user id', async () => {
    const { directory, accountStore } = await freshStore();
    accountStore.saveAccount(user('1'), 'secret-token-one', 'key-one');
    accountStore.saveProfile({ ...accountStore.readProfile('1'), backends: [{ id: 'a', baseUrl: 'http://a', protocol: 'openai', models: ['a'], apiKey: 'upstream-a' }] });
    accountStore.saveAccount(user('2'), 'secret-token-two', 'key-two');

    const encrypted = readFileSync(join(directory, 'accounts.v2.json'), 'utf8');
    expect(encrypted).not.toContain('secret-token-one');
    expect(encrypted).not.toContain('secret-token-two');
    expect(accountStore.readProfile('1').backends[0].apiKey).toBe('upstream-a');
    expect(accountStore.readProfile('2').backends).toEqual([]);
  });

  it('limits active credentials to five while preserving signed-out profiles', async () => {
    const { accountStore } = await freshStore();
    for (let id = 1; id <= 5; id += 1) accountStore.saveAccount(user(String(id)), `token-${id}`, `key-${id}`);
    expect(() => accountStore.saveAccount(user('6'), 'token-6', 'key-6')).toThrow('ACCOUNT_LIMIT_EXCEEDED');
    accountStore.logout('1');
    expect(accountStore.readProfile('1').user?.id).toBe('1');
    expect(() => accountStore.saveAccount(user('6'), 'token-6', 'key-6')).not.toThrow();
  });
});
