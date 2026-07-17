import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { SERVICE_URL } from './service-url';

export const DATA_DIR = process.env.FS_DATA_DIR || join(homedir(), '.fasten-share');
const DEVICE_PATH = join(DATA_DIR, 'device.v2.json');

export interface DeviceConfig {
  deviceId: string;
  deviceName: string;
  serverUrl: string;
  lastActiveUserId?: string;
}

function writeAtomic(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, path);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function read(): DeviceConfig {
  try {
    const stored = JSON.parse(readFileSync(DEVICE_PATH, 'utf8')) as Partial<DeviceConfig>;
    if (typeof stored.deviceId === 'string' && stored.deviceId) {
      return {
        deviceId: stored.deviceId,
        deviceName: stored.deviceName || hostname().slice(0, 120) || 'Unknown device',
        serverUrl: SERVICE_URL,
        lastActiveUserId: stored.lastActiveUserId,
      };
    }
  } catch {}
  const fresh: DeviceConfig = {
    deviceId: randomUUID(),
    deviceName: hostname().slice(0, 120) || 'Unknown device',
    serverUrl: SERVICE_URL,
  };
  writeAtomic(DEVICE_PATH, fresh);
  return fresh;
}

let cache: DeviceConfig | undefined;

export const config = {
  all(): DeviceConfig { return (cache ??= read()); },
  setLastActiveUserId(userId?: string): void {
    const next = { ...this.all(), lastActiveUserId: userId };
    writeAtomic(DEVICE_PATH, next);
    cache = next;
  },
  setServerUrl(): void {},
};

export { writeAtomic };
