'use client';

import { useI18n } from '@/lib/i18n/context';
import { LANGS, type Lang } from '@/lib/i18n/dictionary';
import styles from './SettingsModal.module.css';

/**
 * Settings dialog opened from the topbar gear. Holds the language switch (moved
 * out of the topbar) and the "auto-share on load" preference. Reuses the shared
 * modal shell styles from globals.css.
 */
export function SettingsModal({
  onClose,
  lang,
  setLang,
  autoShare,
  setAutoShare,
}: {
  onClose: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  autoShare: boolean;
  setAutoShare: (v: boolean) => void | Promise<void>;
}) {
  const { t } = useI18n();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('settings.title')}</h3>

        <div className={styles.row}>
          <label>{t('settings.language')}</label>
          <div className={styles.languageSwitch}>
            {LANGS.map((l) => (
              <button
                key={l.value}
                className={lang === l.value ? styles.active : ''}
                onClick={() => setLang(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.row}>
          <label>
            <input
              type="checkbox"
              checked={autoShare}
              onChange={(e) => setAutoShare(e.target.checked)}
            />{' '}
            {t('settings.autoShare')}
          </label>
        </div>
        <div className="hint">{t('settings.autoShareHint')}</div>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
