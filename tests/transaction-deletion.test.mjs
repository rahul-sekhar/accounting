import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DELETE_IDS,
  deleteRequestHash,
  parseDeleteRequest,
} from '../lib/transaction-deletion.ts';

const operationId = 'ca1a0868-7884-4c7b-b1d3-ff4bb02fe7dd';

test('delete input is bounded, unique, explicit, and canonical', () => {
  assert.deepEqual(parseDeleteRequest({ operationId, ids: ['b', 'a'] }), {
    operationId,
    ids: ['a', 'b'],
  });
  assert.throws(
    () => parseDeleteRequest({ operationId, ids: [] }),
    /between 1 and 50/,
  );
  assert.throws(
    () => parseDeleteRequest({ operationId, ids: ['a', 'a'] }),
    /unique/,
  );
  assert.throws(
    () =>
      parseDeleteRequest({
        operationId,
        ids: Array.from({ length: MAX_DELETE_IDS + 1 }, (_, index) =>
          String(index),
        ),
      }),
    /between 1 and 50/,
  );
  assert.throws(
    () => parseDeleteRequest({ operationId: 'retry', ids: ['a'] }),
    /valid delete operation/,
  );
});

test('delete request hashes are independent of ID order but not membership', async () => {
  assert.equal(
    await deleteRequestHash(['b', 'a']),
    await deleteRequestHash(['a', 'b']),
  );
  assert.notEqual(
    await deleteRequestHash(['a', 'b']),
    await deleteRequestHash(['a']),
  );
});
