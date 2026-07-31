export const TOOL_IDS = ['curl', 'claude', 'codex', 'opencode', 'claw', 'hermes', 'pi'] as const;

export type ToolId = (typeof TOOL_IDS)[number];
export type ConfigurableToolId = Exclude<ToolId, 'curl'>;

export const CONFIGURABLE_TOOL_INFO: Record<ConfigurableToolId, { name: string; website: string }> = {
  claude: { name: 'Claude', website: 'https://claude.com/product/claude-code' },
  codex: { name: 'Codex', website: 'https://openai.com/codex/' },
  opencode: { name: 'OpenCode', website: 'https://opencode.ai/' },
  claw: { name: 'OpenClaw', website: 'https://openclaw.ai/' },
  hermes: { name: 'Hermes', website: 'https://hermes-agent.nousresearch.com/' },
  pi: { name: 'Pi', website: 'https://pi.dev/' },
};

export function isToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && (TOOL_IDS as readonly string[]).includes(value);
}

export function toolsForProtocol(protocol: string): ToolId[] {
  return TOOL_IDS.filter((tool) => {
    if (tool === 'claude') return protocol === 'anthropic';
    if (tool === 'codex') return protocol === 'openai-response';
    if (tool === 'opencode') return protocol === 'openai' || protocol === 'openai-response';
    if (tool === 'pi') return ['openai', 'openai-response', 'anthropic', 'gemini', 'ollama'].includes(protocol);
    return true;
  });
}

export function normalizeSupportedTools(value: unknown, protocol?: string): ToolId[] {
  const allowed = protocol ? toolsForProtocol(protocol) : [...TOOL_IDS];
  const selected = Array.isArray(value) ? value.filter(isToolId) : ['curl'];
  const normalized = TOOL_IDS.filter((tool) => selected.includes(tool) && allowed.includes(tool));
  return normalized.length ? normalized : ['curl'];
}
