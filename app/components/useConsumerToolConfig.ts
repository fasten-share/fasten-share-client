'use client';

import { useCallback, useState } from 'react';
import type { ConsumerApiKeyDto } from '@/lib/client/auth';
import {
  applyToolConfig, cleanupTool, inspectTool, listToolBackups,
  previewToolRestore, restoreTool, verifyTool,
  type ToolConfigBackup, type ToolConfigInspection,
} from '@/lib/tool-config-client';
import type { ToolId } from '@/lib/tool-support';
import type { useI18n } from '@/lib/i18n/context';
import type { CurlTarget } from './consumer-utils';
import { markStep } from '@/lib/onboarding';
import { useToast } from './ToastProvider';

type Translate = ReturnType<typeof useI18n>['t'];

export function useConsumerToolConfig(
  selectedApiKey: ConsumerApiKeyDto | null, t: Translate, currentUserId = '',
) {
  // Outcomes are announced rather than rendered inline: the tool-config modal
  // sits above the page, so a message printed underneath it went unseen.
  const { showToast } = useToast();
  const notifyError = (error: unknown): void => {
    showToast(error instanceof Error ? error.message : String(error), { tone: 'error' });
  };
  const [copied, setCopied] = useState('');
  const [curlTarget, setCurlTarget] = useState<CurlTarget | null>(null);
  const [toolByTarget, setToolByTarget] = useState<Record<string, ToolId>>({});
  const [configuringTarget, setConfiguringTarget] = useState<CurlTarget | null>(null);
  const [configuringTool, setConfiguringTool] = useState<Exclude<ToolId, 'curl'> | null>(null);
  const [pendingInspection, setPendingInspection] = useState<ToolConfigInspection | null>(null);
  const [toolConfigStage, setToolConfigStage] = useState<'inspect' | 'cleaned'>('inspect');
  const [toolBackups, setToolBackups] = useState<ToolConfigBackup[]>([]);
  const [restorePreview, setRestorePreview] = useState<{
    id: string;
    files: Array<{ path: string }>;
    environment: Array<{ name: string; source: string }>;
  } | null>(null);
  const [toolConfigWorking, setToolConfigWorking] = useState(false);
  const [toolConfigError, setToolConfigError] = useState('');

  function copy(text: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(''), 1200);
  }

  async function beginToolConfig(target: CurlTarget, tool: ToolId): Promise<void> {
    if (!selectedApiKey) return;
    if (tool === 'curl') {
      setCurlTarget(target);
      // Reaching the curl command is as far as this tool goes; that counts.
      if (currentUserId) markStep(currentUserId, 'consumerConfigure');
      return;
    }
    setToolConfigError('');
    setConfiguringTarget(target);
    setConfiguringTool(tool);
    setToolConfigStage('inspect');
    setRestorePreview(null);
    try {
      const [inspection, backups] = await Promise.all([inspectTool(tool), listToolBackups(tool)]);
      setPendingInspection(inspection);
      setToolBackups(backups);
    } catch (error) {
      notifyError(error);
      setConfiguringTarget(null);
      setConfiguringTool(null);
    }
  }

  const closeToolConfigPreview = useCallback((): void => {
    setConfiguringTarget(null);
    setConfiguringTool(null);
    setPendingInspection(null);
    setRestorePreview(null);
    setToolBackups([]);
  }, []);

  async function cleanToolConfig(tool: Exclude<ToolId, 'curl'>): Promise<void> {
    setToolConfigWorking(true);
    setToolConfigError('');
    try {
      const result = await cleanupTool(tool);
      setPendingInspection(result);
      setToolConfigStage('cleaned');
      showToast(t('consumer.toolConfigCleaned', { backup: result.backupPath || t('consumer.noBackup') }), { tone: 'success' });
      setToolBackups(await listToolBackups(tool));
    } catch (error) {
      notifyError(error);
    } finally {
      setToolConfigWorking(false);
    }
  }

  async function checkAndConfigureTool(target: CurlTarget, tool: Exclude<ToolId, 'curl'>): Promise<void> {
    if (!selectedApiKey) return;
    setToolConfigWorking(true);
    setToolConfigError('');
    try {
      const inspection = await verifyTool(tool);
      setPendingInspection(inspection);
      setToolConfigStage('cleaned');
      if (!inspection.clean) {
        setToolConfigError(t('consumer.toolConfigNotClean'));
        return;
      }
      await finishToolConfig(target, tool);
    } catch (error) {
      notifyError(error);
    } finally {
      setToolConfigWorking(false);
    }
  }

  async function showRestorePreview(tool: Exclude<ToolId, 'curl'>, backupId: string): Promise<void> {
    setToolConfigWorking(true);
    setToolConfigError('');
    try { setRestorePreview(await previewToolRestore(tool, backupId)); }
    catch (error) { notifyError(error); }
    finally { setToolConfigWorking(false); }
  }

  async function restoreBackup(tool: Exclude<ToolId, 'curl'>, backupId: string): Promise<void> {
    setToolConfigWorking(true);
    try {
      setPendingInspection(await restoreTool(tool, backupId));
      setRestorePreview(null);
      setToolConfigStage('inspect');
      showToast(t('consumer.toolConfigRestored'), { tone: 'success' });
    } catch (error) { notifyError(error); }
    finally { setToolConfigWorking(false); }
  }

  async function finishToolConfig(target: CurlTarget, tool: Exclude<ToolId, 'curl'>): Promise<void> {
    if (!selectedApiKey) return;
    setPendingInspection(null);
    try {
      const result = await applyToolConfig({
        tool,
        protocol: target.protocol,
        model: target.model,
        peerId: target.peerId,
        versionPrefix: target.versionPrefix,
        apiKey: selectedApiKey.key,
      });
      showToast(
        t('consumer.toolConfigured', {
          path: result.configPath,
          backup: result.backupPath || t('consumer.noBackup'),
        }),
        { tone: 'success' },
      );
      if (currentUserId) markStep(currentUserId, 'consumerConfigure');
      setPendingInspection(null);
      setConfiguringTarget(null);
      setConfiguringTool(null);
    } catch (error) {
      notifyError(error);
      setPendingInspection(null);
      setConfiguringTarget(null);
      setConfiguringTool(null);
    }
  }

  return {
    copied, curlTarget, setCurlTarget, toolByTarget, setToolByTarget,
    configuringTarget, configuringTool, pendingInspection, toolConfigStage,
    toolBackups, restorePreview, toolConfigWorking, toolConfigError,
    copy, beginToolConfig, closeToolConfigPreview, cleanToolConfig,
    checkAndConfigureTool, showRestorePreview, restoreBackup,
  };
}
