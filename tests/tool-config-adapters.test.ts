import { describe, expect, it } from 'vitest';
import * as TOML from '@iarna/toml';
import { parse as parseYaml } from 'yaml';
import {
  assertSupportedTarget,
  updateToolConfig,
} from '@/lib/server/tool-config-adapters';
import type { ToolConfigTarget } from '@/lib/server/tool-config-types';

function target(
  tool: ToolConfigTarget['tool'],
  protocol: string,
): ToolConfigTarget {
  return {
    tool,
    protocol,
    model: 'test-model',
    baseUrl: 'https://share.example/v1',
  };
}

describe('tool configuration protocol policy', () => {
  it.each([
    [target('claude', 'openai'), 'Claude'],
    [target('codex', 'openai'), 'Codex'],
    [target('opencode', 'anthropic'), 'OpenCode'],
    [target('claw', 'azure-openai'), 'OpenClaw'],
    [target('hermes', 'gemini'), 'Hermes'],
  ] as const)('rejects unsupported target combinations for %s', (value, message) => {
    expect(() => assertSupportedTarget(value)).toThrow(message);
  });

  it.each([
    target('claude', 'anthropic'),
    target('codex', 'openai-response'),
    target('opencode', 'openai'),
    target('opencode', 'openai-response'),
    target('claw', 'anthropic'),
    target('hermes', 'openai'),
  ])('accepts $tool with $protocol', (value) => {
    expect(() => assertSupportedTarget(value)).not.toThrow();
  });
});

describe('tool configuration writers', () => {
  it('updates Claude JSON while preserving unrelated settings and removing legacy auth', () => {
    const output = JSON.parse(updateToolConfig(
      '{"theme":"dark","env":{"KEEP":"yes","ANTHROPIC_AUTH_TOKEN":"old"}}',
      target('claude', 'anthropic'),
      'secret',
    ));

    expect(output).toEqual({
      theme: 'dark',
      env: {
        KEEP: 'yes',
        ANTHROPIC_BASE_URL: 'https://share.example/v1',
        ANTHROPIC_API_KEY: 'secret',
        ANTHROPIC_MODEL: 'test-model',
        CLAUDE_CODE_SIMPLE: '1',
      },
    });
  });

  it('updates Codex TOML and removes conflicting provider authentication fields', () => {
    const output = TOML.parse(updateToolConfig(`
model = "old"
[model_providers.fasten-share]
env_key = "OPENAI_API_KEY"
experimental_bearer_token = "old"
custom = "preserved"
`, target('codex', 'openai-response'), 'token'));

    expect(output.model).toBe('test-model');
    expect(output.model_provider).toBe('fasten-share');
    expect(output.forced_login_method).toBe('api');
    expect(output.model_providers).toEqual({
      'fasten-share': {
        custom: 'preserved',
        name: 'Fasten Share',
        base_url: 'https://share.example/v1',
        wire_api: 'responses',
        supports_websockets: false,
        http_headers: { Authorization: 'Bearer token' },
      },
    });
  });

  it('writes isolated OpenCode provider and model settings', () => {
    const output = JSON.parse(updateToolConfig(
      '{"theme":"dark","provider":{"other":{"name":"Other"}}}',
      target('opencode', 'openai-response'),
      'token',
    ));

    expect(output.theme).toBe('dark');
    expect(output.model).toBe('fasten-share/test-model');
    expect(output.enabled_providers).toEqual(['fasten-share']);
    expect(output.provider).toEqual({
      'fasten-share': {
        npm: '@ai-sdk/openai',
        name: 'Fasten Share',
        options: { baseURL: 'https://share.example/v1', apiKey: 'token' },
        models: { 'test-model': { name: 'test-model' } },
      },
    });
  });

  it.each([
    ['openai-response', 'openai-responses'],
    ['anthropic', 'anthropic-messages'],
    ['gemini', 'google-generative-ai'],
    ['openai', 'openai-completions'],
  ])('maps OpenClaw %s to %s', (protocol, api) => {
    const output = JSON.parse(updateToolConfig(
      '{"models":{"providers":{"old":{}}},"agents":{"defaults":{"keep":true}}}',
      target('claw', protocol),
      'token',
    ));

    expect(output.models).toEqual({
      mode: 'replace',
      providers: {
        'fasten-share': {
          baseUrl: 'https://share.example/v1',
          apiKey: 'token',
          api,
          models: [{ id: 'test-model', name: 'test-model' }],
        },
      },
    });
    expect(output.agents.defaults).toEqual({
      keep: true,
      model: { primary: 'fasten-share/test-model', fallbacks: [] },
    });
  });

  it.each([
    ['openai-response', 'codex_responses'],
    ['anthropic', 'anthropic_messages'],
    ['openai', 'chat_completions'],
  ])('maps Hermes %s and clears fallback configuration', (protocol, apiMode) => {
    const output = parseYaml(updateToolConfig(
      'theme: dark\nfallback_model: old\nmodel:\n  temperature: 0.2\n',
      target('hermes', protocol),
      'token',
    ));

    expect(output.theme).toBe('dark');
    expect(output.fallback_model).toBeUndefined();
    expect(output.fallback_providers).toEqual([]);
    expect(output.model).toEqual({
      temperature: 0.2,
      default: 'test-model',
      provider: 'custom',
      base_url: 'https://share.example/v1',
      api_key: 'token',
      api_mode: apiMode,
    });
  });

});
