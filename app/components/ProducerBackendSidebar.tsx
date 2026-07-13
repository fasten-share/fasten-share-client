import type { Status } from '@/lib/control-client';
import { useI18n } from '@/lib/i18n/context';
import { parseModels, type Card } from './producer-form-model';
import styles from './ProducerForm.module.css';

interface Props {
  cards: Card[];
  status: Status;
  selectedId: string | null;
  newIds: Set<string>;
  busyById: Record<string, 'starting' | 'stopping' | undefined>;
  allBusy: 'starting' | 'stopping' | null;
  connected: boolean;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onSetAllEnabled: (enabled: boolean) => void;
  onRequestStartAll: () => void;
  onViewDisclaimer: () => void;
}

export function ProducerBackendSidebar(props: Props) {
  const { t } = useI18n();
  const { cards, status, selectedId, newIds, busyById, allBusy, connected } = props;
  const anyEnabled = status.producer.backends.some((backend) => backend.enabled);
  const anyChecking = status.producer.backends.some((backend) => backend.checking);
  const anySaved = cards.some((card) => !newIds.has(card.id));

  return (
    <div className={styles.sidebar}>
      <button className={styles.fullWidth} onClick={props.onAdd}>＋ {t('producer.addBackend')}</button>
      <div className={styles.backendList}>
        {cards.length === 0 && <p className="muted small">{t('producer.noBackends')}</p>}
        {cards.map((card, index) => {
          const backend = status.producer.backends.find((item) => item.id === card.id);
          const isDraft = newIds.has(card.id);
          const enabled = backend?.enabled ?? false;
          const registered = status.producer.registered && !!backend?.advertised;
          const health = backend?.lastHealth;
          const healthClass = health ? (health.ok ? styles.ok : styles.error) : styles.unknown;
          const statusClass = isDraft || !enabled ? styles.unknown : registered && health?.ok ? styles.ok : styles.warning;
          const label = `[${index + 1}] ${card.protocol}/${parseModels(card.modelsText)[0] ?? '—'}`;
          const healthTitle = !health ? t('producer.healthReasonUnknown') : health.ok
            ? t('producer.healthOk')
            : t('producer.healthFailed', { reason: health.reason ?? t('producer.healthReasonUnknown') });
          return (
            <div key={card.id} className={`${styles.backendItem} ${selectedId === card.id ? styles.active : ''}`} onClick={() => props.onSelect(card.id)}>
              <div className={styles.backendItemBody}>
                <div className={styles.backendItemName} title={label}>{label}</div>
                <div className={styles.backendStatus}>
                  <StatusDot label={t('producer.status')} className={statusClass} />
                  <StatusDot label={t('producer.running')} className={enabled ? styles.ok : styles.unknown} />
                  <StatusDot label={t('producer.registered')} className={registered ? styles.ok : styles.unknown} />
                  <StatusDot label={t('producer.health')} className={healthClass} title={healthTitle} />
                </div>
              </div>
              <button type="button" className={styles.trash} aria-label={t('producer.removeBackend')} title={t('producer.removeBackend')}
                disabled={enabled || !!busyById[card.id] || !!allBusy}
                onClick={(event) => { event.stopPropagation(); props.onRemove(card.id); }}>🗑</button>
            </div>
          );
        })}
      </div>
      {anySaved && (
        <div className={styles.sidebarAction}>
          {anyEnabled || allBusy === 'stopping' ? (
            <button className={`danger ${styles.stopAll}`} onClick={() => props.onSetAllEnabled(false)} disabled={!connected || !!allBusy || anyChecking}>
              {allBusy === 'stopping' ? t('producer.stopping') : anyChecking ? t('producer.starting') : t('producer.stopAll')}
            </button>
          ) : (
            <button className={styles.stopAll} onClick={props.onRequestStartAll} disabled={!connected || !!allBusy}>
              {allBusy === 'starting' ? t('producer.starting') : t('producer.startAll')}
            </button>
          )}
          <button type="button" className={styles.disclaimerLink} onClick={props.onViewDisclaimer}>{t('producer.disclaimerLink')}</button>
        </div>
      )}
    </div>
  );
}

function StatusDot({ label, className, title }: { label: string; className: string; title?: string }) {
  return <span className={styles.statusRow}><span className={styles.statusLabel}>{label}</span><span className={`${styles.healthDot} ${className}`} title={title} /></span>;
}
