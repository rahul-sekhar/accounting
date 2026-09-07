import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTransactions, filtersFromSearchParams, parseAmountBound, validateTransactionFilters } from '../lib/transaction-filters.ts';

const accounts = [
  { id: 'active', bank: 'One', name: 'Daily', type: 'Chequing', currency: 'CAD', archived: false },
  { id: 'archived', bank: 'Two', name: 'Old', type: 'Credit', currency: 'USD', archived: true },
];
const base = { source: 'none', confidence: null, category_revision: 0, reviewed_at: null, has_review: false, memory_enabled: null, categorization_evidence: null };
const rows = [
  { ...base, id: 'a', account_id: 'active', import_id: 'imp', date: '2026-01-01', description: 'Coffee (shop)', sub_description: 'Terminal #4', amount: -1234, category: 'Food' },
  { ...base, id: 'b', account_id: 'active', import_id: 'imp', date: '2026-01-31', description: 'Refund', sub_description: '', amount: 1234, category: 'Food' },
  { ...base, id: 'c', account_id: 'active', import_id: 'other', date: '2026-01-15', description: 'Adjustment', sub_description: 'punctuation .* literal', amount: 0, category: 'Uncategorized' },
  { ...base, id: 'd', account_id: 'archived', import_id: 'old', date: '2025-12-31', description: 'Old account', sub_description: '', amount: -500, category: 'Archived category' },
];
const defaults = { currency: 'CAD', q: '', direction: 'all', minAmount: '', maxAmount: '', category: 'all', account: 'all', from: '', to: '', importGroup: '' };

test('amount bounds parse exactly to integer cents', () => {
  assert.equal(parseAmountBound('12.34'), 1234);
  assert.equal(parseAmountBound('0.1'), 10);
  assert.equal(parseAmountBound('-1'), undefined);
  assert.equal(parseAmountBound('1.234'), undefined);
});

test('filters combine before pagination and include exact boundaries', () => {
  const result = filterTransactions(rows, accounts, { ...defaults, q: 'terminal #4', direction: 'debit', minAmount: '12.34', maxAmount: '12.34', from: '2026-01-01', to: '2026-01-01', importGroup: 'imp' });
  assert.deepEqual(result.filteredIds, ['a']);
  assert.equal(result.filterValid, true);
});

test('search treats punctuation literally and zero only appears in all direction', () => {
  assert.deepEqual(filterTransactions(rows, accounts, { ...defaults, q: '.*' }).filteredIds, ['c']);
  assert.deepEqual(filterTransactions(rows, accounts, { ...defaults, direction: 'debit' }).filteredIds, ['a']);
  assert.deepEqual(filterTransactions(rows, accounts, { ...defaults, direction: 'credit' }).filteredIds, ['b']);
});

test('date and amount errors invalidate rather than broaden results', () => {
  assert.ok(validateTransactionFilters({ ...defaults, from: '2026-02-30' }).date);
  const result = filterTransactions(rows, accounts, { ...defaults, minAmount: 'abc' });
  assert.equal(result.filterValid, false);
  assert.deepEqual(result.filteredIds, []);
});

test('import URL establishes archived account and currency while malformed IDs reset', () => {
  const imports = [{ id: 'old', account_id: 'archived', filename: 'same.csv', added: 1, skipped: 0, created_at: '2026-01-01T00:00:00Z' }];
  const parsed = filtersFromSearchParams(new URLSearchParams('currency=CAD&account=active&importGroup=old'), accounts, imports, ['Food']);
  assert.equal(parsed.filters.currency, 'USD');
  assert.equal(parsed.filters.account, 'archived');
  assert.equal(parsed.filters.importGroup, 'old');
  const invalid = filtersFromSearchParams(new URLSearchParams('account=missing&direction=sideways'), accounts, imports, ['Food']);
  assert.equal(invalid.filters.account, 'all');
  assert.match(invalid.notice, /unavailable account/i);
});
