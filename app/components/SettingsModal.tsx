'use client';

import { useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { LANGS, type Lang } from '@/lib/i18n/dictionary';
import {
  EMPTY_STATE,
  dismissOnboarding,
  getState,
  showOnboarding,
  subscribeToOnboarding,
} from '@/lib/onboarding';
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
  userId = '',
}: {
  onClose: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  autoShare: boolean;
  setAutoShare: (v: boolean) => void | Promise<void>;
  userId?: string;
}) {
  const { t } = useI18n();

  // Track dismissal so a user who hit "Don't show again" can bring the
  // get-started guide back from this menu.
  const onboarding = useSyncExternalStore(
    subscribeToOnboarding,
    () => getState(userId),
    () => EMPTY_STATE,
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('settings.title')}</h3>

        <div className={styles.body}>
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
              />
              {t('settings.autoShare')}
            </label>
          </div>
          <div className={styles.hint}>{t('settings.autoShareHint')}</div>

          {userId && (
            <div className={styles.row}>
              <label>{t('settings.getStartedGuide')}</label>
              {onboarding.dismissed ? (
                <button
                  type="button"
                  className={styles.guideButton}
                  onClick={() => showOnboarding(userId)}
                >
                  {t('onboarding.showAgain')}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.guideButton}
                  onClick={() => dismissOnboarding(userId)}
                >
                  {t('onboarding.dismiss')}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
