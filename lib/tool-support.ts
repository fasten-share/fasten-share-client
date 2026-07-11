export const TOOL_IDS = ['curl', 'claude', 'codex', 'opencode', 'claw', 'hermes'] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export function isToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && (TOOL_IDS as readonly string[]).includes(value);
}

export function toolsForProtocol(protocol: string): ToolId[] {
  return TOOL_IDS.filter((tool) => {
    if (tool === 'claude') return protocol === 'anthropic';
    if (tool === 'codex') return protocol === 'openai-response';
    if (tool === 'opencode') return protocol === 'openai' || protocol === 'openai-response';
    return true;
  });
}

export function normalizeSupportedTools(value: unknown, protocol?: string): ToolId[] {
  const allowed = protocol ? toolsForProtocol(protocol) : [...TOOL_IDS];
  const selected = Array.isArray(value) ? value.filter(isToolId) : ['curl'];
  const normalized = TOOL_IDS.filter((tool) => selected.includes(tool) && allowed.includes(tool));
  return normalized.length ? normalized : ['curl'];
}
