'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createInviteCode,
  deleteInviteCode,
  loadInviteCodes,
  loadReferralPayouts,
  loadReferrals,
  type InviteCodeDto,
  type ReferralDto,
  type ReferralPayoutDto,
} from '@/lib/client/auth';
import { useI18n } from '@/lib/i18n/context';
import styles from './ReferralModal.module.css';

function formatCredits(value: string): string {
  try {
    return BigInt(value).toLocaleString();
  } catch {
    return value;
  }
}

function shortDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export function ReferralModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [codes, setCodes] = useState<InviteCodeDto[]>([]);
  const [referrals, setReferrals] = useState<ReferralDto[]>([]);
  const [payouts, setPayouts] = useState<ReferralPayoutDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const activeCode = useMemo(
    () => codes[0],
    [codes],
  );
  const activeValue = activeCode?.code ?? '';

  useEffect(() => {
    let alive = true;
    void Promise.all([loadInviteCodes(), loadReferrals(), loadReferralPayouts(30, 0)])
      .then(([nextCodes, nextReferrals, nextPayouts]) => {
        if (!alive) return;
        setCodes(nextCodes);
        setReferrals(nextReferrals);
        setPayouts(nextPayouts.payouts);
      })
      .catch((err) => {
        if (alive) setError((err as Error).message || t('referral.loadFailed'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [t]);

  async function onCreate(): Promise<void> {
    setCreating(true);
    setError('');
    try {
      const created = await createInviteCode();
      setCodes((cur) => [created, ...cur]);
    } catch (err) {
      setError((err as Error).message || t('referral.createFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(code: string): Promise<void> {
    setError('');
    try {
      await deleteInviteCode(code);
      setCodes((cur) => cur.filter((item) => item.code !== code));
    } catch (err) {
      setError((err as Error).message || t('referral.deleteFailed'));
    }
  }

  async function copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied(''), 1400);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <div>
            <h3>{t('referral.title')}</h3>
            <p className="muted">{t('referral.description')}</p>
          </div>
          <button type="button" onClick={() => void onCreate()} disabled={creating}>
            {creating ? t('referral.creating') : t('referral.create')}
          </button>
        </div>

        {loading ? <p className="muted">{t('referral.loading')}</p> : null}
        {error ? <p className="err">{error}</p> : null}

        <section className={styles.shareCard}>
          <div>
            <div className="muted small">{t('referral.activeCode')}</div>
            {activeValue ? <code>{activeValue}</code> : <strong>{t('referral.noActiveCode')}</strong>}
          </div>
          <button type="button" className="secondary" onClick={() => activeValue && void copy(activeValue)} disabled={!activeValue}>
            {copied === activeValue ? t('consumer.copied') : t('consumer.copy')}
          </button>
        </section>

        <section className={styles.section}>
          <h4>{t('referral.codes')}</h4>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('referral.code')}</th>
                  <th>{t('referral.uses')}</th>
                  <th>{t('referral.expires')}</th>
                  <th>{t('referral.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {codes.length === 0 ? (
                  <tr><td colSpan={4}>{t('referral.emptyCodes')}</td></tr>
                ) : codes.map((code) => (
                    <tr key={code.id}>
                      <td><code>{code.code}</code></td>
                      <td>{code.usedCount}</td>
                      <td>{shortDate(code.expiresAt)}</td>
                      <td className={styles.actions}>
                        <button type="button" className="secondary" onClick={() => void copy(code.code)}>
                          {copied === code.code ? t('consumer.copied') : t('consumer.copy')}
                        </button>
                        <button type="button" className="secondary" onClick={() => void onDelete(code.code)}>
                          {t('referral.delete')}
                        </button>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.section}>
          <h4>{t('referral.invitees')}</h4>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('referral.user')}</th>
                  <th>{t('referral.totalPaid')}</th>
                  <th>{t('referral.windowEnd')}</th>
                  <th>{t('referral.status')}</th>
                </tr>
              </thead>
              <tbody>
                {referrals.length === 0 ? (
                  <tr><td colSpan={4}>{t('referral.emptyInvitees')}</td></tr>
                ) : referrals.map((referral) => (
                  <tr key={referral.id}>
                    <td>{referral.inviteeDisplayName || t('auth.userFallback', { id: referral.inviteeId })}</td>
                    <td>{formatCredits(referral.totalPaid)}</td>
                    <td>{shortDate(referral.windowEnd)}</td>
                    <td>{referral.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.section}>
          <h4>{t('referral.payouts')}</h4>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('referral.kind')}</th>
                  <th>{t('referral.amount')}</th>
                  <th>{t('referral.state')}</th>
                  <th>{t('referral.created')}</th>
                </tr>
              </thead>
              <tbody>
                {payouts.length === 0 ? (
                  <tr><td colSpan={4}>{t('referral.emptyPayouts')}</td></tr>
                ) : payouts.map((payout) => (
                  <tr key={payout.id}>
                    <td>{t(payout.kind === 'producer_cut' ? 'referral.kindProducer' : 'referral.kindRecharge')}</td>
                    <td>{formatCredits(payout.amount)}</td>
                    <td>{payout.state}</td>
                    <td>{shortDate(payout.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>{t('settings.close')}</button>
        </div>
      </div>
    </div>
  );
}
