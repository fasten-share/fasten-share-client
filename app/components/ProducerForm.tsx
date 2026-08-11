'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { control, newBackendId, type Status } from '@/lib/control-client';
import { normalizeVersionPrefix } from '@/lib/version-prefix';
import { useI18n } from '@/lib/i18n/context';
import { SharingDisclaimerModal } from './SharingDisclaimerModal';
import { useConfirmDialog } from './ConfirmDialogProvider';
import { useToast } from './ToastProvider';
import { BackendFields } from './ProducerBackendFields';
import { ProducerBackendSidebar } from './ProducerBackendSidebar';
import { ProducerTrafficPanel } from './ProducerTrafficPanel';
import {
  DISCLAIMER_ACCEPTED_KEY,
  emptyDraft,
  parseModels,
  toCard,
  toInput,
  type Card,
  type Draft,
} from './producer-form-model';
import styles from './ProducerForm.module.css';

/** A start/stop the user asked for. The token makes each attempt distinguishable
 *  so repeating an action notifies again instead of being deduped away. */
interface PendingAction {
  kind: 'starting' | 'stopping';
  token: number;
}

/** A start is done once the health gate stops checking; a stop once it is off the air. */
function isSettled(
  action: PendingAction,
  backends: Status['producer']['backends'],
  id: string,
): boolean {
  const backend = backends.find((item) => item.id === id);
  return action.kind === 'starting' ? !!backend && !backend.checking : backend?.enabled === false;
}

export function ProducerForm({
  status,
  onChanged,
  notice,
}: {
  status: Status;
  onChanged: (s: Status) => void;
  notice?: string;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirmAction } = useConfirmDialog();
  // The server config is the source of truth; local state holds only what the
  // server does not know yet — unsaved edits and never-added drafts. The card
  // list is derived during render, so there is no config->state mirroring
  // effect that can drift out of sync.
  const [overrides, setOverrides] = useState<Record<string, Card>>({});
  const [drafts, setDrafts] = useState<Card[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msgById, setMsgById] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, PendingAction>>({});
  const [allBusy, setAllBusy] = useState<'starting' | 'stopping' | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [requiresDisclaimerAcceptance, setRequiresDisclaimerAcceptance] = useState(false);
  const pendingShareRef = useRef<(() => Promise<void>) | null>(null);
  const tokenRef = useRef(0);
  const notifiedRef = useRef<Set<number>>(new Set());

  const connected = status.signaling.connected;

  const { cards, newIds } = useMemo(() => {
    const persisted = status.config.backends.map(toCard);
    const persistedIds = new Set(persisted.map((card) => card.id));
    // A draft the server has adopted is no longer a draft; drop the local copy.
    const unsaved = drafts.filter((card) => !persistedIds.has(card.id));
    return {
      cards: [...persisted.map((card) => overrides[card.id] ?? card), ...unsaved],
      newIds: new Set(unsaved.map((card) => card.id)),
    };
  }, [status.config.backends, overrides, drafts]);

  // A backend stays "busy" only until the live status proves the daemon settled.
  const busyById = useMemo(() => {
    const busy: Record<string, 'starting' | 'stopping' | undefined> = {};
    for (const [id, action] of Object.entries(pending)) {
      if (!isSettled(action, status.producer.backends, id)) busy[id] = action.kind;
    }
    return busy;
  }, [pending, status.producer.backends]);

  // Health-gate outcomes land long after the click, so they are announced
  // instead of left as a stale inline message. Tracking by token keeps
  // StrictMode's double-invocation from raising the same toast twice.
  useEffect(() => {
    for (const [id, action] of Object.entries(pending)) {
      if (notifiedRef.current.has(action.token)) continue;
      if (!isSettled(action, status.producer.backends, id)) continue;
      notifiedRef.current.add(action.token);
      const backend = status.producer.backends.find((item) => item.id === id);
      if (action.kind === 'stopping') {
        showToast(t('producer.stopped'), { tone: 'info' });
      } else if (backend?.lastHealth?.ok) {
        showToast(t('producer.savedStarted'), { tone: 'success' });
      } else {
        showToast(
          t('producer.healthCheckFailed', {
            reason: backend?.lastHealth?.reason ?? t('producer.healthReasonUnknown'),
          }),
          { tone: 'error' },
        );
      }
    }
  }, [pending, status.producer.backends, showToast, t]);

  // A backend pulled off the air by the health gate must not fail silently.
  useEffect(() => {
    const onBackendDown = (event: Event) => {
      const reason = (event as CustomEvent<string>).detail;
      showToast(t('producer.backendDownAlert', { reason }), { tone: 'warning' });
    };
    window.addEventListener('fs:backend-down', onBackendDown);
    return () => window.removeEventListener('fs:backend-down', onBackendDown);
  }, [showToast, t]);

  function beginPending(id: string, kind: PendingAction['kind']): void {
    tokenRef.current += 1;
    setPending((current) => ({ ...current, [id]: { kind, token: tokenRef.current } }));
  }

  /** Drop a request that failed before the daemon ever saw it. */
  function clearPending(id: string): void {
    setPending((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function setOverride(card: Card): void {
    setOverrides((current) => ({ ...current, [card.id]: card }));
  }

  /** Forget a local edit so the server's own copy shows through again. */
  function clearOverride(id: string): void {
    setOverrides((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function patchCard(id: string, patch: Partial<Draft>): void {
    const card = cards.find((item) => item.id === id);
    if (!card) return;
    const edited = { ...card, ...patch };
    if (newIds.has(id)) setDrafts((current) => current.map((item) => (item.id === id ? edited : item)));
    else setOverride(edited);
  }

  function hasInvalidVersionPrefix(c: Card): boolean {
    if (normalizeVersionPrefix(c.versionPrefix)) return false;
    setMsgById((p) => ({ ...p, [c.id]: t('producer.versionPrefixInvalid') }));
    return true;
  }

  function hasDuplicateOffering(c: Card, candidates = cards, includeInactive = false): boolean {
    const protocols = [c.protocol.trim(), ...c.protocolConversions];
    const otherOfferings = new Set(
      candidates
        .filter(
          (other) =>
            other.id !== c.id &&
            (includeInactive || status.producer.backends.some((backend) => backend.id === other.id && backend.enabled)),
        )
        .flatMap((other) => [other.protocol.trim(), ...other.protocolConversions]
          .flatMap((protocol) => parseModels(other.modelsText).map((model) => `${protocol}\0${model}`))),
    );
    const models = parseModels(c.modelsText);
    const duplicate = protocols.flatMap((protocol) => models.map((model) => ({ protocol, model })))
      .find(({ protocol, model }, index, offerings) =>
        otherOfferings.has(`${protocol}\0${model}`)
        || offerings.findIndex((item) => item.protocol === protocol && item.model === model) !== index);
    if (!duplicate) return false;
    setMsgById((p) => ({
      ...p,
      [c.id]: t('producer.duplicateProtocolModel', duplicate),
    }));
    return true;
  }

  function addNew(): void {
    const card: Card = { ...emptyDraft(), id: newBackendId(), enabled: true };
    setDrafts((current) => [...current, card]);
    setSelectedId(card.id);
    setMsgById((p) => ({ ...p, [card.id]: '' }));
  }

  async function addDraft(c: Card) {
    if (hasInvalidVersionPrefix(c) || hasDuplicateOffering(c)) return;
    beginPending(c.id, 'starting');
    setMsgById((p) => ({ ...p, [c.id]: '' }));
    try {
      onChanged(await control({ action: 'addBackend', backend: toInput(c) }));
      setDrafts((current) => current.filter((card) => card.id !== c.id));
      clearOverride(c.id);
    } catch (error) {
      clearPending(c.id);
      showToast(`${t('producer.saveFailed')} ${(error as Error).message}`, { tone: 'error' });
    }
  }

  /** Save this backend and (re)start sharing it — re-runs its health gate. */
  async function saveStart(c: Card) {
    if (hasInvalidVersionPrefix(c) || hasDuplicateOffering(c)) return;
    if (newIds.has(c.id)) {
      await addDraft(c);
      return;
    }
    const started: Card = { ...c, enabled: true };
    setOverride(started);
    beginPending(c.id, 'starting');
    setMsgById((p) => ({ ...p, [c.id]: '' }));
    try {
      onChanged(await control({ action: 'updateBackend', backend: toInput(started) }));
      clearOverride(c.id);
    } catch (error) {
      setOverride(c);
      clearPending(c.id);
      showToast(`${t('producer.saveFailed')} ${(error as Error).message}`, { tone: 'error' });
    }
  }

  /** Stop sharing just this backend (config kept; takes it off the air). */
  async function stopOne(c: Card) {
    setOverride({ ...c, enabled: false });
    beginPending(c.id, 'stopping');
    try {
      onChanged(await control({ action: 'setBackendEnabled', id: c.id, enabled: false }));
      clearOverride(c.id);
    } catch (error) {
      setOverride(c);
      clearPending(c.id);
      showToast(`${t('producer.stopFailed')} ${(error as Error).message}`, { tone: 'error' });
    }
  }

  async function removeCard(id: string) {
    const card = cards.find((c) => c.id === id);
    const name = card
      ? `${card.protocol}/${parseModels(card.modelsText)[0] ?? '—'}`
      : id;
    const confirmed = await confirmAction({
      message: t('producer.removeConfirm', { name }),
      confirmLabel: t('producer.removeConfirmLabel'),
      tone: 'danger',
    });
    if (!confirmed) return;
    if (selectedId === id) setSelectedId(cards.find((c) => c.id !== id)?.id ?? null);
    if (newIds.has(id)) {
      setDrafts((current) => current.filter((c) => c.id !== id));
      showToast(t('producer.removed'), { tone: 'info' });
      return;
    }
    try {
      onChanged(await control({ action: 'removeBackend', id }));
      clearOverride(id);
      showToast(t('producer.removed'), { tone: 'success' });
    } catch (error) {
      setSelectedId(id);
      showToast(`${t('producer.removeFailed')} ${(error as Error).message}`, { tone: 'error' });
    }
  }

  /** Start or stop every saved backend at once (drafts are untouched). */
  async function setAllEnabled(enabled: boolean) {
    if (allBusy) return;
    const previousOverrides = overrides;
    setAllBusy(enabled ? 'starting' : 'stopping');
    const savedCards = cards.filter((c) => !newIds.has(c.id));
    // Starting everything must not advertise the same protocol/model twice, so
    // a conflicting backend is skipped instead of quietly shadowing another.
    const offerings = new Set<string>();
    let duplicate: { card: Card; offering: string } | undefined;
    const enabledIds = new Set<string>();
    if (enabled) {
      for (const card of savedCards) {
        const models = parseModels(card.modelsText);
        const protocols = [card.protocol.trim(), ...card.protocolConversions];
        const keys = protocols.flatMap((protocol) => models.map((model) => `${protocol}\0${model}`));
        const conflictIndex = keys.findIndex((key, index) => offerings.has(key) || keys.indexOf(key) !== index);
        if (conflictIndex >= 0) {
          duplicate ??= { card, offering: keys[conflictIndex].replace('\0', '/') };
          continue;
        }
        keys.forEach((key) => offerings.add(key));
        enabledIds.add(card.id);
      }
    }
    const updated = savedCards.map((card) => ({
      ...card,
      enabled: enabled && enabledIds.has(card.id),
    }));
    setOverrides({
      ...previousOverrides,
      ...Object.fromEntries(updated.map((card) => [card.id, card])),
    });
    try {
      onChanged(await control({
        action: 'setBackends', backends: updated.map(toInput), configRevision: status.configRevision,
      }));
      setOverrides({});
      showToast(enabled ? t('producer.startedAll') : t('producer.stoppedAll'), {
        tone: enabled ? 'success' : 'info',
      });
    } catch (error) {
      setOverrides(previousOverrides);
      showToast(
        `${enabled ? t('producer.saveFailed') : t('producer.stopFailed')} ${(error as Error).message}`,
        { tone: 'error' },
      );
    } finally {
      setAllBusy(null);
    }
    if (duplicate) {
      // A skipped offering is a per-backend problem the user must fix, so it
      // stays inline on that card rather than scrolling away in a toast.
      setSelectedId(duplicate.card.id);
      setMsgById((current) => ({
        ...current,
        [duplicate.card.id]: t('producer.startAllDuplicateSkipped', { offering: duplicate.offering }),
      }));
    }
  }

  /** Stopping everything at once is disruptive to live consumers — gate it. */
  async function confirmStopAll(): Promise<void> {
    const confirmed = await confirmAction({
      message: t('producer.stopAllConfirm'),
      confirmLabel: t('producer.stopAllConfirmLabel'),
      tone: 'danger',
    });
    if (confirmed) await setAllEnabled(false);
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

  // Falling back to the first card keeps the panel populated when the selection
  // disappears (removed here, or removed on another device and pushed to us).
  const selected = cards.find((c) => c.id === selectedId) ?? cards[0] ?? null;
  // Start/stop state is read STRICTLY from the live producer status (the running
  // daemon is the source of truth). A backend missing from status — not started,
  // stopped, or the transport is down — counts as not sharing. We don't fall back
  // to the persisted config's `enabled`, which does not prove the daemon is live.
  const enabledOf = (id: string): boolean =>
    status.producer.backends.find((b) => b.id === id)?.enabled ?? false;
  return (
    <div>
      <div className="card">
        <h2>{t('producer.backends')}</h2>
        <div className={styles.layout}>
          <ProducerBackendSidebar
            cards={cards} status={status} selectedId={selected?.id ?? null} newIds={newIds}
            busyById={busyById} allBusy={allBusy} connected={connected}
            onAdd={addNew} onSelect={setSelectedId} onRemove={(id) => void removeCard(id)}
            onSetAllEnabled={(enabled) => void (enabled ? setAllEnabled(true) : confirmStopAll())}
            onRequestStartAll={() => requestShare(() => setAllEnabled(true))}
            onViewDisclaimer={viewDisclaimer}
          />

          {/* Right detail panel: edit the selected backend. */}
          <div className={styles.detail}>
            {selected ? (
              <>
                <BackendFields
                  value={selected}
                  disabled={enabledOf(selected.id) || !!busyById[selected.id] || !!allBusy}
                  onChange={(patch) => patchCard(selected.id, patch)}
                />
                <div className="actions">
                  {busyById[selected.id] === 'starting' ? (
                    <button disabled>{t('producer.starting')}</button>
                  ) : enabledOf(selected.id) ? (
                    <button className="danger" onClick={() => stopOne(selected)} disabled={!connected || !!busyById[selected.id] || !!allBusy}>
                      {busyById[selected.id] === 'stopping' ? t('producer.stopping') : t('producer.stop')}
                    </button>
                  ) : (
                    <button onClick={() => requestShare(() => saveStart(selected))} disabled={!connected || !!busyById[selected.id] || !!allBusy}>
                      {busyById[selected.id] === 'starting' ? t('producer.starting') : t('producer.saveStart')}
                    </button>
                  )}
                  <button type="button" className={styles.disclaimerLink} onClick={viewDisclaimer}>
                    {t('producer.disclaimerLink')}
                  </button>
                </div>
                {/* Only validation problems remain inline now — operation
                    results go to toasts — so this is always an error. */}
                {msgById[selected.id] && (
                  <div className="hint err" role="alert">{msgById[selected.id]}</div>
                )}
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

      <ProducerTrafficPanel status={status} />

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
