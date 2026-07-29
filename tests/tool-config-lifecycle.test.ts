import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const directories: string[] = [];
const originalOpenAiKey = process.env.OPENAI_API_KEY;

async function freshToolConfig() {
  const directory = mkdtempSync(join(tmpdir(), 'fasten-tool-config-'));
  const home = join(directory, 'home');
  const codexHome = join(home, '.codex');
  mkdirSync(codexHome, { recursive: true });
  directories.push(directory);
  process.env.FS_DATA_DIR = join(directory, 'data');
  process.env.CODEX_HOME = codexHome;
  vi.resetModules();
  vi.doMock('node:os', async (importOriginal) => ({
    ...await importOriginal<typeof import('node:os')>(),
    homedir: () => home,
    platform: () => 'linux',
  }));
  return {
    directory,
    home,
    codexHome,
    module: await import('@/lib/server/tool-config'),
  };
}

afterEach(() => {
  vi.doUnmock('node:os');
  vi.resetModules();
  delete process.env.FS_DATA_DIR;
  delete process.env.CODEX_HOME;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('tool configuration inspection and lifecycle', () => {
  it('detects and masks process conflicts, then cleans and restores them', async () => {
    process.env.OPENAI_API_KEY = 'sk-sensitive-value';
    const { module } = await freshToolConfig();

    const inspection = module.inspectToolConfig('codex');
    expect(inspection.clean).toBe(false);
    expect(inspection.environmentConflicts).toContainEqual(expect.objectContaining({
      name: 'OPENAI_API_KEY',
      value: 'sk***ue',
      removable: true,
    }));
    expect(() => module.configureTool({
      tool: 'codex',
      protocol: 'openai-response',
      model: 'gpt-test',
      baseUrl: 'https://share.example/v1',
    }, 'token')).toThrow('Remove all detected');

    const cleaned = module.cleanupToolConfig('codex');
    expect(cleaned.removedEnvironment).toEqual(['OPENAI_API_KEY']);
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(module.previewToolConfigRestore('codex', cleaned.backupId))
      .toEqual(expect.objectContaining({
        id: cleaned.backupId,
        environment: [{
          name: 'OPENAI_API_KEY',
          source: 'Fasten Share current process',
        }],
      }));

    module.restoreToolConfig('codex', cleaned.backupId);
    expect(process.env.OPENAI_API_KEY).toBe('sk-sensitive-value');
  });

  it('backs up existing files, lists the backup, and restores the original content', async () => {
    const { codexHome, module } = await freshToolConfig();
    const configPath = join(codexHome, 'config.toml');
    const authPath = join(codexHome, 'auth.json');
    writeFileSync(configPath, 'model = "original"\n');
    writeFileSync(authPath, '{"tokens":{"access_token":"oauth"}}\n');

    const cleaned = module.cleanupToolConfig('codex');
    expect(cleaned.removedConfigPaths).toEqual([configPath, authPath]);
    expect(cleaned.removedOAuth).toEqual(['OpenAI']);
    expect(module.listToolConfigBackups('codex')).toEqual([
      expect.objectContaining({ id: cleaned.backupId, tool: 'codex' }),
    ]);

    const configured = module.configureTool({
      tool: 'codex',
      protocol: 'openai-response',
      model: 'gpt-test',
      baseUrl: 'https://share.example/v1',
    }, 'fresh-token');
    expect(configured.clean).toBe(true);
    const written = readFileSync(configPath, 'utf8');
    expect(written).toContain('model = "gpt-test"');
    expect(written).toContain('Authorization = "Bearer fresh-token"');

    const restored = module.restoreToolConfig('codex', cleaned.backupId);
    expect(restored.clean).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe('model = "original"\n');
    expect(readFileSync(authPath, 'utf8')).toContain('access_token');
  });

  it('returns an empty cleanup result and rejects invalid or foreign backups', async () => {
    const { directory, module } = await freshToolConfig();
    expect(module.cleanupToolConfig('codex')).toEqual(expect.objectContaining({
      clean: true,
      removedConfigPaths: [],
      removedEnvironment: [],
      removedOAuth: [],
    }));
    expect(() => module.inspectToolConfig('curl')).toThrow('invalid configurable tool');
    expect(() => module.previewToolConfigRestore('codex', '../outside'))
      .toThrow('invalid backup id');

    const backupId = 'foreign-backup';
    const backupPath = join(directory, 'data', 'tool-config-backups', backupId);
    mkdirSync(backupPath, { recursive: true });
    writeFileSync(join(backupPath, 'manifest.json'), JSON.stringify({
      id: backupId,
      createdAt: new Date().toISOString(),
      tool: 'claude',
      files: [],
      environment: [],
    }));
    expect(() => module.restoreToolConfig('codex', backupId))
      .toThrow('backup does not belong to this tool');

    mkdirSync(join(directory, 'data', 'tool-config-backups', 'broken'), { recursive: true });
    writeFileSync(join(directory, 'data', 'tool-config-backups', 'broken', 'manifest.json'), '{');
    expect(module.listToolConfigBackups('codex')).toEqual([]);
  });
});
