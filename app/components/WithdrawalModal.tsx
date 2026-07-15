'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  cancelWithdrawal,
  createWithdrawal,
  loadWithdrawals,
  type UserDto,
  type WithdrawalDto,
} from '@/lib/client/auth';
import {
  estimateWithdrawalAmount,
  MIN_WITHDRAWAL_CREDITS,
  validateWithdrawalInput,
  type WithdrawalValidationError,
} from '@/lib/client/withdrawal-amount';
import { useI18n } from '@/lib/i18n/context';
import type { MessageKey } from '@/lib/i18n/dictionary';
import styles from './WithdrawalModal.module.css';

const MIN_CREDITS = Number(MIN_WITHDRAWAL_CREDITS);
const STATUS: Record<WithdrawalDto['status'], string> = {
  pending_review: '待审核', approved: '审核通过，待打款', succeeded: '提现成功',
  cancelled_refunded: '已取消并退回', rejected_refunded: '已驳回并退回',
};
const VALIDATION_KEYS: Record<WithdrawalValidationError, MessageKey> = {
  amountRequired: 'withdrawal.validation.amountRequired',
  amountPositiveInteger: 'withdrawal.validation.amountPositiveInteger',
  amountMinimum: 'withdrawal.validation.amountMinimum',
  amountIncrement: 'withdrawal.validation.amountIncrement',
  amountExceedsBalance: 'withdrawal.validation.amountExceedsBalance',
  accountRequired: 'withdrawal.validation.accountRequired',
  accountTooLong: 'withdrawal.validation.accountTooLong',
  accountInvalid: 'withdrawal.validation.accountInvalid',
  recipientRequired: 'withdrawal.validation.recipientRequired',
  recipientTooLong: 'withdrawal.validation.recipientTooLong',
  recipientInvalid: 'withdrawal.validation.recipientInvalid',
};

export function WithdrawalModal({ user, onClose, onChanged }: { user: UserDto; onClose: () => void; onChanged: () => Promise<void> }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(String(MIN_CREDITS));
  const [account, setAccount] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<WithdrawalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const estimate = estimateWithdrawalAmount(amount);

  async function refresh(): Promise<void> {
    setLoading(true);
    try { setRows((await loadWithdrawals()).data); }
    catch { setError(t('withdrawal.loadFailed')); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let alive = true;
    void loadWithdrawals()
      .then((page) => { if (alive) setRows(page.data); })
      .catch(() => { if (alive) setError(t('withdrawal.loadFailed')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const validationError = validateWithdrawalInput({
      amountCredits: amount,
      availableCredits: user.withdrawableProducerBalance,
      payoutAccount: account,
      payoutRecipientName: name,
    });
    if (validationError) {
      setError(t(VALIDATION_KEYS[validationError], { min: MIN_CREDITS.toLocaleString() }));
      return;
    }
    if (!window.confirm(t('withdrawal.confirmSubmit'))) return;
    setSubmitting(true); setError('');
    try {
      await createWithdrawal({ amountCredits: amount.trim(), payoutAccount: account.trim(), payoutRecipientName: name.trim() });
      setAccount(''); setName('');
      await Promise.all([refresh(), onChanged()]);
    } catch { setError(t('withdrawal.submitFailed')); }
    finally { setSubmitting(false); }
  }

  async function cancel(row: WithdrawalDto): Promise<void> {
    if (!window.confirm(t('withdrawal.confirmCancel', { requestNo: row.requestNo }))) return;
    setBusyId(row.id); setError('');
    try { await cancelWithdrawal(row.id); await Promise.all([refresh(), onChanged()]); }
    catch { setError(t('withdrawal.cancelFailed')); }
    finally { setBusyId(''); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${styles.modal}`} onClick={(event) => event.stopPropagation()}>
        <h3>支付宝提现</h3>
        <p className="muted">仅生产积分可提现。最低 {MIN_CREDITS.toLocaleString()} 积分，100,000 积分 = 1 元。</p>
        <div className={styles.balance}>可提现生产积分：<strong>{Number(user.withdrawableProducerBalance).toLocaleString()}</strong></div>
        <form className={styles.form} onSubmit={submit} noValidate>
          <label>提现积分<input inputMode="numeric" pattern="[0-9]+" required value={amount} onChange={(event) => { setAmount(event.target.value); setError(''); }} aria-describedby="withdrawal-estimate" /></label>
          <div id="withdrawal-estimate" className={styles.estimate} aria-live="polite">
            <div><span>{t('withdrawal.estimatedReceipt')}</span><strong>{estimate.amountYuan ? `¥${estimate.amountYuan}` : '—'}</strong></div>
            <small className={estimate.validationError ? styles.estimateError : undefined}>
              {estimate.validationError ? t(VALIDATION_KEYS[estimate.validationError]) : t('withdrawal.estimateHint')}
            </small>
          </div>
          <label>支付宝账号<input maxLength={128} required value={account} onChange={(event) => { setAccount(event.target.value); setError(''); }} placeholder="手机号或邮箱" /></label>
          <label>收款人真实姓名<input maxLength={64} required value={name} onChange={(event) => { setName(event.target.value); setError(''); }} /></label>
          <p className="hint">请确保姓名与支付宝实名认证一致。收款信息提交后不可修改，填写错误可能导致打款失败。</p>
          <button type="submit" disabled={submitting}>{submitting ? '提交中…' : '申请提现'}</button>
        </form>
        {error && <p className="err">{error}</p>}
        <h4>提现记录</h4>
        {loading ? <p className="muted">加载中…</p> : rows.length === 0 ? <p className="muted">暂无提现记录。</p> : (
          <div className={styles.history}>
            {rows.map((row) => (
              <article key={row.id} className={styles.record}>
                <div><strong>¥{row.amountYuan}</strong><span className="badge">{STATUS[row.status]}</span></div>
                <small>{row.requestNo} · {new Date(row.createdAt).toLocaleString()}</small>
                <p>支付宝：{row.payoutAccountMasked}（{row.payoutRecipientNameMasked}）</p>
                {row.reviewNote && <p>原因：{row.reviewNote}</p>}
                {row.transactionNo && <p>交易流水号：<code>{row.transactionNo}</code></p>}
                {row.transferredAt && <p>打款时间：{new Date(row.transferredAt).toLocaleString()}</p>}
                {row.status === 'pending_review' && <button type="button" className="secondary" disabled={busyId === row.id} onClick={() => void cancel(row)}>{busyId === row.id ? '取消中…' : '取消申请'}</button>}
              </article>
            ))}
          </div>
        )}
        <div className="modal-actions"><button className="secondary" onClick={onClose}>关闭</button></div>
      </div>
    </div>
  );
}
