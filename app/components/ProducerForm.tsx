'use client';

import { useEffect, useRef, useState } from 'react';
import { control, newBackendId, type Status } from '@/lib/control-client';
import { normalizeVersionPrefix } from '@/lib/version-prefix';
import { useI18n } from '@/lib/i18n/context';
import { SharingDisclaimerModal } from './SharingDisclaimerModal';
import { BackendFields } from './ProducerBackendFields';
import { ProducerBackendSidebar } from './ProducerBackendSidebar';
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
  const initialCards = () => status.config.backends.map(toCard);
  const [cards, setCards] = useState<Card[]>(initialCards);
  // Ids that exist locally but were never added to the server yet (drafts).
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(() => initialCards()[0]?.id ?? null);
  const [msgById, setMsgById] = useState<Record<string, string>>({});
  const [busyById, setBusyById] = useState<Record<string, 'starting' | 'stopping' | undefined>>({});
  const [allBusy, setAllBusy] = useState<'starting' | 'stopping' | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [requiresDisclaimerAcceptance, setRequiresDisclaimerAcceptance] = useState(false);
  const pendingShareRef = useRef<(() => Promise<void>) | null>(null);

  const connected = status.signaling.connected;

  useEffect(() => {
    const persisted = status.config.backends.map(toCard);
    const persistedIds = new Set(persisted.map((card) => card.id));
    setCards((current) => {
      const currentById = new Map(current.map((card) => [card.id, card]));
      return [
        ...persisted.map((card) => dirtyIds.has(card.id) ? currentById.get(card.id) ?? card : card),
        ...current.filter((card) => newIds.has(card.id) && !persistedIds.has(card.id)),
      ];
    });
    setSelectedId((current) =>
      current && (persistedIds.has(current) || newIds.has(current))
        ? current
        : persisted[0]?.id ?? null,
    );
  }, [status.config.backends, dirtyIds, newIds]);

  useEffect(() => {
    setBusyById((current) => {
      let changed = false;
      const next = { ...current };
      for (const [id, busy] of Object.entries(current)) {
        const backend = status.producer.backends.find((item) => item.id === id);
        if (busy === 'starting' && backend && !backend.checking) {
          next[id] = undefined;
          changed = true;
          setMsgById((messages) => ({
            ...messages,
            [id]: backend.lastHealth?.ok
              ? t('producer.savedStarted')
              : t('producer.healthCheckFailed', {
                  reason: backend.lastHealth?.reason ?? t('producer.healthReasonUnknown'),
                }),
          }));
        } else if (busy === 'stopping' && backend?.enabled === false) {
          next[id] = undefined;
          changed = true;
          setMsgById((messages) => ({ ...messages, [id]: t('producer.stopped') }));
        }
      }
      return changed ? next : current;
    });
  }, [status.producer.backends, t]);

  function patchCard(id: string, patch: Partial<Draft>): void {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setDirtyIds((current) => new Set(current).add(id));
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
    setBusyById((p) => ({ ...p, [c.id]: 'starting' }));
    setMsgById((p) => ({ ...p, [c.id]: t('producer.starting') }));
    try {
      const s = await control({ action: 'addBackend', backend: toInput(c) });
      onChanged(s);
      setNewIds((current) => {
        const drafts = new Set(current);
        drafts.delete(c.id);
        return drafts;
      });
      setDirtyIds((current) => {
        const dirty = new Set(current);
        dirty.delete(c.id);
        return dirty;
      });
    } catch (error) {
      setBusyById((p) => ({ ...p, [c.id]: undefined }));
      setMsgById((p) => ({ ...p, [c.id]: `${t('producer.saveFailed')} ${(error as Error).message}` }));
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
    const next = cards.map((x) => (x.id === c.id ? started : x));
    setCards(next);
    setBusyById((p) => ({ ...p, [c.id]: 'starting' }));
    setMsgById((p) => ({ ...p, [c.id]: t('producer.starting') }));
    try {
      onChanged(await control({ action: 'updateBackend', backend: toInput(started) }));
      setDirtyIds((current) => {
        const dirty = new Set(current);
        dirty.delete(c.id);
        return dirty;
      });
    } catch (error) {
      setBusyById((p) => ({ ...p, [c.id]: undefined }));
      setMsgById((p) => ({ ...p, [c.id]: `${t('producer.saveFailed')} ${(error as Error).message}` }));
    }
  }

  /** Stop sharing just this backend (config kept; takes it off the air). */
  async function stopOne(c: Card) {
    const stopped: Card = { ...c, enabled: false };
    const next = cards.map((x) => (x.id === c.id ? stopped : x));
    setCards(next);
    setBusyById((p) => ({ ...p, [c.id]: 'stopping' }));
    setMsgById((p) => ({ ...p, [c.id]: t('producer.stopping') }));
    try {
      onChanged(await control({ action: 'setBackendEnabled', id: c.id, enabled: false }));
    } catch (error) {
      setCards((current) => current.map((item) => item.id === c.id ? c : item));
      setBusyById((p) => ({ ...p, [c.id]: undefined }));
      setMsgById((p) => ({ ...p, [c.id]: `${t('producer.stopFailed')} ${(error as Error).message}` }));
    }
  }

  async function removeCard(id: string) {
    const originalCards = cards;
    const originalSelectedId = selectedId;
    const originalDirtyIds = dirtyIds;
    const isDraft = newIds.has(id);
    const nextCards = cards.filter((c) => c.id !== id);
    const drafts = new Set(newIds);
    drafts.delete(id);
    setCards(nextCards);
    setNewIds(drafts);
    setDirtyIds((current) => {
      const dirty = new Set(current);
      dirty.delete(id);
      return dirty;
    });
    if (selectedId === id) setSelectedId(nextCards[0]?.id ?? null);
    if (!isDraft) {
      try {
        onChanged(await control({ action: 'removeBackend', id }));
      } catch (error) {
        setCards(originalCards);
        setSelectedId(originalSelectedId);
        setNewIds(newIds);
        setDirtyIds(originalDirtyIds);
        setMsgById((p) => ({ ...p, [id]: `${t('producer.removeFailed')} ${(error as Error).message}` }));
      }
    }
  }

  /** Start or stop every saved backend at once (drafts are untouched). */
  async function setAllEnabled(enabled: boolean) {
    if (allBusy) return;
    const originalCards = cards;
    setAllBusy(enabled ? 'starting' : 'stopping');
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
      const backends = next.filter((c) => !newIds.has(c.id)).map(toInput);
      try {
        onChanged(await control({
          action: 'setBackends', backends, configRevision: status.configRevision,
        }));
        setDirtyIds(new Set());
      } catch (error) {
        setCards(originalCards);
        setMsgById((current) => ({ ...current, [selectedId ?? '']: `${t('producer.saveFailed')} ${(error as Error).message}` }));
      } finally {
        setAllBusy(null);
      }
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
    const backends = next.filter((c) => !newIds.has(c.id)).map((c) => toInput({ ...c, enabled }));
    try {
      onChanged(await control({
        action: 'setBackends', backends, configRevision: status.configRevision,
      }));
      setDirtyIds(new Set());
    } catch (error) {
      setCards(originalCards);
      setMsgById((current) => ({ ...current, [selectedId ?? '']: `${t('producer.stopFailed')} ${(error as Error).message}` }));
    } finally {
      setAllBusy(null);
    }
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
  // to the persisted config's `enabled`, which does not prove the daemon is live.
  const enabledOf = (id: string): boolean =>
    status.producer.backends.find((b) => b.id === id)?.enabled ?? false;
  return (
    <div>
      <div className="card">
        <h2>{t('producer.backends')}</h2>
        <div className={styles.layout}>
          <ProducerBackendSidebar
            cards={cards} status={status} selectedId={selectedId} newIds={newIds}
            busyById={busyById} allBusy={allBusy} connected={connected}
            onAdd={addNew} onSelect={setSelectedId} onRemove={(id) => void removeCard(id)}
            onSetAllEnabled={(enabled) => void setAllEnabled(enabled)}
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
