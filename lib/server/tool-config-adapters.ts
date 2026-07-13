import JSON5 from 'json5';
import * as TOML from '@iarna/toml';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ToolConfigTarget } from './tool-config-types';

export function assertSupportedTarget(target: ToolConfigTarget): void {
  if (target.tool === 'claude' && target.protocol !== 'anthropic') throw new Error('Claude can only be configured for the anthropic protocol.');
  if (target.tool === 'codex' && target.protocol !== 'openai-response') throw new Error('Codex can only be configured for the openai-response protocol.');
  if (target.tool === 'opencode' && !['openai', 'openai-response'].includes(target.protocol)) throw new Error('OpenCode can only be configured for the openai or openai-response protocol.');
  if (target.tool === 'claw' && target.protocol === 'azure-openai') throw new Error('OpenClaw Azure configuration is not supported yet.');
  if (target.tool === 'hermes' && ['gemini', 'azure-openai'].includes(target.protocol)) throw new Error(`Hermes ${target.protocol} configuration is not supported yet.`);
}

export function updateToolConfig(raw: string, target: ToolConfigTarget, token: string): string {
  switch (target.tool) {
    case 'claude': return updateClaude(raw, target, token);
    case 'codex': return updateCodex(raw, target, token);
    case 'opencode': return updateOpenCode(raw, target, token);
    case 'claw': return updateOpenClaw(raw, target, token);
    case 'hermes': return updateHermes(raw, target, token);
    case 'curl': throw new Error('curl has no writable configuration');
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function openClawApi(protocol: string): string { return protocol === 'openai-response' ? 'openai-responses' : protocol === 'anthropic' ? 'anthropic-messages' : protocol === 'gemini' ? 'google-generative-ai' : 'openai-completions'; }
function hermesApiMode(protocol: string): string { return protocol === 'openai-response' ? 'codex_responses' : protocol === 'anthropic' ? 'anthropic_messages' : 'chat_completions'; }

function updateClaude(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? object(JSON5.parse(raw)) : {}; const env = object(root.env); delete env.ANTHROPIC_AUTH_TOKEN;
  root.env = { ...env, ANTHROPIC_BASE_URL: target.baseUrl, ANTHROPIC_API_KEY: token, ANTHROPIC_MODEL: target.model, CLAUDE_CODE_SIMPLE: '1' };
  return `${JSON.stringify(root, null, 2)}\n`;
}
function updateCodex(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? TOML.parse(raw) as Record<string, unknown> : {}; root.model = target.model; root.model_provider = 'fasten-share'; root.forced_login_method = 'api';
  const providers = object(root.model_providers); const provider = object(providers['fasten-share']); delete provider.env_key; delete provider.experimental_bearer_token; delete provider.requires_openai_auth; delete provider.auth;
  providers['fasten-share'] = { ...provider, name: 'Fasten Share', base_url: target.baseUrl, wire_api: 'responses', http_headers: { Authorization: `Bearer ${token}` } }; root.model_providers = providers;
  return TOML.stringify(root as Parameters<typeof TOML.stringify>[0]);
}
function updateOpenCode(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? object(JSON5.parse(raw)) : {};
  root.$schema = 'https://opencode.ai/config.json'; root.model = `fasten-share/${target.model}`; root.small_model = `fasten-share/${target.model}`;
  root.enabled_providers = ['fasten-share']; root.disabled_providers = [];
  root.provider = { 'fasten-share': { npm: target.protocol === 'openai-response' ? '@ai-sdk/openai' : '@ai-sdk/openai-compatible', name: 'Fasten Share', options: { baseURL: target.baseUrl, apiKey: token }, models: { [target.model]: { name: target.model } } } };
  return `${JSON.stringify(root, null, 2)}\n`;
}
function updateOpenClaw(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? object(JSON5.parse(raw)) : {}; const models = object(root.models); const providers = object(models.providers);
  providers['fasten-share'] = { ...object(providers['fasten-share']), baseUrl: target.baseUrl, apiKey: token, api: openClawApi(target.protocol), models: [{ id: target.model, name: target.model }] };
  models.mode = 'replace'; models.providers = { 'fasten-share': providers['fasten-share'] }; root.models = models;
  const agents = object(root.agents); const defaults = object(agents.defaults); defaults.model = { ...object(defaults.model), primary: `fasten-share/${target.model}`, fallbacks: [] }; agents.defaults = defaults; root.agents = agents;
  return `${JSON.stringify(root, null, 2)}\n`;
}
function updateHermes(raw: string, target: ToolConfigTarget, token: string): string {
  const root = raw.trim() ? object(parseYaml(raw)) : {};
  root.model = { ...object(root.model), default: target.model, provider: 'custom', base_url: target.baseUrl, api_key: token, api_mode: hermesApiMode(target.protocol) };
  delete root.fallback_model; root.fallback_providers = [];
  return stringifyYaml(root);
}
