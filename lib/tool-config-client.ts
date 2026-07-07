import { authHeaders } from '@/lib/client/auth';
import type { ToolId } from '@/lib/tool-support';

export interface ToolConfigInspection {
  configPath: string;
  conflicts: string[];
  backupPath?: string;
}

interface Target {
  tool: Exclude<ToolId, 'curl'>;
  protocol: string;
  model: string;
  peerId: string;
  versionPrefix: string;
  apiKey: string;
}

async function request(body: Record<string, unknown>): Promise<ToolConfigInspection> {
  const response = await fetch('/api/tools/configure', {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as ToolConfigInspection & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export function inspectTool(tool: Target['tool']): Promise<ToolConfigInspection> {
  return request({ action: 'inspect', tool });
}

export function applyToolConfig(target: Target): Promise<ToolConfigInspection> {
  return request({ action: 'configure', ...target });
}
