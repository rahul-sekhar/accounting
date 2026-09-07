import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CATEGORIZE_IDS,
  beginCategorizeProgress,
  categorizeBatches,
  categorizeRequestHash,
  commitCategorizeBatch,
  haltCategorizeProgress,
  isCategorizationEligible,
  parseCategorizeRequest,
} from '../lib/transaction-categorization.ts';

const operationId = 'ca1a0868-7884-4c7b-b1d3-ff4bb02fe7dd';

test('categorization input is bounded, explicit, unique, and canonical', () => {
  assert.deepEqual(parseCategorizeRequest({ operationId, ids: ['b', 'a'] }), {
    operationId,
    ids: ['a', 'b'],
  });
  assert.throws(
    () => parseCategorizeRequest({ operationId, ids: [] }),
    /between 1 and 60/,
  );
  assert.throws(
    () => parseCategorizeRequest({ operationId, ids: ['a', 'a'] }),
    /unique/,
  );
  assert.throws(
    () =>
      parseCategorizeRequest({
        operationId,
        ids: Array.from({ length: MAX_CATEGORIZE_IDS + 1 }, (_, i) =>
          String(i),
        ),
      }),
    /between 1 and 60/,
  );
  assert.throws(
    () => parseCategorizeRequest({ operationId: 'retry', ids: ['a'] }),
    /valid categorization operation/,
  );
});

test('categorization hashes ignore order but preserve membership', async () => {
  assert.equal(
    await categorizeRequestHash(['b', 'a']),
    await categorizeRequestHash(['a', 'b']),
  );
  assert.notEqual(
    await categorizeRequestHash(['a', 'b']),
    await categorizeRequestHash(['a']),
  );
});

test('eligibility includes new and unreviewed AI rows only', () => {
  assert.equal(
    isCategorizationEligible({ source: 'none', has_review: false }),
    true,
  );
  assert.equal(
    isCategorizationEligible({ source: 'ai', has_review: false }),
    true,
  );
  assert.equal(
    isCategorizationEligible({ source: 'ai', has_review: true }),
    false,
  );
  assert.equal(
    isCategorizationEligible({ source: 'manual', has_review: false }),
    false,
  );
});

test('progress handles batches, protection, stop, and failures without retargeting', () => {
  const ids = Array.from({ length: 61 }, (_, i) => `t-${i}`);
  const batches = categorizeBatches(ids);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [60, 1],
  );
  let progress = beginCategorizeProgress(ids);
  progress = commitCategorizeBatch(progress, batches[0], {
    categorizedIds: batches[0].slice(0, 58),
    protectedIds: [batches[0][58]],
    unavailableIds: [batches[0][59]],
  });
  assert.deepEqual(
    {
      processed: progress.processed,
      categorized: progress.categorized,
      protected: progress.protected,
      unavailable: progress.unavailable,
      remaining: progress.remaining,
    },
    {
      processed: 60,
      categorized: 58,
      protected: 1,
      unavailable: 1,
      remaining: ['t-60'],
    },
  );
  assert.equal(haltCategorizeProgress(progress, 'stopped').status, 'stopped');
  assert.equal(
    haltCategorizeProgress(progress, 'failed', 'bad output').error,
    'bad output',
  );
  assert.throws(
    () =>
      commitCategorizeBatch(progress, batches[1], {
        categorizedIds: [],
        protectedIds: [],
        unavailableIds: [],
      }),
    /incomplete/,
  );
});
