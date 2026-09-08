import test from 'node:test';
import assert from 'node:assert/strict';
import { BulkOperationController } from '../lib/bulk-operation.ts';

const until = async (predicate) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Controller did not reach the expected state.');
};

function outcome(kind, ids, raw) {
  const lists =
    kind === 'delete'
      ? [raw.deletedIds, raw.unavailableIds]
      : [raw.categorizedIds, raw.protectedIds, raw.unavailableIds];
  const resolvedIds = lists.flat();
  if (
    resolvedIds.length !== ids.length ||
    new Set(resolvedIds).size !== resolvedIds.length
  )
    throw new Error('incomplete');
  return {
    resolvedIds,
    deletedIds: raw.deletedIds || [],
    categorizedIds: raw.categorizedIds || [],
    protectedIds: raw.protectedIds || [],
    unavailableIds: raw.unavailableIds || [],
    deleted: raw.deletedIds?.length || 0,
    categorized: raw.categorizedIds?.length || 0,
    protected: raw.protectedIds?.length || 0,
    unavailable: raw.unavailableIds?.length || 0,
  };
}

function makeController(overrides = {}) {
  let state = null;
  let sequence = 0;
  const calls = [];
  const controller = new BulkOperationController({
    request: async (kind, payload) => {
      calls.push({ kind, payload: structuredClone(payload) });
      return kind === 'delete'
        ? { deletedIds: payload.ids, unavailableIds: [] }
        : {
            categorizedIds: payload.ids,
            protectedIds: [],
            unavailableIds: [],
          };
    },
    normalize: outcome,
    refresh: async () => {},
    committed: () => {},
    changed: (next) => {
      state = next;
    },
    uuid: () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    ...overrides,
  });
  return { controller, calls, state: () => state };
}

test('one synchronous lock governs completed categorization then deletion and double starts', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const fixture = makeController({
    request: async (kind, payload) => {
      fixture.calls.push({ kind, payload: structuredClone(payload) });
      if (fixture.calls.length === 1) await pending;
      return kind === 'delete'
        ? { deletedIds: payload.ids, unavailableIds: [] }
        : { categorizedIds: payload.ids, protectedIds: [], unavailableIds: [] };
    },
  });
  assert.equal(fixture.controller.start('categorize', ['a']), true);
  assert.equal(fixture.controller.start('delete', ['b']), false);
  assert.equal(fixture.state().kind, 'categorize');
  release();
  await until(() => fixture.state()?.status === 'completed');
  assert.equal(fixture.controller.start('delete', ['b']), true);
  assert.equal(fixture.state().kind, 'delete');
  assert.equal(fixture.controller.start('categorize', ['c']), false);
  await until(() => fixture.state()?.status === 'completed');
  assert.equal(fixture.controller.start('categorize', ['c']), true);
  await until(() => fixture.state()?.status === 'completed');
  assert.equal(fixture.state().kind, 'categorize');
});

test('definitive later-batch failure resumes with cumulative totals', async () => {
  let secondAttempt = 0;
  const firstIds = Array.from({ length: 50 }, (_, i) => `t-${i}`);
  const ids = [...firstIds, ...Array.from({ length: 30 }, (_, i) => `u-${i}`)];
  const fixture = makeController({
    request: async (kind, payload) => {
      fixture.calls.push({ kind, payload: structuredClone(payload) });
      if (payload.ids[0] === 'u-0' && secondAttempt++ === 0) {
        throw Object.assign(new Error('Deletion was not committed.'), {
          status: 503,
          code: 'delete_not_committed',
          certainty: 'precommit',
        });
      }
      return { deletedIds: payload.ids, unavailableIds: [] };
    },
  });
  fixture.controller.start('delete', ids);
  await until(() => fixture.state()?.status === 'failed');
  assert.equal(fixture.state().total, 80);
  assert.equal(fixture.state().processed, 50);
  assert.equal(fixture.state().deleted, 50);
  assert.equal(await fixture.controller.resume(), true);
  await until(() => fixture.state()?.status === 'completed');
  assert.equal(fixture.state().total, 80);
  assert.equal(fixture.state().processed, 80);
  assert.equal(fixture.state().deleted, 80);
  assert.equal(
    fixture.calls.filter((call) => call.payload.ids[0] === 't-0').length,
    1,
  );
});

test('lost response remains locked and recovery replays the exact batch identity', async () => {
  const mutations = new Set();
  let first = true;
  const fixture = makeController({
    request: async (kind, payload) => {
      fixture.calls.push({ kind, payload: structuredClone(payload) });
      mutations.add(`${payload.operationId}:${payload.ids.join(',')}`);
      if (first) {
        first = false;
        throw Object.assign(new Error('Response lost.'), {
          certainty: 'unresolved',
        });
      }
      return { deletedIds: payload.ids, unavailableIds: [] };
    },
  });
  fixture.controller.start('delete', ['a', 'b']);
  await until(() => fixture.state()?.status === 'unresolved');
  assert.equal(fixture.controller.start('categorize', ['c']), false);
  assert.equal(fixture.controller.abandon(), false);
  const sent = structuredClone(fixture.calls[0].payload);
  fixture.controller.recover();
  await until(() => fixture.state()?.status === 'completed');
  assert.deepEqual(fixture.calls[1].payload, sent);
  assert.equal(mutations.size, 1);
  assert.equal(fixture.state().deleted, 2);
});

test('categorization recovery also replays its exact UUID and payload', async () => {
  let first = true;
  const fixture = makeController({
    request: async (kind, payload) => {
      fixture.calls.push({ kind, payload: structuredClone(payload) });
      if (first) {
        first = false;
        throw Object.assign(new Error('Response lost.'), {
          certainty: 'unresolved',
        });
      }
      return {
        categorizedIds: payload.ids,
        protectedIds: [],
        unavailableIds: [],
      };
    },
  });
  fixture.controller.start('categorize', ['a', 'b']);
  await until(() => fixture.state()?.status === 'unresolved');
  const sent = structuredClone(fixture.calls[0].payload);
  fixture.controller.recover();
  await until(() => fixture.state()?.status === 'completed');
  assert.deepEqual(fixture.calls[1].payload, sent);
  assert.equal(fixture.state().categorized, 2);
});

test('a stop requested during uncertainty waits until receipt recovery', async () => {
  let first = true;
  let releaseFirst;
  const firstResponse = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const ids = Array.from({ length: 61 }, (_, index) => `t-${index}`);
  const fixture = makeController({
    request: async (kind, payload) => {
      fixture.calls.push({ kind, payload: structuredClone(payload) });
      if (first) {
        first = false;
        await firstResponse;
        throw Object.assign(new Error('Response lost.'), {
          certainty: 'unresolved',
        });
      }
      return {
        categorizedIds: payload.ids,
        protectedIds: [],
        unavailableIds: [],
      };
    },
  });
  fixture.controller.start('categorize', ids);
  await until(() => fixture.calls.length === 1);
  fixture.controller.stop();
  releaseFirst();
  await until(() => fixture.state()?.status === 'unresolved');
  await new Promise((resolve) => setImmediate(resolve));
  fixture.controller.recover();
  await until(() => fixture.state()?.status === 'stopped');
  assert.equal(fixture.state().processed, 60);
  assert.equal(fixture.state().remaining.length, 1);
  assert.equal(fixture.calls.length, 2);
});

test('stale context gets a new identity, while operation conflict cannot retry', async () => {
  let stale = true;
  const fixture = makeController({
    request: async (kind, payload) => {
      fixture.calls.push({ kind, payload: structuredClone(payload) });
      if (stale) {
        stale = false;
        throw Object.assign(new Error('Stale.'), {
          status: 409,
          code: 'stale_context',
          certainty: 'precommit',
        });
      }
      return {
        categorizedIds: payload.ids,
        protectedIds: [],
        unavailableIds: [],
      };
    },
  });
  fixture.controller.start('categorize', ['a']);
  await until(() => fixture.state()?.status === 'failed');
  const firstId = fixture.calls[0].payload.operationId;
  await fixture.controller.resume();
  await until(() => fixture.state()?.status === 'completed');
  assert.notEqual(fixture.calls[1].payload.operationId, firstId);

  const conflict = makeController({
    request: async () => {
      throw Object.assign(new Error('Conflict.'), {
        status: 409,
        code: 'operation_conflict',
        certainty: 'precommit',
      });
    },
  });
  conflict.controller.start('delete', ['a']);
  await until(() => conflict.state()?.status === 'failed');
  assert.equal(conflict.controller.locked, false);
  assert.equal(await conflict.controller.resume(), false);
});

test('stop and resume preserve a 121-item categorization total', async () => {
  const ids = Array.from({ length: 121 }, (_, i) => `t-${i}`);
  const fixture = makeController({
    committed: () => {
      if (fixture.state()?.processed === 0) fixture.controller.stop();
    },
  });
  fixture.controller.start('categorize', ids);
  await until(() => fixture.state()?.status === 'stopped');
  assert.equal(fixture.state().processed, 60);
  assert.equal(fixture.state().total, 121);
  await fixture.controller.resume();
  await until(() => fixture.state()?.status === 'completed');
  assert.equal(fixture.state().processed, 121);
  assert.equal(fixture.state().categorized, 121);
});

test('refresh failure does not repeat a committed mutation', async () => {
  let refreshes = 0;
  const fixture = makeController({
    refresh: async () => {
      if (refreshes++ === 0) throw new Error('Refresh offline.');
    },
  });
  fixture.controller.start('delete', ['a']);
  await until(() => fixture.state()?.status === 'completed');
  assert.match(fixture.state().refreshError, /Refresh offline/);
  assert.equal(fixture.calls.length, 1);
  fixture.controller.retryRefresh();
  await until(() => !fixture.state()?.refreshError);
  assert.equal(fixture.calls.length, 1);
  assert.equal(refreshes, 2);
});
