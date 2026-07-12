'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  cancelWithdrawal,
  createWithdrawal,
  loadWithdrawals,
  type UserDto,
  type WithdrawalDto,
} from '@/lib/client/auth';
import styles from './WithdrawalModal.module.css';

const MIN_CREDITS = 20_000_000;
const STATUS: Record<WithdrawalDto['status'], string> = {
  pending_review: '待审核', approved: '审核通过，待打款', succeeded: '提现成功',
  cancelled_refunded: '已取消并退回', rejected_refunded: '已驳回并退回',
};

export function WithdrawalModal({ user, onClose, onChanged }: { user: UserDto; onClose: () => void; onChanged: () => Promise<void> }) {
  const [amount, setAmount] = useState(String(MIN_CREDITS));
  const [account, setAccount] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<WithdrawalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  async function refresh(): Promise<void> {
    setLoading(true);
    try { setRows((await loadWithdrawals()).data); }
    catch (err) { setError((err as Error).message || '加载提现记录失败'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let alive = true;
    void loadWithdrawals()
      .then((page) => { if (alive) setRows(page.data); })
      .catch((err: unknown) => { if (alive) setError((err as Error).message || '加载提现记录失败'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!window.confirm('请再次确认支付宝账号和收款人姓名。提交后不可修改，确认申请提现吗？')) return;
    setSubmitting(true); setError('');
    try {
      await createWithdrawal({ amountCredits: amount.trim(), payoutAccount: account, payoutRecipientName: name });
      setAccount(''); setName('');
      await Promise.all([refresh(), onChanged()]);
    } catch (err) { setError((err as Error).message || '提现申请失败'); }
    finally { setSubmitting(false); }
  }

  async function cancel(row: WithdrawalDto): Promise<void> {
    if (!window.confirm(`确认取消提现申请 ${row.requestNo}？锁定积分将退回生产积分。`)) return;
    setBusyId(row.id); setError('');
    try { await cancelWithdrawal(row.id); await Promise.all([refresh(), onChanged()]); }
    catch (err) { setError((err as Error).message || '取消失败'); }
    finally { setBusyId(''); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${styles.modal}`} onClick={(event) => event.stopPropagation()}>
        <h3>支付宝提现</h3>
        <p className="muted">仅生产积分可提现。最低 {MIN_CREDITS.toLocaleString()} 积分，100,000 积分 = 1 元。</p>
        <div className={styles.balance}>可提现生产积分：<strong>{Number(user.withdrawableProducerBalance).toLocaleString()}</strong></div>
        <form className={styles.form} onSubmit={submit}>
          <label>提现积分<input inputMode="numeric" pattern="[0-9]+" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>支付宝账号<input maxLength={128} required value={account} onChange={(event) => setAccount(event.target.value)} placeholder="手机号或邮箱" /></label>
          <label>收款人真实姓名<input maxLength={64} required value={name} onChange={(event) => setName(event.target.value)} /></label>
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
