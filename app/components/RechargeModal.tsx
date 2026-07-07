'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  createRechargeOrder,
  loadMe,
  syncRechargeOrder,
  type RechargeOrder,
  type UserDto,
} from '@/lib/client/auth';
import { useI18n } from '@/lib/i18n/context';
import styles from './RechargeModal.module.css';

const AMOUNTS = [1, 5, 10, 20, 50, 100] as const;
const CREDITS_PER_YUAN = 100_000;
const STATUS_LABELS = {
  pending: 'recharge.status.pending',
  paid: 'recharge.status.paid',
  closed: 'recharge.status.closed',
  failed: 'recharge.status.failed',
} as const;

export function RechargeModal({
  onClose,
  onPaid,
}: {
  onClose: () => void;
  onPaid: (user: UserDto) => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState<number>(1);
  const [order, setOrder] = useState<RechargeOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [qrSrc, setQrSrc] = useState('');

  useEffect(() => {
    let alive = true;
    setQrSrc('');
    if (!order?.codeUrl) return;
    void QRCode.toDataURL(order.codeUrl, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (alive) setQrSrc(url);
      })
      .catch(() => {
        if (alive) setError(t('recharge.qrFailed'));
      });
    return () => {
      alive = false;
    };
  }, [order?.codeUrl, t]);

  useEffect(() => {
    if (!order || order.status !== 'pending') return;
    const outTradeNo = order.outTradeNo;
    let alive = true;
    const timer = window.setInterval(() => {
      void syncRechargeOrder(outTradeNo)
        .then(async (next) => {
          if (!alive) return;
          setOrder(next);
          if (next.status === 'paid') {
            const me = await loadMe();
            if (me && alive) onPaid(me);
          }
        })
        .catch(() => {
          // Keep polling local state; explicit sync below can surface errors.
        });
    }, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [order?.outTradeNo, order?.status, onPaid]);

  async function startRecharge(nextAmount = amount): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const next = await createRechargeOrder(nextAmount);
      setOrder(next);
    } catch (err) {
      setError((err as Error).message || t('recharge.createFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function checkNow(): Promise<void> {
    if (!order) return;
    setChecking(true);
    setError('');
    try {
      const next = await syncRechargeOrder(order.outTradeNo);
      setOrder(next);
      if (next.status === 'paid') {
        const me = await loadMe();
        if (me) onPaid(me);
      }
    } catch (err) {
      setError((err as Error).message || t('recharge.checkFailed'));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <h3>{t('recharge.title')}</h3>
        <p className="muted">{t('recharge.rate')}</p>

        <div className={styles.options}>
          {AMOUNTS.map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.option} ${amount === value ? styles.active : ''}`}
              onClick={() => {
                setAmount(value);
                setOrder(null);
                setError('');
              }}
            >
              <strong>¥{value}</strong>
              <span>{(value * CREDITS_PER_YUAN).toLocaleString()} {t('recharge.creditsUnit')}</span>
            </button>
          ))}
        </div>

        {!order ? (
          <div className="actions">
            <button type="button" onClick={() => void startRecharge()} disabled={loading}>
              {loading ? t('recharge.creating') : t('recharge.create')}
            </button>
          </div>
        ) : (
          <div className={styles.order}>
            <div className={styles.qrCard}>
              {qrSrc ? <img src={qrSrc} alt={t('recharge.qrAlt')} /> : <div className={styles.qrPlaceholder}>QR</div>}
            </div>
            <div className={styles.detail}>
              <div className={`badge ${order.status === 'paid' ? 'green' : ''}`}>
                {t(STATUS_LABELS[order.status])}
              </div>
              <p>
                {t('recharge.orderNo')}: <code>{order.outTradeNo}</code>
              </p>
              <p>{t('recharge.scanHint')}</p>
              <p className="hint">
                {t('recharge.expiresAt')}: {new Date(order.expiresAt).toLocaleString()}
              </p>
              <div className="actions">
                <button type="button" onClick={() => void checkNow()} disabled={checking || order.status === 'paid'}>
                  {checking ? t('recharge.checking') : t('recharge.checkNow')}
                </button>
                <button type="button" className="secondary" onClick={() => void startRecharge()} disabled={loading}>
                  {t('recharge.newOrder')}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && <p className="err">{error}</p>}

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
