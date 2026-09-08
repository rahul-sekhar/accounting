import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureMatchingTransactions,
  deleteBatches,
  intersectTransactionSelection,
  pageSelectionState,
  toggleTransaction,
  toggleTransactionPage,
} from '../lib/transaction-selection.ts';

test('selection persists across pages and supports page-only changes', () => {
  const all = Array.from({ length: 80 }, (_, index) => `t-${index + 1}`);
  let selection = new Set();
  selection = toggleTransactionPage(selection, all.slice(0, 25), true);
  selection = toggleTransactionPage(selection, all.slice(25, 50), true);
  assert.equal(selection.size, 50);
  assert.deepEqual(pageSelectionState(selection, all.slice(0, 25)), {
    selected: 25,
    checked: true,
    indeterminate: false,
  });
  selection = toggleTransaction(selection, 't-10', false);
  assert.equal(
    pageSelectionState(selection, all.slice(0, 25)).indeterminate,
    true,
  );
  assert.equal(selection.has('t-30'), true);
});

test('select-all captures a stable filtered set and can omit one off-page row', () => {
  const matching = Array.from({ length: 80 }, (_, index) => `t-${index + 1}`);
  let selection = captureMatchingTransactions(matching);
  const newlyMatching = [...matching, 't-new'];
  assert.equal(selection.has('t-new'), false);
  selection = toggleTransaction(selection, 't-63', false);
  assert.equal(selection.size, 79);
  assert.equal(newlyMatching.length, 81);
});

test('refresh intersects selection and reports removed IDs', () => {
  const result = intersectTransactionSelection(new Set(['a', 'b', 'c']), [
    'a',
    'c',
    'd',
  ]);
  assert.deepEqual([...result.selection], ['a', 'c']);
  assert.equal(result.removed, 1);
});

test('captured deletion is split into conservative sequential batches', () => {
  const ids = Array.from({ length: 121 }, (_, index) => String(index));
  assert.deepEqual(
    deleteBatches(ids).map((batch) => batch.length),
    [50, 50, 21],
  );
  assert.deepEqual(deleteBatches(ids).flat(), ids);
});
