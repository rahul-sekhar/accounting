import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginDeleteProgress,
  captureMatchingTransactions,
  commitDeleteBatch,
  deleteBatches,
  haltDeleteProgress,
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

test('a later batch failure preserves committed progress and retry scope', () => {
  const ids = Array.from({ length: 80 }, (_, index) => `t-${index + 1}`);
  const [first, second] = deleteBatches(ids);
  let progress = beginDeleteProgress(ids);
  progress = commitDeleteBatch(progress, first, {
    deletedIds: first.slice(0, 49),
    unavailableIds: first.slice(49),
  });
  assert.equal(progress.processed, 50);
  assert.equal(progress.deleted, 49);
  assert.equal(progress.unavailable, 1);
  assert.deepEqual(progress.remaining, second);
  progress = haltDeleteProgress(progress, 'failed', 'Network response lost.');
  assert.equal(progress.status, 'failed');
  assert.deepEqual(progress.remaining, second);

  let retry = beginDeleteProgress(progress.remaining);
  retry = commitDeleteBatch(retry, second, {
    deletedIds: second,
    unavailableIds: [],
  });
  assert.equal(retry.status, 'completed');
  assert.equal(retry.processed, 30);
  assert.deepEqual(retry.remaining, []);
});
