'use client';

import { useI18n } from '@/lib/i18n/context';
import styles from './UserAgreementModal.module.css';

export function UserAgreementModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section
        className={`modal ${styles.modal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-agreement-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="user-agreement-title">{t('login.agreementTitle')}</h3>
        <div className={styles.content}>{t('login.agreementContent')}</div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            {t('login.agreementClose')}
          </button>
        </div>
      </section>
    </div>
  );
}
