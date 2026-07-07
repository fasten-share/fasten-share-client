import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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

export interface ToolConfigInspection {
  configPath: string;
  conflicts: string[];
}

export interface ToolConfigResult extends ToolConfigInspection {
  backupPath?: string;
}

const CONFLICTS: Record<ToolId, string[]> = {
  curl: [],
  claude: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  claw: [
    'OPENAI_API_KEY',
    'OPENAI_API_KEYS',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
  ],
  hermes: [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_TOKEN',
    'HERMES_API_MODE',
  ],
};

function configPath(tool: ToolId): string {
  switch (tool) {
    case 'claude':
      return join(homedir(), '.claude', 'settings.json');
    case 'codex':
      return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
    case 'claw':
      return (
        process.env.OPENCLAW_CONFIG_PATH ||
        join(process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw'), 'openclaw.json')
      );
    case 'hermes':
      return join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'config.yaml');
    default:
      throw new Error('curl does not use a configuration file');
  }
}

export function inspectToolConfig(tool: unknown): ToolConfigInspection {
  if (!isToolId(tool) || tool === 'curl') throw new Error('invalid configurable tool');
  return {
    configPath: configPath(tool),
    conflicts: CONFLICTS[tool].filter((name) => Boolean(process.env[name])),
  };
}

function assertSupported(target: ToolConfigTarget): void {
  if (target.tool === 'claude' && target.protocol !== 'anthropic') {
    throw new Error('Claude can only be configured for the anthropic protocol.');
  }
  if (target.tool === 'codex' && target.protocol !== 'openai-response') {
    throw new Error('Codex can only be configured for the openai-response protocol.');
  }
  if (target.tool === 'claw' && target.protocol === 'azure-openai') {
    throw new Error('OpenClaw Azure configuration is not supported yet.');
  }
  if (target.tool === 'hermes' && ['gemini', 'azure-openai'].includes(target.protocol)) {
    throw new Error(`Hermes ${target.protocol} configuration is not supported yet.`);
  }
}

function openClawApi(protocol: string): string {
  switch (protocol) {
    case 'openai-response':
      return 'openai-responses';
    case 'anthropic':
      return 'anthropic-messages';
    case 'gemini':
      return 'google-generative-ai';
    default:
      return 'openai-completions';
  }
}

function hermesApiMode(protocol: string): string {
  if (protocol === 'openai-response') return 'codex_responses';
  if (protocol === 'anthropic') return 'anthropic_messages';
  return 'chat_completions';
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function updateClaude(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? object(JSON5.parse(raw)) : {};
  const env = object(root.env);
  // AUTH_TOKEN would add a second, potentially stale Authorization header and
  // take precedence over the app key we are deliberately configuring.
  delete env.ANTHROPIC_AUTH_TOKEN;
  root.env = {
    ...env,
    ANTHROPIC_BASE_URL: target.baseUrl,
    ANTHROPIC_API_KEY: token,
    ANTHROPIC_MODEL: target.model,
  };
  return `${JSON.stringify(root, null, 2)}\n`;
}

function updateCodex(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? (TOML.parse(raw) as Record<string, unknown>) : {};
  root.model = target.model;
  root.model_provider = 'fasten-share';
  const providers = object(root.model_providers);
  const provider = object(providers['fasten-share']);
  // Codex rejects providers that combine these authentication modes.
  delete provider.env_key;
  delete provider.experimental_bearer_token;
  delete provider.requires_openai_auth;
  delete provider.auth;
  providers['fasten-share'] = {
    ...provider,
    name: 'Fasten Share',
    base_url: target.baseUrl,
    wire_api: 'responses',
    http_headers: { Authorization: `Bearer ${token}` },
  };
  root.model_providers = providers;
  return TOML.stringify(root as Parameters<typeof TOML.stringify>[0]);
}

function updateOpenClaw(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? object(JSON5.parse(raw)) : {};
  const models = object(root.models);
  const providers = object(models.providers);
  providers['fasten-share'] = {
    ...object(providers['fasten-share']),
    baseUrl: target.baseUrl,
    apiKey: token,
    api: openClawApi(target.protocol),
    models: [{ id: target.model, name: target.model }],
  };
  models.mode = 'merge';
  models.providers = providers;
  root.models = models;

  const agents = object(root.agents);
  const defaults = object(agents.defaults);
  defaults.model = { ...object(defaults.model), primary: `fasten-share/${target.model}` };
  agents.defaults = defaults;
  root.agents = agents;
  return `${JSON.stringify(root, null, 2)}\n`;
}

function updateHermes(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? object(parseYaml(raw)) : {};
  root.model = {
    ...object(root.model),
    default: target.model,
    provider: 'custom',
    base_url: target.baseUrl,
    api_key: token,
    api_mode: hermesApiMode(target.protocol),
  };
  return stringifyYaml(root);
}

function backupName(path: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${path}.fasten-share-backup-${stamp}`;
}

function writeAtomically(path: string, content: string): string | undefined {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let backupPath: string | undefined;
  if (existsSync(path)) {
    backupPath = backupName(path);
    copyFileSync(path, backupPath);
    try {
      chmodSync(backupPath, 0o600);
    } catch {
      // Windows may not implement POSIX permission bits.
    }
  }
  const tempPath = `${path}.fasten-share-tmp-${process.pid}`;
  writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
  renameSync(tempPath, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may not implement POSIX permission bits.
  }
  return backupPath;
}

export function configureTool(target: ToolConfigTarget, apiKey: string): ToolConfigResult {
  if (!isToolId(target.tool) || target.tool === 'curl') throw new Error('invalid configurable tool');
  if (!target.model.trim() || !target.baseUrl.trim()) throw new Error('missing model or endpoint');
  assertSupported(target);

  const inspection = inspectToolConfig(target.tool);
  const raw = existsSync(inspection.configPath) ? readFileSync(inspection.configPath, 'utf8') : '';
  let content: string;
  switch (target.tool) {
    case 'claude':
      content = updateClaude(raw, target, apiKey);
      break;
    case 'codex':
      content = updateCodex(raw, target, apiKey);
      break;
    case 'claw':
      content = updateOpenClaw(raw, target, apiKey);
      break;
    case 'hermes':
      content = updateHermes(raw, target, apiKey);
      break;
    default:
      throw new Error('unsupported tool');
  }
  return { ...inspection, backupPath: writeAtomically(inspection.configPath, content) };
}
