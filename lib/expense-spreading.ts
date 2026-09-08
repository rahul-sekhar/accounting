import type { CategoryDefinition, Transaction } from './banking';

export type Month = `${number}-${string}`;
export type SpreadSchedule = { startMonth: string; monthCount: number };
export type ExpenseContribution = {
  transactionId: string;
  month: string;
  amount: number;
  originalAmount: number;
  paymentDate: string;
  ordinal: number;
  monthCount: number;
};

const MONTH_RE = /^(\d{4})-(\d{2})$/;
export function monthIndex(month: string): number {
  const match = MONTH_RE.exec(month);
  if (!match) throw new Error('Use a month in YYYY-MM format.');
  const year = Number(match[1]);
  const m = Number(match[2]);
  if (year < 1900 || year > 9999 || m < 1 || m > 12)
    throw new Error('Choose a month between January 1900 and December 9999.');
  return year * 12 + m - 1;
}
export function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  if (year < 1900 || year > 9999) throw new Error('Month is out of range.');
  return `${year}-${String(month).padStart(2, '0')}`;
}
export function validateSchedule(schedule: SpreadSchedule | null): SpreadSchedule | null {
  if (schedule === null) return null;
  const startMonth = schedule.startMonth;
  const monthCount = schedule.monthCount;
  if (!Number.isSafeInteger(monthCount) || monthCount < 2 || monthCount > 120)
    throw new Error('Choose between 2 and 120 months.');
  const start = monthIndex(startMonth);
  monthFromIndex(start + monthCount - 1);
  return { startMonth, monthCount };
}
export function isExpenseEligible(
  transaction: Pick<Transaction, 'amount' | 'category'>,
  categories: CategoryDefinition[],
) {
  const kind = categories.find((c) => c.id === transaction.category)?.kind ?? 'unclassified';
  return transaction.amount !== 0 && (kind === 'expense' || (kind === 'unclassified' && transaction.amount < 0));
}
export function portions(amount: number, count: number): number[] {
  const sign = amount < 0 ? -1 : 1;
  const absolute = Math.abs(amount);
  const base = Math.floor(absolute / count);
  const remainder = absolute % count;
  return Array.from({ length: count }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}
export function scheduleContributions(
  transaction: Pick<Transaction, 'id' | 'amount' | 'date' | 'spread_start_month' | 'spread_month_count'>,
  range?: { from: string; to: string },
): ExpenseContribution[] {
  const startMonth = transaction.spread_start_month;
  const count = transaction.spread_month_count;
  const paymentMonth = transaction.date.slice(0, 7);
  if (!startMonth || !count) {
    if (!range || (monthIndex(paymentMonth) >= monthIndex(range.from) && monthIndex(paymentMonth) <= monthIndex(range.to)))
      return [{ transactionId: transaction.id, month: paymentMonth, amount: transaction.amount, originalAmount: transaction.amount, paymentDate: transaction.date, ordinal: 0, monthCount: 1 }];
    return [];
  }
  const values = portions(transaction.amount, count);
  const from = range ? monthIndex(range.from) : -Infinity;
  const to = range ? monthIndex(range.to) : Infinity;
  const start = monthIndex(startMonth);
  return values.flatMap((amount, ordinal) => {
    const index = start + ordinal;
    return index >= from && index <= to ? [{ transactionId: transaction.id, month: monthFromIndex(index), amount, originalAmount: transaction.amount, paymentDate: transaction.date, ordinal, monthCount: count }] : [];
  });
}
export function aggregateMonthlyExpenses(
  transactions: Transaction[], categories: CategoryDefinition[], range: { from: string; to: string }, basis: 'spread' | 'paid', currency: string, accountId = 'all', categoryId = 'all',
) {
  const totals = new Map<string, number>();
  const contributions: ExpenseContribution[] = [];
  const from = monthIndex(range.from), to = monthIndex(range.to);
  for (const transaction of transactions) {
    const account = (transaction as Transaction & { currency?: string }).currency;
    if (account && account !== currency) continue;
    if (accountId !== 'all' && transaction.account_id !== accountId) continue;
    if (categoryId !== 'all' && transaction.category !== categoryId) continue;
    if (!isExpenseEligible(transaction, categories)) continue;
    const scheduled = Boolean(transaction.spread_start_month && transaction.spread_month_count);
    const items = basis === 'spread' && scheduled
      ? scheduleContributions(transaction, { from: range.from, to: range.to })
      : scheduleContributions({ ...transaction, spread_start_month: null, spread_month_count: null }, { from: range.from, to: range.to });
    for (const item of items) {
      totals.set(item.month, (totals.get(item.month) || 0) + item.amount);
      contributions.push(item);
    }
  }
  return { totals, contributions, from, to };
}
