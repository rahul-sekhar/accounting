import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { categorizeTransactions } from '../lib/categorization-server.ts';
import { categorizeRequestHash } from '../lib/transaction-categorization.ts';
import { deleteRequestHash } from '../lib/transaction-deletion.ts';
import { deleteTransactions } from '../lib/operations-server.ts';
import { saveReview } from '../lib/reviews-server.ts';

const root = new URL('../', import.meta.url);
const migration = (name) =>
  readFileSync(new URL(`drizzle/${name}`, root), 'utf8').replaceAll(
    '--> statement-breakpoint',
    '',
  );
const migrationParts = (name) =>
  readFileSync(new URL(`drizzle/${name}`, root), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

class Prepared {
  constructor(owner, sql) {
    this.owner = owner;
    this.sql = sql;
    this.values = [];
  }
  bind(...values) {
    this.values = values;
    return this;
  }
  async first() {
    this.owner.queries.push(this.sql);
    return this.owner.database.prepare(this.sql).get(...this.values) || null;
  }
  async all() {
    this.owner.queries.push(this.sql);
    return {
      results: this.owner.database.prepare(this.sql).all(...this.values),
      success: true,
      meta: {},
    };
  }
  async run() {
    this.owner.queries.push(this.sql);
    const result = this.owner.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: result.changes } };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:');
    this.queries = [];
    this.failBatchAfter = null;
  }
  prepare(sql) {
    return new Prepared(this, sql);
  }
  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    const results = [];
    try {
      for (let index = 0; index < statements.length; index++) {
        const statement = statements[index];
        const result = this.database
          .prepare(statement.sql)
          .run(...statement.values);
        results.push({ success: true, meta: { changes: result.changes } });
        if (this.failBatchAfter === index)
          throw new Error('induced SQL failure');
      }
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function fixture() {
  const db = new SqliteD1();
  db.database.exec('PRAGMA foreign_keys=ON');
  for (const name of [
    '0000_awesome_leper_queen.sql',
    '0001_foamy_zzzax.sql',
    '0002_robust_shooting_star.sql',
    '0003_daily_the_fury.sql',
    '0004_import_outcomes.sql',
  ])
    db.database.exec(migration(name));
  db.database.exec(`
    INSERT INTO accounts (id,user_id,bank,name,type,currency,archived,created_at)
    VALUES ('a1','u1','Bank','Main','Chequing','CAD',0,'2026-01-01'),
           ('a2','u2','Other','Private','Credit','CAD',0,'2026-01-01');
  `);
  return db;
}

function addTransaction(db, id, options = {}) {
  const userId = options.userId || 'u1';
  const accountId = userId === 'u1' ? 'a1' : 'a2';
  db.database
    .prepare(
      `INSERT INTO transactions
       (id,user_id,account_id,date,description,sub_description,amount,fingerprint,import_id,category,source,confidence,category_revision,categorization_evidence,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      userId,
      accountId,
      '2026-01-02',
      options.description || `Merchant ${id}`,
      options.subDescription || '',
      options.amount || -100,
      `fingerprint-${id}`,
      'import-1',
      options.category || 'Uncategorized',
      options.source || 'none',
      options.confidence || null,
      options.revision || 0,
      null,
      '2026-01-02',
    );
}

function addReview(db, id, reviewedAt = null) {
  const row = db.database
    .prepare('SELECT * FROM transactions WHERE id=?')
    .get(id);
  db.database
    .prepare(
      `INSERT INTO transaction_reviews
       (user_id,transaction_id,latest_operation_id,category_id,memory_enabled,revision,reviewed_at,description,sub_description,amount,currency,account_id,account_type,origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      row.user_id,
      id,
      `review-${id}`,
      row.category,
      1,
      row.category_revision,
      reviewedAt,
      row.description,
      row.sub_description,
      row.amount,
      'CAD',
      row.account_id,
      'Chequing',
      'user',
    );
}

function modelResponse(results) {
  return Response.json({
    status: 'completed',
    output: [
      {
        content: [
          {
            type: 'output_text',
            text:
              typeof results === 'string'
                ? results
                : JSON.stringify({ results }),
          },
        ],
      },
    ],
  });
}

function successfulTransport(counter = { calls: 0 }) {
  return async (_url, init) => {
    counter.calls++;
    const request = JSON.parse(init.body);
    const transactions = JSON.parse(request.input).transactions;
    return modelResponse(
      transactions.map((transaction) => ({
        id: transaction.id,
        category: 'Groceries',
        confidence: 'high',
        memory_ids: [],
      })),
    );
  };
}

async function run(db, ids, options = {}) {
  const operationId =
    options.operationId || 'ca1a0868-7884-4c7b-b1d3-ff4bb02fe7dd';
  return categorizeTransactions({
    db,
    userId: 'u1',
    ids,
    operationId,
    requestHash: await categorizeRequestHash(ids),
    apiKey: 'test-only',
    model: 'mock-model',
    transport: options.transport || successfulTransport(),
  });
}

test('mixed 60-target production service run is complete and protects reviews', async () => {
  const db = fixture();
  const ids = Array.from({ length: 60 }, (_, index) => `t-${index}`);
  for (const id of ids) addTransaction(db, id);
  db.database
    .prepare(
      "UPDATE transactions SET source='ai',category='Dining' WHERE id='t-57'",
    )
    .run();
  db.database
    .prepare(
      "UPDATE transactions SET source='manual',category='Other' WHERE id='t-58'",
    )
    .run();
  addReview(db, 't-59', null);
  const counter = { calls: 0 };
  const result = await run(db, ids, {
    transport: successfulTransport(counter),
  });
  assert.equal(counter.calls, 1);
  assert.equal(result.categorizedIds.length, 58);
  assert.deepEqual(result.protectedIds, ['t-58', 't-59']);
  assert.equal(
    db.database
      .prepare(
        "SELECT COUNT(*) count FROM transactions WHERE source='ai' AND category_revision=1",
      )
      .get().count,
    58,
  );
  assert.deepEqual(
    {
      ...db.database
        .prepare(
          "SELECT category,source,category_revision FROM transactions WHERE id='t-58'",
        )
        .get(),
    },
    { category: 'Other', source: 'manual', category_revision: 0 },
  );
  assert.equal(
    db.database.prepare('SELECT COUNT(*) count FROM transaction_reviews').get()
      .count,
    1,
  );
});

test('all protected, missing, and foreign targets skip the provider and save a receipt', async () => {
  const db = fixture();
  addTransaction(db, 'manual', { source: 'manual', category: 'Other' });
  addTransaction(db, 'reviewed');
  addReview(db, 'reviewed', null);
  addTransaction(db, 'foreign', { userId: 'u2' });
  const counter = { calls: 0 };
  const ids = ['manual', 'reviewed', 'missing', 'foreign'];
  const result = await run(db, ids, {
    transport: successfulTransport(counter),
  });
  assert.equal(counter.calls, 0);
  assert.deepEqual(result.protectedIds, ['manual', 'reviewed']);
  assert.deepEqual(result.unavailableIds, ['missing', 'foreign']);
  assert.equal(
    db.database.prepare('SELECT COUNT(*) count FROM operation_receipts').get()
      .count,
    1,
  );
  assert.equal(
    db.database
      .prepare("SELECT source FROM transactions WHERE id='foreign'")
      .get().source,
    'none',
  );
});

test('invalid and incomplete model output never writes targets or receipts', async () => {
  const cases = [
    () => modelResponse('{'),
    () => modelResponse([]),
    () =>
      modelResponse([
        { id: '0', category: 'Unknown', confidence: 'high', memory_ids: [] },
      ]),
    () =>
      modelResponse([
        {
          id: 'wrong',
          category: 'Groceries',
          confidence: 'high',
          memory_ids: [],
        },
      ]),
    () =>
      modelResponse([
        {
          id: '0',
          category: 'Groceries',
          confidence: 'high',
          memory_ids: ['unknown-memory'],
        },
      ]),
    () => Response.json({ status: 'incomplete', output: [] }),
  ];
  for (const [index, response] of cases.entries()) {
    const db = fixture();
    addTransaction(db, 'target');
    await assert.rejects(
      run(db, ['target'], {
        operationId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        transport: async () => response(),
      }),
      (error) => error.code === 'provider_output',
    );
    assert.deepEqual(
      {
        ...db.database
          .prepare(
            "SELECT source,category_revision FROM transactions WHERE id='target'",
          )
          .get(),
      },
      { source: 'none', category_revision: 0 },
    );
    assert.equal(
      db.database.prepare('SELECT COUNT(*) count FROM operation_receipts').get()
        .count,
      0,
    );
  }
});

test('provider errors and timeouts are stable known non-commit failures', async () => {
  for (const transport of [
    async () => new Response('no', { status: 503 }),
    async () => {
      throw new Error('timeout');
    },
  ]) {
    const db = fixture();
    addTransaction(db, 'target');
    await assert.rejects(
      run(db, ['target'], { transport }),
      (error) => error.status === 502 && error.code.startsWith('provider_'),
    );
    assert.equal(
      db.database
        .prepare("SELECT category_revision FROM transactions WHERE id='target'")
        .get().category_revision,
      0,
    );
    assert.equal(
      db.database.prepare('SELECT COUNT(*) count FROM operation_receipts').get()
        .count,
      0,
    );
  }
});

function deferredTransport() {
  let release;
  let startedResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  const transport = async (_url, init) => {
    const request = JSON.parse(init.body);
    const transactions = JSON.parse(request.input).transactions;
    startedResolve();
    await new Promise((resolve) => {
      release = resolve;
    });
    return modelResponse(
      transactions.map((transaction) => ({
        id: transaction.id,
        category: 'Groceries',
        confidence: 'high',
        memory_ids: [],
      })),
    );
  };
  return { transport, started, release: () => release() };
}

test('manual review, category change, deletion, and enrichment races all reject stale AI', async () => {
  const mutations = [
    (db) =>
      saveReview(
        'u1',
        {
          id: 'target',
          category: 'Uncategorized',
          action: 'confirm',
          learn: true,
          operationId: '00000000-0000-4000-8000-000000000090',
          expectedRevision: 0,
        },
        db,
      ),
    (db) => {
      db.database
        .prepare(
          "INSERT INTO category_definitions VALUES ('u1','New','New','expense',0)",
        )
        .run();
      db.database
        .prepare(
          "UPDATE categorization_contexts SET revision=revision+1 WHERE user_id='u1'",
        )
        .run();
    },
    async (db) => {
      const ids = ['target'];
      await deleteTransactions(
        db,
        'u1',
        '00000000-0000-4000-8000-000000000099',
        ids,
        await deleteRequestHash(ids),
      );
    },
    (db) => {
      db.database
        .prepare(
          "UPDATE transactions SET sub_description='enriched',category_revision=category_revision+1 WHERE id='target'",
        )
        .run();
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const db = fixture();
    addTransaction(db, 'target');
    if (index === 2)
      db.database
        .prepare(
          `INSERT INTO transaction_review_events
           (operation_id,user_id,transaction_id,action,previous_category_id,resulting_category_id,previous_source,previous_confidence,previous_memory_enabled,resulting_memory_enabled,description,sub_description,amount,currency,account_id,account_type,recorded_at,reviewed_at,resulting_revision,origin,input_hash)
           VALUES ('historic-review','u1','target','confirm',NULL,'Other','none',NULL,NULL,1,'Historic','',-100,'CAD','a1','Chequing','2025-01-01','2025-01-01',0,'user','historic-hash')`,
        )
        .run();
    const deferred = deferredTransport();
    const pending = run(db, ['target'], {
      operationId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
      transport: deferred.transport,
    });
    await deferred.started;
    await Promise.resolve(mutate(db));
    deferred.release();
    await assert.rejects(pending, (error) => error.code === 'stale_context');
    assert.equal(
      db.database
        .prepare(
          "SELECT COUNT(*) count FROM operation_receipts WHERE kind='categorize'",
        )
        .get().count,
      0,
    );
    const row = db.database
      .prepare("SELECT source,category FROM transactions WHERE id='target'")
      .get();
    if (row) assert.notDeepEqual(row, { source: 'ai', category: 'Groceries' });
    if (index === 0) {
      assert.deepEqual(
        { ...row },
        { source: 'manual', category: 'Uncategorized' },
      );
      assert.equal(
        db.database
          .prepare('SELECT COUNT(*) count FROM transaction_reviews')
          .get().count,
        1,
      );
      assert.equal(
        db.database
          .prepare('SELECT COUNT(*) count FROM transaction_review_events')
          .get().count,
        1,
      );
    }
    if (index === 2) {
      assert.equal(row, undefined);
      assert.equal(
        db.database
          .prepare('SELECT COUNT(*) count FROM transaction_reviews')
          .get().count,
        0,
      );
      assert.equal(
        db.database
          .prepare('SELECT COUNT(*) count FROM transaction_review_events')
          .get().count,
        1,
      );
    }
  }
});

test('receipt replay survives response loss and a later manual edit without another inference', async () => {
  const db = fixture();
  addTransaction(db, 'target');
  const counter = { calls: 0 };
  const operationId = '00000000-0000-4000-8000-000000000201';
  const first = await run(db, ['target'], {
    operationId,
    transport: successfulTransport(counter),
  });
  db.database
    .prepare(
      "UPDATE transactions SET category='Other',source='manual',category_revision=category_revision+1 WHERE id='target'",
    )
    .run();
  const replay = await run(db, ['target'], {
    operationId,
    transport: successfulTransport(counter),
  });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(counter.calls, 1);
  assert.deepEqual(replay.categorizedIds, first.categorizedIds);
  assert.equal(
    db.database
      .prepare("SELECT category FROM transactions WHERE id='target'")
      .get().category,
    'Other',
  );
});

test('operation conflicts and concurrent duplicates permit at most one commit', async () => {
  const db = fixture();
  addTransaction(db, 'a');
  addTransaction(db, 'b');
  const operationId = '00000000-0000-4000-8000-000000000301';
  await run(db, ['a'], { operationId });
  await assert.rejects(
    run(db, ['b'], { operationId }),
    (error) => error.code === 'operation_conflict',
  );

  const db2 = fixture();
  addTransaction(db2, 'target');
  const one = deferredTransport();
  const two = deferredTransport();
  const duplicateId = '00000000-0000-4000-8000-000000000302';
  const first = run(db2, ['target'], {
    operationId: duplicateId,
    transport: one.transport,
  });
  const second = run(db2, ['target'], {
    operationId: duplicateId,
    transport: two.transport,
  });
  await Promise.all([one.started, two.started]);
  one.release();
  two.release();
  const results = await Promise.all([first, second]);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.equal(
    db2.database
      .prepare("SELECT category_revision FROM transactions WHERE id='target'")
      .get().category_revision,
    1,
  );
  assert.equal(
    db2.database.prepare('SELECT COUNT(*) count FROM operation_receipts').get()
      .count,
    1,
  );
});

test('competing categorization cannot overwrite an inference captured first', async () => {
  const db = fixture();
  addTransaction(db, 'target');
  const delayed = deferredTransport();
  const stale = run(db, ['target'], {
    operationId: '00000000-0000-4000-8000-000000000350',
    transport: delayed.transport,
  });
  await delayed.started;
  await run(db, ['target'], {
    operationId: '00000000-0000-4000-8000-000000000351',
  });
  delayed.release();
  await assert.rejects(stale, (error) => error.code === 'stale_context');
  assert.equal(
    db.database
      .prepare("SELECT category_revision FROM transactions WHERE id='target'")
      .get().category_revision,
    1,
  );
  assert.equal(
    db.database.prepare('SELECT COUNT(*) count FROM operation_receipts').get()
      .count,
    1,
  );
});

test('SQL failures after receipt insertion or an earlier update roll back everything', async () => {
  for (const failureIndex of [0, 1]) {
    const db = fixture();
    addTransaction(db, 'a');
    addTransaction(db, 'b');
    db.failBatchAfter = failureIndex;
    await assert.rejects(
      run(db, ['a', 'b'], {
        operationId: `00000000-0000-4000-8000-${String(failureIndex + 400).padStart(12, '0')}`,
      }),
      /induced SQL failure/,
    );
    assert.equal(
      db.database.prepare('SELECT COUNT(*) count FROM operation_receipts').get()
        .count,
      0,
    );
    assert.deepEqual(
      db.database
        .prepare(
          'SELECT source,category_revision FROM transactions ORDER BY id',
        )
        .all()
        .map((row) => ({ ...row })),
      [
        { source: 'none', category_revision: 0 },
        { source: 'none', category_revision: 0 },
      ],
    );
  }
});

test('atomic delete rejection returns a stable known non-commit code', async () => {
  const db = fixture();
  addTransaction(db, 'target');
  const ids = ['target'];
  db.failBatchAfter = 0;
  await assert.rejects(
    deleteTransactions(
      db,
      'u1',
      '00000000-0000-4000-8000-000000000450',
      ids,
      await deleteRequestHash(ids),
    ),
    (error) => error.code === 'delete_not_committed' && error.status === 503,
  );
  assert.equal(
    db.database
      .prepare("SELECT COUNT(*) count FROM transactions WHERE id='target'")
      .get().count,
    1,
  );
  assert.equal(
    db.database.prepare('SELECT COUNT(*) count FROM operation_receipts').get()
      .count,
    0,
  );
});

test('context revision is captured before categories, targets, and memory', async () => {
  const db = fixture();
  addTransaction(db, 'target');
  await run(db, ['target']);
  const revision = db.queries.findIndex((sql) =>
    sql.includes('SELECT revision FROM categorization_contexts'),
  );
  const categories = db.queries.findIndex((sql) =>
    sql.includes('FROM category_definitions'),
  );
  const targets = db.queries.findIndex((sql) =>
    sql.includes('FROM transactions t JOIN accounts'),
  );
  const memory = db.queries.findIndex((sql) =>
    sql.includes('SELECT r.transaction_id'),
  );
  assert.ok(
    revision >= 0 &&
      revision < categories &&
      categories < targets &&
      targets < memory,
  );
});

test('a 60-target batch runs against a disposable workerd D1 runtime', async () => {
  const { Miniflare } = await import('miniflare');
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-05-22',
    d1Databases: { DB: 'plan-7-categorization-test' },
  });
  try {
    const db = await runtime.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys=ON');
    for (const name of [
      '0000_awesome_leper_queen.sql',
      '0001_foamy_zzzax.sql',
      '0002_robust_shooting_star.sql',
      '0003_daily_the_fury.sql',
      '0004_import_outcomes.sql',
    ])
      for (const statement of migrationParts(name))
        await db.prepare(statement).run();
    await db
      .prepare(
        `INSERT INTO accounts (id,user_id,bank,name,type,currency,archived,created_at)
         VALUES ('a1','u1','Bank','Main','Chequing','CAD',0,'2026-01-01')`,
      )
      .run();
    const ids = Array.from({ length: 60 }, (_, index) => `runtime-${index}`);
    await db.batch(
      ids.map((id) =>
        db
          .prepare(
            `INSERT INTO transactions
             (id,user_id,account_id,date,description,sub_description,amount,fingerprint,import_id,category,source,confidence,category_revision,categorization_evidence,created_at)
             VALUES (?,'u1','a1','2026-01-02',?,'',-100,?,'import-1','Uncategorized','none',NULL,0,NULL,'2026-01-02')`,
          )
          .bind(id, `Merchant ${id}`, `fingerprint-${id}`),
      ),
    );
    const result = await categorizeTransactions({
      db,
      userId: 'u1',
      ids,
      operationId: '00000000-0000-4000-8000-000000000500',
      requestHash: await categorizeRequestHash(ids),
      apiKey: 'test-only',
      model: 'mock-model',
      transport: successfulTransport(),
    });
    assert.equal(result.categorizedIds.length, 60);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) count FROM transactions WHERE source='ai' AND category_revision=1",
          )
          .first()
      ).count,
      60,
    );
  } finally {
    await runtime.dispose();
  }
});
