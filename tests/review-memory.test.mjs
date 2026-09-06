import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MEMORY_BYTES,
  buildReviewMemory,
  normalizeReviewText,
  selectReviewMemory,
} from '../lib/review-memory.ts';

const categories = [
  { id: 'Uncategorized', name: 'Uncategorized', kind: 'unclassified', archived: false },
  { id: 'grocery', name: 'Groceries', kind: 'expense', archived: false },
  { id: 'business', name: 'Business expenses', kind: 'expense', archived: false },
  { id: 'shopping', name: 'Shopping', kind: 'expense', archived: false },
  { id: 'old', name: 'Old category', kind: 'expense', archived: true },
];
const row = (transactionId, overrides = {}) => ({
  transactionId,
  categoryId: 'grocery',
  memoryEnabled: true,
  reviewedAt: `2026-01-${String(Number(transactionId.replace(/\D/g, '') || 1)).padStart(2, '0')}T00:00:00.000Z`,
  description: 'Whole Foods 1234',
  subDescription: 'Weekly groceries',
  amount: -5500,
  currency: 'CAD',
  accountId: 'account-secret-a',
  accountType: 'Credit card',
  ...overrides,
});

test('ten equivalent distinct reviews condense into one counted entry', () => {
  const memory = buildReviewMemory(Array.from({ length: 10 }, (_, index) => row(`t${index + 1}`)), categories);
  assert.equal(memory.length, 1);
  assert.equal(memory[0].alternatives[0].reviewedTransactionCount, 10);
  assert.equal(memory[0].alternatives[0].transactionIds.length, 10);
});

test('repeated revisions of one transaction contribute only the latest category', () => {
  const memory = buildReviewMemory(
    Array.from({ length: 10 }, (_, index) =>
      row('same-transaction', {
        revision: index + 1,
        categoryId: index === 9 ? 'business' : 'grocery',
        reviewedAt: `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    ),
    categories,
  );
  assert.equal(memory.length, 1);
  assert.equal(memory[0].alternatives.length, 1);
  assert.equal(memory[0].alternatives[0].categoryId, 'business');
  assert.equal(memory[0].alternatives[0].reviewedTransactionCount, 1);
});

test('10,000 current reviews aggregate without a latest-N cutoff', () => {
  const reviews = Array.from({ length: 10_000 }, (_, index) =>
    row(`large-${index}`, { description: `Merchant ${index % 100}` }),
  );
  const memory = buildReviewMemory(reviews, categories);
  assert.equal(memory.length, 100);
  assert.equal(
    memory.reduce((count, cluster) => count + cluster.alternatives[0].reviewedTransactionCount, 0),
    10_000,
  );
});

test('normalization is deterministic and preserves digits and merchant words', () => {
  assert.equal(normalizeReviewText('  WHOLE\u00a0 Foods １２３4  '), 'whole foods 1234');
  assert.notEqual(normalizeReviewText('Amazon 123'), normalizeReviewText('Amazon 124'));
});

test('sub-description, account, currency, and direction remain separate', () => {
  const memory = buildReviewMemory(
    [
      row('1'),
      row('2', { subDescription: 'Pet supplies' }),
      row('3', { accountId: 'account-secret-b' }),
      row('4', { currency: 'USD' }),
      row('5', { amount: 5500 }),
    ],
    categories,
  );
  assert.equal(memory.length, 5);
});

test('disabled, Uncategorized, and archived reviews stay out of active memory', () => {
  const memory = buildReviewMemory(
    [
      row('1', { memoryEnabled: false }),
      row('2', { categoryId: 'Uncategorized' }),
      row('3', { categoryId: 'old' }),
    ],
    categories,
  );
  assert.deepEqual(memory, []);
});

test('conflicting alternatives remain together under budget selection', () => {
  const clusters = buildReviewMemory(
    [row('1'), row('2', { categoryId: 'business' })],
    categories,
  );
  assert.equal(clusters[0].conflicting, true);
  const selected = selectReviewMemory(clusters, [row('target')], MAX_MEMORY_BYTES);
  assert.equal(selected.reference.clusters[0].alternatives.length, 2);
  assert.equal(selected.allowedMemoryIds.size, 2);
  assert.equal(selected.serialized.includes('account-secret-a'), false);
});

test('byte budget holds for long non-ASCII examples and selection is deterministic', () => {
  const rows = Array.from({ length: 100 }, (_, index) =>
    row(String(index + 1), {
      description: `商店 ${index} ${'é'.repeat(300)}`,
      subDescription: `受取人 ${index}`,
      categoryId: index % 2 ? 'shopping' : 'business',
    }),
  );
  const clusters = buildReviewMemory(rows, categories);
  const target = [row('target', { description: rows[50].description, subDescription: rows[50].subDescription })];
  const first = selectReviewMemory(clusters, target);
  const second = selectReviewMemory(clusters, target);
  assert.deepEqual(first.reference, second.reference);
  assert.ok(new TextEncoder().encode(first.serialized).byteLength <= MAX_MEMORY_BYTES);
  assert.equal(first.reference.coverage.truncated, true);
});
