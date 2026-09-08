'use client';
/* oxlint-disable react(react-compiler) */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { portions, monthFromIndex, monthIndex, type SpreadSchedule } from '@/lib/expense-spreading';
import { money, type Transaction } from '@/lib/banking';

export default function ExpenseSpreadDialog({ transaction, currency, open, onOpenChange, onSaved, api }: { transaction: Transaction | null; currency: string; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (message: string) => void; api: (path: string, method: string, payload: unknown) => Promise<unknown> }) {
  const [startMonth, setStartMonth] = useState(transaction?.spread_start_month || transaction?.date.slice(0, 7) || '');
  const [monthCount, setMonthCount] = useState(String(transaction?.spread_month_count || 12));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const amount = transaction?.amount || 0;
  // eslint-disable-next-line react(react-compiler)
  const preview = useMemo(() => { try { const count = Number(monthCount); const start = monthIndex(startMonth); return portions(amount, count).map((itemAmount, i) => ({ month: monthFromIndex(start + i), amount: itemAmount })); } catch { return []; } }, [monthCount, startMonth, amount]);
  if (!transaction) return null;
  const current = transaction;
  const remove = !transaction.spread_start_month;
  async function save(schedule: SpreadSchedule | null) {
    setBusy(true); setError('');
    try {
      await api(`transactions/${current.id}/spread`, 'PUT', { id: current.id, operationId: crypto.randomUUID(), expectedRevision: current.spread_revision, schedule });
      onOpenChange(false); onSaved(schedule ? `${money(Math.abs(current.amount), currency)} spread across ${preview[0]?.month}–${preview.at(-1)?.month}.` : 'Spread removed. The full expense returns to its payment month.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="spread-dialog"><DialogHeader><DialogTitle>Spread across months</DialogTitle><DialogDescription>Choose the months this cost belongs to. Your original payment stays the same.</DialogDescription></DialogHeader><div className="spread-summary"><strong>{transaction.description}</strong><span>{transaction.date} · {money(transaction.amount, currency)} · {transaction.category}</span></div><div className="spread-fields"><label className="field"><span>Start month</span><input type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} disabled={busy} /></label><label className="field"><span>Number of months</span><select value={monthCount} onChange={e => setMonthCount(e.target.value)} disabled={busy}>{[2,3,6,12,24,36].map(n => <option key={n}>{n}</option>)}<option value="custom">Custom</option></select>{monthCount === 'custom' && <input type="number" min="2" max="120" value="12" onChange={e => setMonthCount(e.target.value)} />}</label></div>{preview.length > 0 && <div className="spread-preview"><div><strong>End month</strong><span>{preview.at(-1)?.month} · about {money(Math.abs(Math.round(transaction.amount / Number(monthCount))), currency)} per month</span></div><details><summary>Preview exact monthly amounts</summary><div className="spread-preview-list">{preview.map(item => <span key={item.month}>{item.month}<b>{money(item.amount, currency)}</b></span>)}</div></details></div>}{error && <div className="message error" role="alert">{error}</div>}<DialogFooter><button className="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</button>{!remove && <button className="secondary" onClick={() => void save(null)} disabled={busy}>Remove spread</button>}<button className="primary" onClick={() => void save({ startMonth, monthCount: Number(monthCount) })} disabled={busy || !preview.length || monthCount === 'custom'}>{busy ? 'Saving…' : remove ? 'Save spread' : 'Save changes'}</button></DialogFooter></DialogContent></Dialog>;
}
