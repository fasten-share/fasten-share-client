import type { ToolId } from '../tool-support';

export interface ToolConfigTarget { tool: ToolId; protocol: string; model: string; baseUrl: string }
export interface ConfigFileInspection { path: string; exists: boolean }
export interface EnvironmentConflict { id: string; name: string; source: string; value: string; removable: boolean; reason?: string }
export interface OAuthConflict { id: string; provider: string; source: string; removable: boolean; reason?: string }
export interface ToolConfigInspection {
  configPath: string;
  configFiles: ConfigFileInspection[];
  conflicts: string[];
  environmentConflicts: EnvironmentConflict[];
  oauthConflicts: OAuthConflict[];
  clean: boolean;
}
export interface ToolConfigResult extends ToolConfigInspection { backupPath?: string }
export interface ToolConfigCleanupResult extends ToolConfigInspection {
  backupId?: string;
  backupPath?: string;
  removedConfigPaths: string[];
  removedEnvironment: string[];
  removedOAuth: string[];
}
export interface ToolConfigBackup { id: string; createdAt: string; tool: Exclude<ToolId, 'curl'>; path: string }

export interface BackupManifest {
  id: string;
  createdAt: string;
  tool: Exclude<ToolId, 'curl'>;
  files: Array<{ path: string; backupName: string }>;
  environment: Array<{ name: string; source: string; value: string; id: string; restoreValue: string }>;
  metadataFiles?: Array<{ path: string; backupName: string }>;
}
