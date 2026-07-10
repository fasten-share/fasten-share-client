'use client';

import { useState } from 'react';
import { normalizeMaxConcurrency } from '@/lib/concurrency';
import { normalizeCostMultiplier } from '@/lib/cost';
import { useI18n } from '@/lib/i18n/context';
import { TOOL_IDS, normalizeSupportedTools, toolsForProtocol } from '@/lib/tool-support';
import { defaultVersionPrefix, normalizeVersionPrefix } from '@/lib/version-prefix';
import { BaseUrlGuideModal } from './BaseUrlGuideModal';
import {
  LOCAL_PRESET,
  ONLINE_PRESET,
  type Draft,
} from './producer-form-model';
import styles from './ProducerForm.module.css';

export function BackendFields({
  value,
  disabled = false,
  onChange,
}: {
  value: Draft;
  disabled?: boolean;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const { t } = useI18n();
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  return (
    <>
      <div className="row">
        <div>
          <label className={styles.labelWithAction}>
            {t('producer.hostBaseUrl')}
            <button type="button" className={styles.linkButton} onClick={() => setShowGuide(true)} disabled={disabled}>
              {t('producer.baseUrlGuide')}
            </button>
          </label>
          <input value={value.baseUrl} disabled={disabled} onChange={(e) => onChange({ baseUrl: e.target.value })} />
        </div>
        <div>
          <label>{t('producer.protocolPrefix')}</label>
          <select
            value={value.protocol}
            disabled={disabled}
            onChange={(e) => {
              const protocol = e.target.value;
              const previousDefault = defaultVersionPrefix(value.protocol);
              onChange({
                protocol,
                supportedTools: normalizeSupportedTools(value.supportedTools, protocol),
                versionPrefix: value.versionPrefix === previousDefault
                  ? defaultVersionPrefix(protocol)
                  : value.versionPrefix,
              });
            }}
          >
            <option value="openai">openai</option>
            <option value="openai-response">openai-response</option>
            <option value="gemini">gemini</option>
            <option value="anthropic">anthropic</option>
            <option value="azure-openai">azure-openai</option>
            <option value="ollama">ollama</option>
          </select>
        </div>
      </div>

      <label>{t('producer.versionPrefix')}</label>
      <input
        value={value.versionPrefix}
        disabled={disabled}
        onChange={(e) => onChange({ versionPrefix: e.target.value })}
        onBlur={(e) => {
          const normalized = normalizeVersionPrefix(e.target.value);
          if (normalized) onChange({ versionPrefix: normalized });
        }}
        placeholder={defaultVersionPrefix(value.protocol)}
      />
      <div className="hint">{t('producer.versionPrefixHint')}</div>

      {value.protocol === 'azure-openai' && (
        <div>
          <label>{t('producer.apiVersion')}</label>
          <input value={value.apiVersion} disabled={disabled} onChange={(e) => onChange({ apiVersion: e.target.value })} placeholder="2024-10-21" />
        </div>
      )}

      <label>{t('producer.supportedTools')}</label>
      <div className={styles.toolList}>
        {TOOL_IDS.filter((tool) => toolsForProtocol(value.protocol).includes(tool)).map((tool) => {
          const checked = value.supportedTools.includes(tool);
          return (
            <label key={tool} className={styles.toolOption}>
              <input
                type="checkbox"
                disabled={disabled || (checked && value.supportedTools.length === 1)}
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...value.supportedTools, tool]
                    : value.supportedTools.filter((item) => item !== tool);
                  onChange({ supportedTools: normalizeSupportedTools(next, value.protocol) });
                }}
              />
              {tool}
            </label>
          );
        })}
      </div>
      <div className="hint">{t('producer.supportedToolsHint')}</div>

      <div className="actions">
        <button className="secondary" disabled={disabled} onClick={() => onChange({ baseUrl: value.baseUrl === LOCAL_PRESET ? ONLINE_PRESET : LOCAL_PRESET })}>
          {t('producer.togglePreset')}
        </button>
      </div>

      <label>{t('producer.apiKey')}</label>
      <div className={styles.secretField}>
        <input type={showApiKey ? 'text' : 'password'} value={value.apiKey} disabled={disabled} onChange={(e) => onChange({ apiKey: e.target.value })} placeholder={t('producer.apiKeyPlaceholder')} />
        <button
          type="button"
          className={styles.secretToggle}
          disabled={disabled}
          onClick={() => setShowApiKey((visible) => !visible)}
          aria-label={showApiKey ? t('producer.hideApiKey') : t('producer.showApiKey')}
          title={showApiKey ? t('producer.hide') : t('producer.show')}
        >
          {showApiKey ? '🙈' : '👁'}
        </button>
      </div>

      <label>{t('producer.exposedModels')}</label>
      <textarea rows={2} value={value.modelsText} disabled={disabled} onChange={(e) => onChange({ modelsText: e.target.value })} placeholder="qwen2.5:7b, llama3.1:8b" />

      <label className={styles.labelWithHelp}>
        {t('producer.costMultiplier')}
        <span className={styles.helpDot} title={t('producer.costMultiplierHelp')} aria-label={t('producer.costMultiplierHelp')}>?</span>
      </label>
      <input type="number" disabled={disabled} min="0.01" max="100" step="0.01" value={value.costMultiplier} onChange={(e) => onChange({ costMultiplier: normalizeCostMultiplier(e.target.value) })} />

      <label>{t('producer.maxConcurrency')}</label>
      <input type="number" disabled={disabled} min="1" step="1" value={value.maxConcurrency} onChange={(e) => onChange({ maxConcurrency: normalizeMaxConcurrency(e.target.value) })} />

      {showGuide && <BaseUrlGuideModal onClose={() => setShowGuide(false)} />}
    </>
  );
}
