'use client';

import { useI18n } from '@/lib/i18n/context';
import styles from './BaseUrlGuideModal.module.css';

/** Guide for a version-less upstream base URL and its advertised version prefix. */

interface GuideRow {
  protocol: string;
  baseUrl: string;
  versionPrefix: string;
  consumer: string;
}

// URLs are language-neutral, so the table data lives here rather than in i18n.
const GUIDE: GuideRow[] = [
  {
    protocol: 'openai',
    baseUrl: 'https://api.openai.com',
    versionPrefix: '/v1',
    consumer: '{host}/openai/{model}/{peerId}/v1/chat/completions',
  },
  {
    protocol: 'openai-response',
    baseUrl: 'https://api.openai.com',
    versionPrefix: '/v1',
    consumer: '{host}/openai-response/{model}/{peerId}/v1/responses',
  },
  {
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    versionPrefix: '/v1',
    consumer: '{host}/anthropic/{model}/{peerId}/v1/messages',
  },
  {
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    versionPrefix: '/v1beta',
    consumer: '{host}/gemini/{model}/{peerId}/v1beta/models/{model}:generateContent',
  },
  {
    protocol: 'azure-openai',
    baseUrl: 'https://{resource}.openai.azure.com',
    versionPrefix: '/openai',
    consumer: '{host}/azure-openai/{model}/{peerId}/openai/deployments/{model}/chat/completions?api-version=...',
  },
  {
    protocol: 'ollama',
    baseUrl: 'http://localhost:11434',
    versionPrefix: '/v1',
    consumer: '{host}/ollama/{model}/{peerId}/v1/chat/completions',
  },
];

export function BaseUrlGuideModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('producer.baseUrlGuideTitle')}</h3>
        <div className="hint" style={{ marginBottom: 12 }}>
          {t('producer.baseUrlGuideIntro')}
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('producer.baseUrlGuideColProtocol')}</th>
              <th>{t('producer.baseUrlGuideColBaseUrl')}</th>
              <th>{t('producer.baseUrlGuideColVersionPrefix')}</th>
              <th>{t('producer.baseUrlGuideColConsumer')}</th>
            </tr>
          </thead>
          <tbody>
            {GUIDE.map((row) => (
              <tr key={row.protocol}>
                <td>{row.protocol}</td>
                <td>
                  <code>{row.baseUrl}</code>
                </td>
                <td>
                  <code>{row.versionPrefix}</code>
                </td>
                <td>
                  <code>{row.consumer}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
