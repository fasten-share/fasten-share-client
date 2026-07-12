'use client';

import { useRef, useState } from 'react';
import { control, loadBackends, newBackendId, saveBackends, type Status } from '@/lib/control-client';
import { normalizeVersionPrefix } from '@/lib/version-prefix';
import { useI18n } from '@/lib/i18n/context';
import { SharingDisclaimerModal } from './SharingDisclaimerModal';
import { BackendFields } from './ProducerBackendFields';
import {
  DISCLAIMER_ACCEPTED_KEY,
  emptyDraft,
  parseModels,
  producerCards,
  toInput,
  toStored,
  type Card,
  type Draft,
} from './producer-form-model';
import styles from './ProducerForm.module.css';

export function ProducerForm({
  status,
  onChanged,
  notice,
  currentUserId,
}: {
  status: Status;
  onChanged: (s: Status) => void;
  notice?: string;
  currentUserId: string;
}) {
  const { t } = useI18n();
  const initialCards = () => producerCards(status.config.backends, loadBackends(currentUserId));
  const [cards, setCards] = useState<Card[]>(initialCards);
  // Ids that exist locally but were never added to the server yet (drafts).
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(() => initialCards()[0]?.id ?? null);
  const [msgById, setMsgById] = useState<Record<string, string>>({});
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [requiresDisclaimerAcceptance, setRequiresDisclaimerAcceptance] = useState(false);
  const pendingShareRef = useRef<(() => Promise<void>) | null>(null);

  const connected = status.signaling.connected;

  /** Persist only the already-saved backends (drafts are excluded). */
  function persist(list: Card[], drafts: Set<string>): void {
    saveBackends(currentUserId, list.filter((c) => !drafts.has(c.id)).map(toStored));
  }

  function patchCard(id: string, patch: Partial<Draft>): void {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function failMsg(reason?: string): string {
    return t('producer.healthCheckFailed', { reason: reason ?? t('producer.healthReasonUnknown') });
  }

  function hasInvalidVersionPrefix(c: Card): boolean {
    if (normalizeVersionPrefix(c.versionPrefix)) return false;
    setMsgById((p) => ({ ...p, [c.id]: t('producer.versionPrefixInvalid') }));
    return true;
  }

  function hasDuplicateOffering(c: Card, candidates = cards, includeInactive = false): boolean {
    const protocol = c.protocol.trim();
    const otherOfferings = new Set(
      candidates
        .filter(
          (other) =>
            other.id !== c.id &&
            other.protocol.trim() === protocol &&
            (includeInactive || status.producer.backends.some((backend) => backend.id === other.id && backend.enabled)),
        )
        .flatMap((other) => parseModels(other.modelsText)),
    );
    const duplicate = parseModels(c.modelsText).find((model, index, models) =>
      otherOfferings.has(model) || models.indexOf(model) !== index,
    );
    if (!duplicate) return false;
    setMsgById((p) => ({
      ...p,
      [c.id]: t('producer.duplicateProtocolModel', { protocol, model: duplicate }),
    }));
    return true;
  }

  function addNew(): void {
    const card: Card = { ...emptyDraft(), id: newBackendId(), enabled: true };
    setCards((prev) => [...prev, card]);
    setNewIds((prev) => new Set(prev).add(card.id));
    setSelectedId(card.id);
    setMsgById((p) => ({ ...p, [card.id]: '' }));
  }

  async function addDraft(c: Card) {
    if (hasInvalidVersionPrefix(c) || hasDuplicateOffering(c)) return;
    const s = await control({ action: 'addBackend', backend: toInput(c) });
    onChanged(s);
    if (s.check && !s.check.ok) {
      setMsgById((p) => ({ ...p, [c.id]: failMsg(s.check?.reason) }));
      return;
    }
    const drafts = new Set(newIds);
    drafts.delete(c.id);
    setNewIds(drafts);
    persist(cards, drafts);
    setMsgById((p) => ({ ...p, [c.id]: t('producer.savedStarted') }));
  }

  /** Save this backend and (re)start sharing it — re-runs its health gate. */
  async function saveStart(c: Card) {
    if (hasInvalidVersionPrefix(c) || hasDuplicateOffering(c)) return;
    if (newIds.has(c.id)) {
      await addDraft(c);
      return;
    }
    const started: Card = { ...c, enabled: true };
    const next = cards.map((x) => (x.id === c.id ? started : x));
    setCards(next);
    persist(next, newIds);
    const s = await control({ action: 'updateBackend', backend: toInput(started) });
    onChanged(s);
    setMsgById((p) => ({
      ...p,
      [c.id]: s.check && !s.check.ok ? failMsg(s.check.reason) : t('producer.savedStarted'),
    }));
  }

  /** Stop sharing just this backend (config kept; takes it off the air). */
  async function stopOne(c: Card) {
    const stopped: Card = { ...c, enabled: false };
    const next = cards.map((x) => (x.id === c.id ? stopped : x));
    setCards(next);
    persist(next, newIds);
    onChanged(await control({ action: 'setBackendEnabled', id: c.id, enabled: false }));
    setMsgById((p) => ({ ...p, [c.id]: t('producer.stopped') }));
  }

  async function removeCard(id: string) {
    const isDraft = newIds.has(id);
    const nextCards = cards.filter((c) => c.id !== id);
    const drafts = new Set(newIds);
    drafts.delete(id);
    setCards(nextCards);
    setNewIds(drafts);
    if (selectedId === id) setSelectedId(nextCards[0]?.id ?? null);
    persist(nextCards, drafts);
    if (!isDraft) onChanged(await control({ action: 'removeBackend', id }));
  }

  /** Start or stop every saved backend at once (drafts are untouched). */
  async function setAllEnabled(enabled: boolean) {
    const savedCards = cards.filter((c) => !newIds.has(c.id));
    if (enabled) {
      const offerings = new Set<string>();
      let duplicate: { card: Card; offering: string } | undefined;
      const enabledIds = new Set<string>();
      for (const card of savedCards) {
        const protocol = card.protocol.trim();
        const models = parseModels(card.modelsText);
        const keys = models.map((model) => `${protocol}\0${model}`);
        const conflictIndex = keys.findIndex((key, index) => offerings.has(key) || keys.indexOf(key) !== index);
        if (conflictIndex >= 0) {
          duplicate ??= { card, offering: `${protocol}/${models[conflictIndex]}` };
          continue;
        }
        keys.forEach((key) => offerings.add(key));
        enabledIds.add(card.id);
      }
      const next = cards.map((c) =>
        newIds.has(c.id) ? c : { ...c, enabled: enabledIds.has(c.id) },
      );
      setCards(next);
      persist(next, newIds);
      const backends = next.filter((c) => !newIds.has(c.id)).map(toInput);
      onChanged(await control({ action: 'setBackends', backends }));
      if (duplicate) {
        setSelectedId(duplicate.card.id);
        setMsgById((current) => ({
          ...current,
          [duplicate.card.id]: t('producer.startAllDuplicateSkipped', { offering: duplicate.offering }),
        }));
      }
      return;
    }
    const next = cards.map((c) => (newIds.has(c.id) ? c : { ...c, enabled }));
    setCards(next);
    persist(next, newIds);
    const backends = next.filter((c) => !newIds.has(c.id)).map((c) => toInput({ ...c, enabled }));
    onChanged(await control({ action: 'setBackends', backends }));
  }

  function requestShare(action: () => Promise<void>): void {
    if (window.localStorage.getItem(DISCLAIMER_ACCEPTED_KEY) === 'true') {
      void action();
      return;
    }
    pendingShareRef.current = action;
    setRequiresDisclaimerAcceptance(true);
    setShowDisclaimer(true);
  }

  function viewDisclaimer(): void {
    pendingShareRef.current = null;
    setRequiresDisclaimerAcceptance(false);
    setShowDisclaimer(true);
  }

  function closeDisclaimer(): void {
    pendingShareRef.current = null;
    setRequiresDisclaimerAcceptance(false);
    setShowDisclaimer(false);
  }

  function acceptDisclaimer(): void {
    window.localStorage.setItem(DISCLAIMER_ACCEPTED_KEY, 'true');
    const pendingShare = pendingShareRef.current;
    pendingShareRef.current = null;
    setRequiresDisclaimerAcceptance(false);
    setShowDisclaimer(false);
    if (pendingShare) void pendingShare();
  }

  const selected = cards.find((c) => c.id === selectedId) ?? null;
  // Start/stop state is read STRICTLY from the live producer status (the running
  // daemon is the source of truth). A backend missing from status — not started,
  // stopped, or the transport is down — counts as not sharing. We don't fall back
  // to the localStorage `enabled`, which can be stale (e.g. after a disconnect).
  const enabledOf = (id: string): boolean =>
    status.producer.backends.find((b) => b.id === id)?.enabled ?? false;
  const anyEnabled = status.producer.backends.some((b) => b.enabled);
  const anySaved = cards.some((c) => !newIds.has(c.id));

  function labelFor(c: Card, i: number): string {
    const model = parseModels(c.modelsText)[0] ?? '—';
    return `[${i + 1}] ${c.protocol}/${model}`;
  }

  function healthTitle(h?: { ok: boolean; reason?: string }): string {
    if (!h) return t('producer.healthReasonUnknown');
    return h.ok
      ? t('producer.healthOk')
      : t('producer.healthFailed', { reason: h.reason ?? t('producer.healthReasonUnknown') });
  }

  return (
    <div>
      <div className="card">
        <h2>{t('producer.backends')}</h2>
        <div className={styles.layout}>
          {/* Left sidebar: backend list + add button at the top. */}
          <div className={styles.sidebar}>
            <button className={styles.fullWidth} onClick={addNew}>
              ＋ {t('producer.addBackend')}
            </button>
            <div className={styles.backendList}>
              {cards.length === 0 && <p className="muted small">{t('producer.noBackends')}</p>}
              {cards.map((c, i) => {
                const bh = status.producer.backends.find((b) => b.id === c.id);
                const isDraft = newIds.has(c.id);
                const enabled = bh?.enabled ?? false; // strictly from live status
                const registered = status.producer.registered && !!bh?.advertised;
                const health = bh?.lastHealth;
                const healthClass = health ? (health.ok ? styles.ok : styles.error) : styles.unknown;
                const statusClass =
                  isDraft || !enabled
                    ? styles.unknown
                    : registered && health?.ok
                      ? styles.ok
                      : styles.warning;
                return (
                  <div
                    key={c.id}
                    className={`${styles.backendItem} ${selectedId === c.id ? styles.active : ''}`}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <div className={styles.backendItemBody}>
                      <div className={styles.backendItemName} title={labelFor(c, i)}>
                        {labelFor(c, i)}
                      </div>
                      <div className={styles.backendStatus}>
                        <span className={styles.statusRow}>
                          <span className={styles.statusLabel}>{t('producer.status')}</span>
                          <span className={`${styles.healthDot} ${statusClass}`} />
                        </span>
                        <span className={styles.statusRow}>
                          <span className={styles.statusLabel}>{t('producer.running')}</span>
                          <span className={`${styles.healthDot} ${enabled ? styles.ok : styles.unknown}`} />
                        </span>
                        <span className={styles.statusRow}>
                          <span className={styles.statusLabel}>{t('producer.registered')}</span>
                          <span className={`${styles.healthDot} ${registered ? styles.ok : styles.unknown}`} />
                        </span>
                        <span className={styles.statusRow}>
                          <span className={styles.statusLabel}>{t('producer.health')}</span>
                          <span className={`${styles.healthDot} ${healthClass}`} title={healthTitle(health)} />
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.trash}
                      aria-label={t('producer.removeBackend')}
                      title={t('producer.removeBackend')}
                      disabled={enabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeCard(c.id);
                      }}
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
            </div>
            {anySaved &&
              (anyEnabled ? (
                <div className={styles.sidebarAction}>
                  <button
                    className={`danger ${styles.stopAll}`}
                    onClick={() => setAllEnabled(false)}
                    disabled={!connected}
                  >
                    {t('producer.stopAll')}
                  </button>
                  <button type="button" className={styles.disclaimerLink} onClick={viewDisclaimer}>
                    {t('producer.disclaimerLink')}
                  </button>
                </div>
              ) : (
                <div className={styles.sidebarAction}>
                  <button
                    className={styles.stopAll}
                    onClick={() => requestShare(() => setAllEnabled(true))}
                    disabled={!connected}
                  >
                    {t('producer.startAll')}
                  </button>
                  <button type="button" className={styles.disclaimerLink} onClick={viewDisclaimer}>
                    {t('producer.disclaimerLink')}
                  </button>
                </div>
              ))}
          </div>

          {/* Right detail panel: edit the selected backend. */}
          <div className={styles.detail}>
            {selected ? (
              <>
                <BackendFields
                  value={selected}
                  disabled={enabledOf(selected.id)}
                  onChange={(patch) => patchCard(selected.id, patch)}
                />
                <div className="actions">
                  {enabledOf(selected.id) ? (
                    <button className="danger" onClick={() => stopOne(selected)} disabled={!connected}>
                      {t('producer.stop')}
                    </button>
                  ) : (
                    <button onClick={() => requestShare(() => saveStart(selected))} disabled={!connected}>
                      {t('producer.saveStart')}
                    </button>
                  )}
                  <button type="button" className={styles.disclaimerLink} onClick={viewDisclaimer}>
                    {t('producer.disclaimerLink')}
                  </button>
                </div>
                {msgById[selected.id] && <div className="hint">{msgById[selected.id]}</div>}
              </>
            ) : (
              <p className="muted">{t('producer.selectBackend')}</p>
            )}
          </div>
        </div>

        {!connected && <div className="hint">{t('common.waitingSignaling')}</div>}
        {notice && <div className="hint">{notice}</div>}
      </div>

      <div className="card">
        <div className="hint">{t('producer.healthHint')}</div>
      </div>

      {showDisclaimer && (
        <SharingDisclaimerModal
          requiresAcceptance={requiresDisclaimerAcceptance}
          onAccept={acceptDisclaimer}
          onClose={closeDisclaimer}
        />
      )}
    </div>
  );
}
