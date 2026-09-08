import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMonthlyExpenses, monthFromIndex, monthIndex, portions, scheduleContributions, validateSchedule } from '../lib/expense-spreading.ts';

const expense = { id: 'a', account_id: 'cad', date: '2026-03-15', description: 'Laptop', sub_description: '', amount: -240000, category: 'Shopping', source: 'none', confidence: null, category_revision: 0, reviewed_at: null, has_review: false, memory_enabled: null, categorization_evidence: null, spread_start_month: null, spread_month_count: null, spread_revision: 0 };
const categories = [{ id: 'Shopping', name: 'Shopping', kind: 'expense', archived: false }, { id: 'Uncategorized', name: 'Uncategorized', kind: 'unclassified', archived: false }, { id: 'Income', name: 'Income', kind: 'income', archived: false }];

test('calendar arithmetic and schedule validation', () => {
  assert.equal(monthFromIndex(monthIndex('2026-01') + 11), '2026-12');
  assert.deepEqual(validateSchedule({ startMonth: '2026-03', monthCount: 24 }), { startMonth: '2026-03', monthCount: 24 });
  assert.throws(() => validateSchedule({ startMonth: '2026-13', monthCount: 2 }));
  assert.throws(() => validateSchedule({ startMonth: '2026-01', monthCount: 121 }));
});

test('exact cents preserve sign and total', () => {
  assert.deepEqual(portions(-100, 3), [-34, -33, -33]);
  assert.deepEqual(portions(1, 3), [1, 0, 0]);
  assert.equal(portions(-240000, 24).reduce((a, b) => a + b, 0), -240000);
});

test('spread starts before payment date and paid mode remains in payment month', () => {
  const scheduled = { ...expense, spread_start_month: '2026-01', spread_month_count: 2 };
  assert.deepEqual(scheduleContributions(scheduled, { from: '2026-01', to: '2026-01' }).map(x => x.amount), [-120000]);
  const spread = aggregateMonthlyExpenses([scheduled], categories, { from: '2026-01', to: '2026-03' }, 'spread', 'CAD');
  const paid = aggregateMonthlyExpenses([scheduled], categories, { from: '2026-01', to: '2026-03' }, 'paid', 'CAD');
  assert.equal(spread.totals.get('2026-01'), -120000);
  assert.equal(spread.totals.get('2026-02'), -120000);
  assert.equal(spread.totals.get('2026-03') || 0, 0);
  assert.equal(paid.totals.get('2026-03'), -240000);
});

test('refunds and inactive schedules follow category eligibility', () => {
  const refund = { ...expense, id: 'refund', amount: 10000, category: 'Shopping', spread_start_month: '2026-01', spread_month_count: 2 };
  const inactive = { ...expense, id: 'inactive', category: 'Income', spread_start_month: '2026-01', spread_month_count: 2 };
  const report = aggregateMonthlyExpenses([refund, inactive], categories, { from: '2026-01', to: '2026-02' }, 'spread', 'CAD');
  assert.equal(report.totals.get('2026-01'), 5000);
  assert.equal(report.totals.get('2026-02'), 5000);
});

test('currency and account scopes and lifetime reconciliation', () => {
  const rows = [
    { ...expense, currency: 'CAD', account_id: 'cad', spread_start_month: '2026-01', spread_month_count: 3 },
    { ...expense, id: 'usd', currency: 'USD', account_id: 'usd', spread_start_month: null, spread_month_count: null },
  ];
  const report = aggregateMonthlyExpenses(rows, categories, { from: '2026-01', to: '2026-03' }, 'spread', 'CAD', 'cad');
  assert.equal([...report.totals.values()].reduce((a, b) => a + b, 0), -240000);
  assert.equal(aggregateMonthlyExpenses(rows, categories, { from: '2026-01', to: '2026-03' }, 'spread', 'USD', 'usd').totals.get('2026-03'), -240000);
});
