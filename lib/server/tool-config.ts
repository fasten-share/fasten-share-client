import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import JSON5 from 'json5';
import { isToolId, type ToolId } from '../tool-support';
import { assertSupportedTarget, updateToolConfig } from './tool-config-adapters';
import type { BackupManifest, EnvironmentConflict, OAuthConflict, ToolConfigBackup, ToolConfigCleanupResult, ToolConfigInspection, ToolConfigResult, ToolConfigTarget } from './tool-config-types';
export type { ConfigFileInspection, EnvironmentConflict, OAuthConflict, ToolConfigBackup, ToolConfigCleanupResult, ToolConfigInspection, ToolConfigResult, ToolConfigTarget } from './tool-config-types';

const CONFLICTS: Record<ToolId, string[]> = {
  curl: [],
  claude: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'CLAUDE_CODE_SIMPLE'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  opencode: ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT'],
  claw: ['OPENAI_API_KEY', 'OPENAI_API_KEYS', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  hermes: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN', 'HERMES_API_MODE'],
};

const DATA_DIR = process.env.FS_DATA_DIR || join(homedir(), '.fasten-share');
const BACKUP_DIR = join(DATA_DIR, 'tool-config-backups');

function assertConfigurable(tool: unknown): asserts tool is Exclude<ToolId, 'curl'> {
  if (!isToolId(tool) || tool === 'curl') throw new Error('invalid configurable tool');
}

function configPaths(tool: Exclude<ToolId, 'curl'>): string[] {
  switch (tool) {
    case 'claude': return [join(homedir(), '.claude', 'settings.json'), join(homedir(), '.claude', '.credentials.json')];
    case 'codex': {
      const dir = process.env.CODEX_HOME || join(homedir(), '.codex');
      return [join(dir, 'config.toml'), join(dir, 'auth.json')];
    }
    case 'opencode': {
      const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
      const dataDir = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
      const defaultConfig = join(configDir, 'opencode', 'opencode.json');
      return [
        process.env.OPENCODE_CONFIG || defaultConfig,
        ...(process.env.OPENCODE_CONFIG ? [defaultConfig] : []),
        join(configDir, 'opencode', 'config.json'),
        join(configDir, 'opencode', 'opencode.jsonc'),
        join(dataDir, 'opencode', 'auth.json'),
      ];
    }
    case 'claw': {
      const dir = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw');
      const agentsDir = join(dir, 'agents');
      const profiles = existsSync(agentsDir)
        ? readdirSync(agentsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(agentsDir, entry.name, 'agent', 'auth-profiles.json'))
        : [];
      return [process.env.OPENCLAW_CONFIG_PATH || join(dir, 'openclaw.json'), ...profiles];
    }
    case 'hermes': {
      const dir = process.env.HERMES_HOME || join(homedir(), '.hermes');
      return [
        join(dir, 'config.yaml'), join(dir, '.env'), join(dir, 'auth.json'),
        join(homedir(), '.claude', '.credentials.json'),
        join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'),
      ];
    }
  }
}

function hasObjectKey(path: string, key: string): boolean {
  if (!existsSync(path)) return false;
  try { return Object.hasOwn(object(JSON5.parse(readFileSync(path, 'utf8'))), key); } catch { return false; }
}

function fileContainsOAuth(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const raw = readFileSync(path, 'utf8');
    return /["'](?:refresh_token|access_token|oauthAccount)["']\s*:|["'](?:type|auth_mode)["']\s*:\s*["']oauth/i.test(raw);
  } catch { return false; }
}

function oauthConflicts(tool: Exclude<ToolId, 'curl'>, paths: string[]): OAuthConflict[] {
  const existing = new Set(paths.filter(existsSync));
  if (tool === 'claude') {
    const credentialsPath = join(homedir(), '.claude', '.credentials.json');
    const metadataPath = join(homedir(), '.claude.json');
    return [
      ...(existing.has(credentialsPath) && fileContainsOAuth(credentialsPath) ? [{ id: 'claude-credentials', provider: 'Anthropic', source: credentialsPath, removable: true }] : []),
      ...(hasObjectKey(metadataPath, 'oauthAccount') ? [{ id: 'claude-oauth-account', provider: 'Anthropic', source: `${metadataPath} (oauthAccount)`, removable: true }] : []),
    ];
  }
  if (tool === 'codex') {
    const path = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
    return existing.has(path) && fileContainsOAuth(path) ? [{ id: 'codex-auth', provider: 'OpenAI', source: path, removable: true }] : [];
  }
  if (tool === 'opencode') {
    const path = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'auth.json');
    return existing.has(path) && fileContainsOAuth(path) ? [{ id: 'opencode-auth', provider: 'OpenCode provider', source: path, removable: true }] : [];
  }
  if (tool === 'claw') return [...existing].filter((path) => path.endsWith('auth-profiles.json') && fileContainsOAuth(path)).map((path) => ({ id: sourceId('oauth-file', 'OpenClaw', path), provider: 'OpenClaw provider profile', source: path, removable: true }));
  const hermesHome = process.env.HERMES_HOME || join(homedir(), '.hermes');
  return [...existing].filter(fileContainsOAuth).map((path) => ({
    id: sourceId('oauth-file', 'Hermes', path),
    provider: path === join(hermesHome, 'auth.json') ? 'Hermes provider' : path.includes(`${join(homedir(), '.claude')}`) ? 'Inherited Claude Code OAuth' : 'Inherited Codex OAuth',
    source: path,
    removable: true,
  }));
}

function mask(value: string): string {
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function sourceId(kind: string, name: string, path = ''): string {
  return `${kind}:${Buffer.from(`${name}\0${path}`).toString('base64url')}`;
}

function processConflicts(names: string[]): EnvironmentConflict[] {
  return names.flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [{
      id: sourceId('process', name), name, source: 'Fasten Share current process', value: mask(value), removable: true,
    }];
  });
}

function windowsRegistryConflicts(names: string[]): EnvironmentConflict[] {
  const read = (key: string, source: string, removable: boolean): EnvironmentConflict[] => {
    try {
      const output = execFileSync('reg.exe', ['query', key], { encoding: 'utf8', windowsHide: true });
      return names.flatMap((name) => {
        const line = output.split(/\r?\n/).find((item) => new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+REG_`).test(item));
        if (!line) return [];
        const value = line.trim().split(/\s{2,}/).slice(2).join('  ');
        return [{ id: sourceId(removable ? 'win-user' : 'win-system', name), name, source, value: mask(value), removable,
          reason: removable ? undefined : 'System environment variables require manual administrator changes.' }];
      });
    } catch { return []; }
  };
  return [
    ...read('HKCU\\Environment', 'Windows user environment (HKCU)', true),
    ...read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'Windows system environment (HKLM)', false),
  ];
}

function shellFiles(): string[] {
  const home = homedir();
  const zdir = process.env.ZDOTDIR || home;
  return [join(zdir, '.zshenv'), join(zdir, '.zprofile'), join(zdir, '.zshrc'), join(home, '.bash_profile'), join(home, '.bash_login'), join(home, '.profile'), join(home, '.bashrc'), join(home, '.config', 'fish', 'config.fish')];
}

function shellConflicts(names: string[], files = shellFiles(), removable = true): EnvironmentConflict[] {
  return files.flatMap((path) => {
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf8');
    return names.flatMap((name) => {
      const line = raw.split(/\r?\n/).find((item) => new RegExp(`^\\s*(?:export\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=`).test(item) || new RegExp(`^\\s*set\\s+-[gx]\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(item));
      if (!line) return [];
      const value = line.includes('=') ? line.slice(line.indexOf('=') + 1).trim() : '(set by fish)';
      return [{
        id: sourceId(removable ? 'shell' : 'system-shell', name, path),
        name,
        source: `${removable ? 'Shell configuration' : 'System shell configuration'}: ${path}`,
        value: mask(value),
        removable,
        reason: removable ? undefined : 'System configuration requires manual administrator changes.',
      }];
    });
  });
}

function environmentConflicts(tool: Exclude<ToolId, 'curl'>): EnvironmentConflict[] {
  const names = CONFLICTS[tool];
  if (platform() === 'win32') return [...processConflicts(names), ...windowsRegistryConflicts(names)];
  return [
    ...processConflicts(names),
    ...shellConflicts(names),
    ...shellConflicts(names, ['/etc/environment', '/etc/profile', '/etc/zshenv', '/etc/bash.bashrc'], false),
  ];
}

export function inspectToolConfig(tool: unknown): ToolConfigInspection {
  assertConfigurable(tool);
  const configFiles = configPaths(tool).map((path) => ({ path, exists: existsSync(path) }));
  const environment = environmentConflicts(tool);
  const oauth = oauthConflicts(tool, configFiles.map((file) => file.path));
  return {
    configPath: configFiles[0].path,
    configFiles,
    conflicts: [...new Set(environment.map((item) => item.name))],
    environmentConflicts: environment,
    oauthConflicts: oauth,
    clean: !configFiles.some((item) => item.exists) && environment.length === 0 && oauth.length === 0,
  };
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function backupName(path: string): string { return `${path}.fasten-share-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`; }
function writeAtomically(path: string, content: string): string | undefined {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); let backupPath: string | undefined;
  if (existsSync(path)) { backupPath = backupName(path); copyFileSync(path, backupPath); try { chmodSync(backupPath, 0o600); } catch {} }
  const tempPath = `${path}.fasten-share-tmp-${process.pid}`; writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 }); renameSync(tempPath, path); try { chmodSync(path, 0o600); } catch {} return backupPath;
}

function writeManifest(path: string, manifest: BackupManifest): void { writeFileSync(join(path, 'manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 }); }

function removeClaudeOAuthMetadata(): { path: string; content: string } | undefined {
  const path = join(homedir(), '.claude.json');
  if (!hasObjectKey(path, 'oauthAccount')) return undefined;
  const content = readFileSync(path, 'utf8');
  const root = object(JSON5.parse(content));
  delete root.oauthAccount;
  writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { execFileSync('claude', ['auth', 'logout'], { encoding: 'utf8', timeout: 15_000 }); } catch {}
  return { path, content };
}

function cleanupShellLine(path: string, name: string): void {
  const raw = readFileSync(path, 'utf8'); const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const next = raw.split(/\r?\n/).filter((line) => !new RegExp(`^\\s*(?:export\\s+)?${escaped}=`).test(line) && !new RegExp(`^\\s*set\\s+-[gx]\\s+${escaped}\\b`).test(line)).join('\n');
  writeFileSync(path, next, { encoding: 'utf8', mode: 0o600 });
}

function removeEnvironment(entry: EnvironmentConflict): void {
  if (!entry.removable) return;
  if (entry.id.startsWith('process:')) { delete process.env[entry.name]; return; }
  if (entry.id.startsWith('win-user:')) { execFileSync('reg.exe', ['delete', 'HKCU\\Environment', '/v', entry.name, '/f'], { windowsHide: true }); return; }
  if (entry.id.startsWith('shell:')) {
    const encoded = entry.id.split(':')[1]; const [, path] = Buffer.from(encoded, 'base64url').toString('utf8').split('\0');
    if (!path || !shellFiles().includes(path)) throw new Error('invalid shell configuration path'); cleanupShellLine(path, entry.name);
  }
}

function restoreValue(entry: EnvironmentConflict): string {
  if (entry.id.startsWith('process:')) return process.env[entry.name] || '';
  if (entry.id.startsWith('shell:')) {
    const encoded = entry.id.split(':')[1];
    const [, path] = Buffer.from(encoded, 'base64url').toString('utf8').split('\0');
    return readFileSync(path, 'utf8').split(/\r?\n/).find((line) => line.includes(entry.name)) || '';
  }
  if (entry.id.startsWith('win-user:')) {
    try {
      const output = execFileSync('reg.exe', ['query', 'HKCU\\Environment', '/v', entry.name], { encoding: 'utf8', windowsHide: true });
      const line = output.split(/\r?\n/).find((item) => item.includes('REG_')) || '';
      return line.trim().split(/\s{2,}/).slice(2).join('  ');
    } catch { return ''; }
  }
  return '';
}

export function cleanupToolConfig(tool: unknown): ToolConfigCleanupResult {
  assertConfigurable(tool);
  const before = inspectToolConfig(tool);
  const files = before.configFiles.filter((file) => file.exists); const environment = before.environmentConflicts.filter((item) => item.removable);
  const oauth = before.oauthConflicts.filter((item) => item.removable);
  if (!files.length && !environment.length && !oauth.length) return { ...before, removedConfigPaths: [], removedEnvironment: [], removedOAuth: [] };
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`; const backupPath = join(BACKUP_DIR, id); mkdirSync(backupPath, { recursive: true, mode: 0o700 });
  const manifest: BackupManifest = {
    id, createdAt: new Date().toISOString(), tool, files: [],
    environment: environment.map((entry) => ({ name: entry.name, source: entry.source, value: entry.value, id: entry.id, restoreValue: restoreValue(entry) })), metadataFiles: [],
  };
  for (const [index, file] of files.entries()) { const backupName = `file-${index}`; copyFileSync(file.path, join(backupPath, backupName)); manifest.files.push({ path: file.path, backupName }); }
  writeManifest(backupPath, manifest);
  for (const file of files) rmSync(file.path, { force: true });
  for (const item of environment) removeEnvironment(item);
  if (tool === 'claude' && oauth.some((item) => item.id === 'claude-oauth-account')) {
    const metadata = removeClaudeOAuthMetadata();
    if (metadata) {
      const backupName = 'metadata-0';
      writeFileSync(join(backupPath, backupName), metadata.content, { encoding: 'utf8', mode: 0o600 });
      manifest.metadataFiles!.push({ path: metadata.path, backupName });
      writeManifest(backupPath, manifest);
    }
  }
  return { ...inspectToolConfig(tool), backupId: id, backupPath, removedConfigPaths: files.map((file) => file.path), removedEnvironment: environment.map((item) => item.name), removedOAuth: oauth.map((item) => item.provider) };
}

export function listToolConfigBackups(tool: unknown): ToolConfigBackup[] {
  assertConfigurable(tool); if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return []; try { const manifest = JSON.parse(readFileSync(join(BACKUP_DIR, entry.name, 'manifest.json'), 'utf8')) as BackupManifest; return manifest.tool === tool ? [{ id: manifest.id, createdAt: manifest.createdAt, tool: manifest.tool, path: join(BACKUP_DIR, entry.name) }] : []; } catch { return []; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
}

function manifestFor(tool: Exclude<ToolId, 'curl'>, backupId: unknown): { path: string; manifest: BackupManifest } {
  if (typeof backupId !== 'string' || !/^[\w-]+$/.test(backupId)) throw new Error('invalid backup id'); const path = join(BACKUP_DIR, backupId); const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.id !== backupId || manifest.tool !== tool) throw new Error('backup does not belong to this tool'); return { path, manifest };
}

export function previewToolConfigRestore(tool: unknown, backupId: unknown): Pick<BackupManifest, 'id' | 'createdAt' | 'tool' | 'files'> & { environment: Array<{ name: string; source: string }> } {
  assertConfigurable(tool);
  const manifest = manifestFor(tool, backupId).manifest;
  return { ...manifest, files: [...manifest.files, ...(manifest.metadataFiles ?? [])], environment: manifest.environment.map(({ name, source }) => ({ name, source })) };
}

export function restoreToolConfig(tool: unknown, backupId: unknown): ToolConfigInspection {
  assertConfigurable(tool); const { path, manifest } = manifestFor(tool, backupId);
  for (const file of configPaths(tool)) rmSync(file, { force: true });
  for (const file of manifest.files) { mkdirSync(dirname(file.path), { recursive: true, mode: 0o700 }); copyFileSync(join(path, file.backupName), file.path); }
  for (const file of manifest.metadataFiles ?? []) { mkdirSync(dirname(file.path), { recursive: true, mode: 0o700 }); copyFileSync(join(path, file.backupName), file.path); }
  for (const variable of manifest.environment) {
    if (variable.id.startsWith('process:')) process.env[variable.name] = variable.restoreValue;
    else if (variable.id.startsWith('win-user:')) execFileSync('reg.exe', ['add', 'HKCU\\Environment', '/v', variable.name, '/t', 'REG_SZ', '/d', variable.restoreValue, '/f'], { windowsHide: true });
    else if (variable.id.startsWith('shell:')) {
      const encoded = variable.id.split(':')[1]; const [, shellPath] = Buffer.from(encoded, 'base64url').toString('utf8').split('\0');
      if (shellPath && shellFiles().includes(shellPath) && variable.restoreValue) writeFileSync(shellPath, `${readFileSync(shellPath, 'utf8')}\n${variable.restoreValue}\n`, { encoding: 'utf8', mode: 0o600 });
    }
  }
  return inspectToolConfig(tool);
}

export function configureTool(target: ToolConfigTarget, apiKey: string): ToolConfigResult {
  assertConfigurable(target.tool); if (!target.model.trim() || !target.baseUrl.trim()) throw new Error('missing model or endpoint'); assertSupportedTarget(target);
  const inspection = inspectToolConfig(target.tool); if (!inspection.clean) throw new Error('Remove all detected environment variables and current configuration files, then verify again before writing Fasten Share configuration.');
  const path = configPaths(target.tool)[0]; const raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const content = updateToolConfig(raw, target, apiKey);
  const backupPath = writeAtomically(path, content);
  const configured = inspectToolConfig(target.tool);
  return { ...configured, clean: true, backupPath };
}
