'use client';

import { useI18n } from '@/lib/i18n/context';
import styles from './SharingDisclaimerModal.module.css';

export function SharingDisclaimerModal({
  requiresAcceptance,
  onAccept,
  onClose,
}: {
  requiresAcceptance: boolean;
  onAccept: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sharing-disclaimer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="sharing-disclaimer-title">{t('producer.disclaimerTitle')}</h3>
        <p className={styles.content}>{t('producer.disclaimerContent')}</p>

        <div className="modal-actions">
          {requiresAcceptance ? (
            <>
              <button className="secondary" onClick={onClose}>
                {t('producer.disclaimerCancel')}
              </button>
              <button onClick={onAccept}>{t('producer.disclaimerAccept')}</button>
            </>
          ) : (
            <button className="secondary" onClick={onClose}>
              {t('settings.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
