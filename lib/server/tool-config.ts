import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import JSON5 from 'json5';
import * as TOML from '@iarna/toml';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { isToolId, type ToolId } from '../tool-support';

export interface ToolConfigTarget {
  tool: ToolId;
  protocol: string;
  model: string;
  baseUrl: string;
}

export interface ConfigFileInspection {
  path: string;
  exists: boolean;
}

export interface EnvironmentConflict {
  id: string;
  name: string;
  source: string;
  value: string;
  removable: boolean;
  reason?: string;
}

export interface ToolConfigInspection {
  configPath: string;
  configFiles: ConfigFileInspection[];
  conflicts: string[];
  environmentConflicts: EnvironmentConflict[];
  clean: boolean;
}

export interface ToolConfigResult extends ToolConfigInspection {
  backupPath?: string;
}

export interface ToolConfigCleanupResult extends ToolConfigInspection {
  backupId?: string;
  backupPath?: string;
  removedConfigPaths: string[];
  removedEnvironment: string[];
}

export interface ToolConfigBackup {
  id: string;
  createdAt: string;
  tool: Exclude<ToolId, 'curl'>;
  path: string;
}

interface BackupManifest {
  id: string;
  createdAt: string;
  tool: Exclude<ToolId, 'curl'>;
  files: Array<{ path: string; backupName: string }>;
  environment: Array<{ name: string; source: string; value: string; id: string; restoreValue: string }>;
}

const CONFLICTS: Record<ToolId, string[]> = {
  curl: [],
  claude: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
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
    case 'claude': return [join(homedir(), '.claude', 'settings.json')];
    case 'codex': {
      const dir = process.env.CODEX_HOME || join(homedir(), '.codex');
      return [join(dir, 'config.toml'), join(dir, 'auth.json')];
    }
    case 'claw': return [process.env.OPENCLAW_CONFIG_PATH || join(process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw'), 'openclaw.json')];
    case 'hermes': {
      const dir = process.env.HERMES_HOME || join(homedir(), '.hermes');
      return [join(dir, 'config.yaml'), join(dir, '.env')];
    }
  }
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
  return {
    configPath: configFiles[0].path,
    configFiles,
    conflicts: [...new Set(environment.map((item) => item.name))],
    environmentConflicts: environment,
    clean: !configFiles.some((item) => item.exists) && environment.length === 0,
  };
}

function assertSupported(target: ToolConfigTarget): void {
  if (target.tool === 'claude' && target.protocol !== 'anthropic') throw new Error('Claude can only be configured for the anthropic protocol.');
  if (target.tool === 'codex' && target.protocol !== 'openai-response') throw new Error('Codex can only be configured for the openai-response protocol.');
  if (target.tool === 'claw' && target.protocol === 'azure-openai') throw new Error('OpenClaw Azure configuration is not supported yet.');
  if (target.tool === 'hermes' && ['gemini', 'azure-openai'].includes(target.protocol)) throw new Error(`Hermes ${target.protocol} configuration is not supported yet.`);
}

function openClawApi(protocol: string): string { return protocol === 'openai-response' ? 'openai-responses' : protocol === 'anthropic' ? 'anthropic-messages' : protocol === 'gemini' ? 'google-generative-ai' : 'openai-completions'; }
function hermesApiMode(protocol: string): string { return protocol === 'openai-response' ? 'codex_responses' : protocol === 'anthropic' ? 'anthropic_messages' : 'chat_completions'; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function updateClaude(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? object(JSON5.parse(raw)) : {}; const env = object(root.env); delete env.ANTHROPIC_AUTH_TOKEN;
  root.env = { ...env, ANTHROPIC_BASE_URL: target.baseUrl, ANTHROPIC_API_KEY: token, ANTHROPIC_MODEL: target.model };
  return `${JSON.stringify(root, null, 2)}\n`;
}
function updateCodex(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? TOML.parse(raw) as Record<string, unknown> : {}; root.model = target.model; root.model_provider = 'fasten-share';
  const providers = object(root.model_providers); const provider = object(providers['fasten-share']); delete provider.env_key; delete provider.experimental_bearer_token; delete provider.requires_openai_auth; delete provider.auth;
  providers['fasten-share'] = { ...provider, name: 'Fasten Share', base_url: target.baseUrl, wire_api: 'responses', http_headers: { Authorization: `Bearer ${token}` } }; root.model_providers = providers;
  return TOML.stringify(root as Parameters<typeof TOML.stringify>[0]);
}
function updateOpenClaw(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? object(JSON5.parse(raw)) : {}; const models = object(root.models); const providers = object(models.providers);
  providers['fasten-share'] = { ...object(providers['fasten-share']), baseUrl: target.baseUrl, apiKey: token, api: openClawApi(target.protocol), models: [{ id: target.model, name: target.model }] };
  models.mode = 'merge'; models.providers = providers; root.models = models; const agents = object(root.agents); const defaults = object(agents.defaults); defaults.model = { ...object(defaults.model), primary: `fasten-share/${target.model}` }; agents.defaults = defaults; root.agents = agents;
  return `${JSON.stringify(root, null, 2)}\n`;
}
function updateHermes(raw: string, target: ToolConfigTarget, token: string): string { const root = raw.trim() ? object(parseYaml(raw)) : {}; root.model = { ...object(root.model), default: target.model, provider: 'custom', base_url: target.baseUrl, api_key: token, api_mode: hermesApiMode(target.protocol) }; return stringifyYaml(root); }

function backupName(path: string): string { return `${path}.fasten-share-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`; }
function writeAtomically(path: string, content: string): string | undefined {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); let backupPath: string | undefined;
  if (existsSync(path)) { backupPath = backupName(path); copyFileSync(path, backupPath); try { chmodSync(backupPath, 0o600); } catch {} }
  const tempPath = `${path}.fasten-share-tmp-${process.pid}`; writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 }); renameSync(tempPath, path); try { chmodSync(path, 0o600); } catch {} return backupPath;
}

function writeManifest(path: string, manifest: BackupManifest): void { writeFileSync(join(path, 'manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 }); }

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
  if (!files.length && !environment.length) return { ...before, removedConfigPaths: [], removedEnvironment: [] };
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`; const backupPath = join(BACKUP_DIR, id); mkdirSync(backupPath, { recursive: true, mode: 0o700 });
  const manifest: BackupManifest = {
    id, createdAt: new Date().toISOString(), tool, files: [],
    environment: environment.map((entry) => ({ name: entry.name, source: entry.source, value: entry.value, id: entry.id, restoreValue: restoreValue(entry) })),
  };
  for (const [index, file] of files.entries()) { const backupName = `file-${index}`; copyFileSync(file.path, join(backupPath, backupName)); manifest.files.push({ path: file.path, backupName }); }
  writeManifest(backupPath, manifest);
  for (const file of files) rmSync(file.path, { force: true });
  for (const item of environment) removeEnvironment(item);
  return { ...inspectToolConfig(tool), backupId: id, backupPath, removedConfigPaths: files.map((file) => file.path), removedEnvironment: environment.map((item) => item.name) };
}

export function listToolConfigBackups(tool: unknown): ToolConfigBackup[] {
  assertConfigurable(tool); if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return []; try { const manifest = JSON.parse(readFileSync(join(BACKUP_DIR, entry.name, 'manifest.json'), 'utf8')) as BackupManifest; return manifest.tool === tool ? [{ id: manifest.id, createdAt: manifest.createdAt, tool: manifest.tool, path: join(BACKUP_DIR, entry.name) }] : []; } catch { return []; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function manifestFor(tool: Exclude<ToolId, 'curl'>, backupId: unknown): { path: string; manifest: BackupManifest } {
  if (typeof backupId !== 'string' || !/^[\w-]+$/.test(backupId)) throw new Error('invalid backup id'); const path = join(BACKUP_DIR, backupId); const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.id !== backupId || manifest.tool !== tool) throw new Error('backup does not belong to this tool'); return { path, manifest };
}

export function previewToolConfigRestore(tool: unknown, backupId: unknown): Pick<BackupManifest, 'id' | 'createdAt' | 'tool' | 'files'> & { environment: Array<{ name: string; source: string }> } {
  assertConfigurable(tool);
  const manifest = manifestFor(tool, backupId).manifest;
  return { ...manifest, environment: manifest.environment.map(({ name, source }) => ({ name, source })) };
}

export function restoreToolConfig(tool: unknown, backupId: unknown): ToolConfigInspection {
  assertConfigurable(tool); const { path, manifest } = manifestFor(tool, backupId);
  for (const file of configPaths(tool)) rmSync(file, { force: true });
  for (const file of manifest.files) { mkdirSync(dirname(file.path), { recursive: true, mode: 0o700 }); copyFileSync(join(path, file.backupName), file.path); }
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
  assertConfigurable(target.tool); if (!target.model.trim() || !target.baseUrl.trim()) throw new Error('missing model or endpoint'); assertSupported(target);
  const inspection = inspectToolConfig(target.tool); if (!inspection.clean) throw new Error('Remove all detected environment variables and current configuration files, then verify again before writing Fasten Share configuration.');
  const path = configPaths(target.tool)[0]; const raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const content = target.tool === 'claude' ? updateClaude(raw, target, apiKey) : target.tool === 'codex' ? updateCodex(raw, target, apiKey) : target.tool === 'claw' ? updateOpenClaw(raw, target, apiKey) : updateHermes(raw, target, apiKey);
  const backupPath = writeAtomically(path, content);
  const configured = inspectToolConfig(target.tool);
  return { ...configured, clean: true, backupPath };
}
