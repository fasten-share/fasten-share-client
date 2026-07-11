import type { ConsumerApiKeyDto } from '@/lib/client/auth';
import type { ToolConfigBackup, ToolConfigInspection } from '@/lib/tool-config-client';
import type { ToolId } from '@/lib/tool-support';
import type { useI18n } from '@/lib/i18n/context';
import { buildCurl, buildToolEndpoint, type CurlTarget } from './consumer-utils';
import styles from './ConsumerInfo.module.css';

type Translate = ReturnType<typeof useI18n>['t'];

export function CurlModal({ target, origin, apiKey, copied, t, onClose, onCopy }: {
  target: CurlTarget; origin: string; apiKey: ConsumerApiKeyDto | null; copied: string; t: Translate;
  onClose: () => void; onCopy: (text: string) => void;
}) {
  const command = apiKey ? buildCurl(origin, target, apiKey.key) : '';
  return <div className="modal-overlay" onClick={onClose}><div className="modal" onClick={(event) => event.stopPropagation()}>
    <h3>{t('consumer.curlTitle')} <span className="badge">{target.protocol}</span>{' '}<span style={{ fontWeight: 600 }}>{target.model}</span></h3>
    <div className={styles.pid} style={{ marginBottom: 10 }}>{t('consumer.nodeId')}: {target.peerId}</div>
    <pre>{command}</pre>
    <div className="modal-actions"><button className="secondary" onClick={onClose}>{t('consumer.close')}</button><button disabled={!apiKey} onClick={() => command && onCopy(command)}>{copied === command ? t('consumer.copied') : t('consumer.copy')}</button></div>
  </div></div>;
}

export interface RestorePreview { id: string; files: Array<{ path: string }>; environment: Array<{ name: string; source: string }> }

export function ToolConfigModal({ target, tool, origin, apiKey, inspection, stage, backups, restorePreview, working, t, onClose, onClean, onCheckAndConfigure, onPreviewRestore, onRestore }: {
  target: CurlTarget; tool: Exclude<ToolId, 'curl'>; origin: string; apiKey: ConsumerApiKeyDto | null;
  inspection: ToolConfigInspection; stage: 'inspect' | 'cleaned'; backups: ToolConfigBackup[];
  restorePreview: RestorePreview | null; working: boolean; t: Translate; onClose: () => void;
  onClean: () => void; onCheckAndConfigure: () => void; onPreviewRestore: (id: string) => void; onRestore: (id: string) => void;
}) {
  return <div className="modal-overlay" onClick={onClose}><div className="modal" onClick={(event) => event.stopPropagation()}>
    <h3>{t('consumer.toolConfigPreviewTitle', { tool })}</h3><p>{t('consumer.toolConfigPreviewDescription')}</p>
    <pre>{[`${t('consumer.previewTool')}: ${tool}`, `${t('consumer.protocol')}: ${target.protocol}`, `${t('consumer.modelName')}: ${target.model}`, `${t('consumer.nodeId')}: ${target.peerId}`, `${t('consumer.apiKey')}: ${apiKey?.name ?? ''}`, `${t('consumer.previewEndpoint')}: ${buildToolEndpoint(origin, target, tool)}`, `${t('consumer.previewConfigPath')}: ${inspection.configPath}`].join('\n')}</pre>
    <h4>{t('consumer.currentConfigTitle')}</h4><pre>{inspection.configFiles.map((file) => `${file.exists ? 'REMOVE' : 'OK'}  ${file.path}`).join('\n')}</pre>
    <h4>{t('consumer.envConflictTitle')}</h4>
    {inspection.environmentConflicts.length === 0 ? <p>{t('consumer.noEnvConflict')}</p> : <pre>{inspection.environmentConflicts.map((item) => `${item.removable ? 'REMOVE' : 'MANUAL'}  ${item.name}=${item.value}\n${item.source}${item.reason ? `\n${item.reason}` : ''}`).join('\n\n')}</pre>}
    <h4>{t('consumer.oauthConflictTitle')}</h4>
    {inspection.oauthConflicts.length === 0 ? <p>{t('consumer.noOAuthConflict')}</p> : <pre>{inspection.oauthConflicts.map((item) => `${item.removable ? 'REMOVE' : 'MANUAL'}  ${item.provider}\n${item.source}${item.reason ? `\n${item.reason}` : ''}`).join('\n\n')}</pre>}
    <p>{t(stage === 'inspect' ? 'consumer.cleanupPreviewDescription' : 'consumer.cleanupVerifyDescription')}</p>
    {restorePreview && <><h4>{t('consumer.restorePreviewTitle')}</h4><pre>{[...restorePreview.files.map((file) => `${t('consumer.restoreFile')}: ${file.path}`), ...restorePreview.environment.map((item) => `${t('consumer.restoreEnv')}: ${item.name} (${item.source})`)].join('\n')}</pre></>}
    {backups.length > 0 && !restorePreview && <div className="actions"><label>{t('consumer.availableBackups')}</label>{backups.map((backup) => <button key={backup.id} className="secondary" disabled={working} onClick={() => onPreviewRestore(backup.id)}>{t('consumer.previewRestore')} {new Date(backup.createdAt).toLocaleString()}</button>)}</div>}
    <div className="modal-actions"><button className="secondary" onClick={onClose}>{t('consumer.close')}</button>
      {restorePreview ? <button disabled={working} onClick={() => onRestore(restorePreview.id)}>{t('consumer.confirmRestore')}</button> : stage === 'inspect' && !inspection.clean ? <button disabled={working} onClick={onClean}>{t('consumer.confirmCleanup')}</button> : <button disabled={working} onClick={onCheckAndConfigure}>{t('consumer.checkAndConfigure')}</button>}
    </div>
  </div></div>;
}
