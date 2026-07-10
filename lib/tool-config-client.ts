import { authHeaders } from '@/lib/client/auth';
import type { ToolId } from '@/lib/tool-support';

export interface ToolConfigInspection {
  configPath: string;
  configFiles: Array<{ path: string; exists: boolean }>;
  conflicts: string[];
  environmentConflicts: Array<{
    id: string;
    name: string;
    source: string;
    value: string;
    removable: boolean;
    reason?: string;
  }>;
  clean: boolean;
  backupPath?: string;
}

export interface ToolConfigCleanupResult extends ToolConfigInspection {
  backupId?: string;
  removedConfigPaths: string[];
  removedEnvironment: string[];
}

export interface ToolConfigBackup {
  id: string;
  createdAt: string;
  tool: Exclude<ToolId, 'curl'>;
  path: string;
}

interface Target {
  tool: Exclude<ToolId, 'curl'>;
  protocol: string;
  model: string;
  peerId: string;
  versionPrefix: string;
  apiKey: string;
}

async function request<T = ToolConfigInspection>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/tools/configure', {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export function inspectTool(tool: Target['tool']): Promise<ToolConfigInspection> {
  return request({ action: 'inspect', tool });
}

export function cleanupTool(tool: Target['tool']): Promise<ToolConfigCleanupResult> {
  return request<ToolConfigCleanupResult>({ action: 'cleanup', tool });
}

export function verifyTool(tool: Target['tool']): Promise<ToolConfigInspection> {
  return request({ action: 'verify', tool });
}

export function listToolBackups(tool: Target['tool']): Promise<ToolConfigBackup[]> {
  return request<ToolConfigBackup[]>({ action: 'list-backups', tool });
}

export function previewToolRestore(tool: Target['tool'], backupId: string): Promise<{
  id: string;
  files: Array<{ path: string }>;
  environment: Array<{ name: string; source: string }>;
}> {
  return request<{
    id: string;
    files: Array<{ path: string }>;
    environment: Array<{ name: string; source: string }>;
  }>({ action: 'preview-restore', tool, backupId });
}

export function restoreTool(tool: Target['tool'], backupId: string): Promise<ToolConfigInspection> {
  return request({ action: 'restore', tool, backupId });
}

export function applyToolConfig(target: Target): Promise<ToolConfigInspection> {
  return request({ action: 'configure', ...target });
}
