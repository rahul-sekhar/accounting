import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';
const base = process.env.BASE_URL || 'http://localhost:3000';
const sign = await fetch(base + '/signin-with-chatgpt?return_to=%2F', {
  redirect: 'manual',
});
assert.equal(sign.status, 302);
const cookie = sign.headers.get('set-cookie').split(';')[0];
async function req(path, method = 'GET', data, auth = true, origin = base) {
  const r = await fetch(base + '/api/' + path, {
    method,
    headers: {
      ...(auth ? { cookie } : {}),
      ...(data ? { 'Content-Type': 'application/json', Origin: origin } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const raw = await r.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    result = { error: raw };
  }
  return { status: r.status, data: result };
}
const mapping = {
  date: 'Date',
  description: 'Description',
  amount: 'Amount',
  debit: '',
  credit: '',
  mode: 'signed',
  sign: 'normal',
  dateFormat: 'YMD',
};
const csv =
  'Date,Description,Amount\n2026-08-01,QA BUS,-3.25\n2026-08-01,QA BUS,-3.25\n2026-08-02,QA PAYROLL,2000.00';
const payload = {
  operationId: crypto.randomUUID(),
  csv,
  filename: 'qa-only.csv',
  mapping,
  account: {
    bank: 'Pacific Test Credit Union',
    name: 'QA disposable account',
    type: 'Chequing',
    currency: 'CAD',
  },
};
assert.equal((await req('data', 'GET', undefined, false)).status, 401);
assert.equal((await req('import', 'POST', payload, false)).status, 401);
assert.equal(
  (await req('import', 'POST', payload, true, 'https://other.example')).status,
  403,
);
const unused = await req('account', 'POST', {
  bank: '  任意信用組合  ',
  name: '  QA unused  ',
  type: 'Savings',
  currency: 'CAD',
});
assert.equal(unused.status, 200, JSON.stringify(unused));
assert.equal(unused.data.account.bank, '任意信用組合');
assert.equal(unused.data.account.name, 'QA unused');
const unusedId = unused.data.account.id;
const unusedUpdate = await req('account', 'PATCH', {
  id: unusedId,
  action: 'update',
  bank: 'Another Institution',
  name: 'Unused renamed',
  type: 'Investment',
  currency: 'USD',
});
assert.equal(unusedUpdate.status, 200, JSON.stringify(unusedUpdate));
assert.equal(unusedUpdate.data.account.currency, 'USD');
assert.equal((await req('account', 'DELETE', { id: unusedId })).status, 200);
assert.equal(
  (await req('account', 'DELETE', { id: 'someone-elses-id' })).status,
  404,
);
assert.equal(
  (
    await req('account', 'POST', {
      bank: ' ',
      name: 'Bad',
      type: 'Chequing',
      currency: 'CAD',
    })
  ).status,
  400,
);
const first = await req('import', 'POST', payload);
assert.equal(first.status, 200, JSON.stringify(first));
assert.equal(first.data.added, 3);
const accountId = first.data.accountId;
const recovered = await req('import', 'POST', payload);
assert.equal(recovered.status, 200, JSON.stringify(recovered));
assert.equal(recovered.data.importId, first.data.importId);
assert.equal(recovered.data.replayed, true);
assert.equal(
  (await req('import', 'POST', { ...payload, filename: 'conflict.csv' }))
    .status,
  409,
);
const second = await req('import', 'POST', {
  ...payload,
  operationId: crypto.randomUUID(),
  accountId,
});
assert.equal(second.data.added, 0);
assert.equal(second.data.skipped, 3);
assert.equal(second.data.enriched, 0);
const importDetails = await req(
  `imports/${second.data.importId}?outcome=duplicate&limit=2`,
);
assert.equal(importDetails.status, 200, JSON.stringify(importDetails));
assert.equal(importDetails.data.detailsAvailable, true);
assert.equal(importDetails.data.outcomes.length, 2);
assert.ok(importDetails.data.nextCursor);
const importDetailsPage2 = await req(
  `imports/${second.data.importId}?outcome=duplicate&limit=2&cursor=${importDetails.data.nextCursor}`,
);
assert.equal(importDetailsPage2.data.outcomes.length, 1);
const importList = await req('imports?limit=1');
assert.equal(importList.status, 200, JSON.stringify(importList));
assert.equal(importList.data.items.length, 1);
assert.ok(importList.data.nextCursor);
const overlapPayload = {
  ...payload,
  accountId,
  csv: 'Date,Description,Amount\n2026-08-03,QA CONCURRENT,-9.99',
  filename: 'qa-concurrent.csv',
};
const overlapping = await Promise.all([
  req('import', 'POST', {
    ...overlapPayload,
    operationId: crypto.randomUUID(),
  }),
  req('import', 'POST', {
    ...overlapPayload,
    operationId: crypto.randomUUID(),
  }),
]);
assert.deepEqual(
  overlapping.map((result) => result.status),
  [200, 200],
);
assert.deepEqual(
  overlapping.map((result) => result.data.added).sort((a, b) => a - b),
  [0, 1],
);
assert.deepEqual(
  overlapping.map((result) => result.data.skipped).sort((a, b) => a - b),
  [0, 1],
);
let all = await req('data');
assert.equal(all.status, 200);
const rows = all.data.transactions.filter(
  (t) => t.account_id === accountId && t.description !== 'QA CONCURRENT',
);
assert.equal(rows.length, 3);
assert.equal(rows.filter((t) => t.description === 'QA BUS').length, 2);
const reversePayload = {
  operationId: crypto.randomUUID(),
  csv: 'Date,Description,Amount\n2026-08-10,QA CARD PURCHASE,12.34\n2026-08-11,QA CARD REFUND,-3.00',
  filename: 'qa-direction.csv',
  mapping: { ...mapping, sign: 'reverse' },
  account: {
    bank: 'Direction Test Institution',
    name: 'QA direction account',
    type: 'Credit card',
    currency: 'CAD',
  },
};
const reversed = await req('import', 'POST', reversePayload);
assert.equal(reversed.status, 200, JSON.stringify(reversed));
assert.equal(reversed.data.added, 2);
all = await req('data');
const reversedRows = all.data.transactions.filter(
  (transaction) => transaction.account_id === reversed.data.accountId,
);
assert.deepEqual(
  reversedRows
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((transaction) => transaction.amount),
  [-1234, 300],
);
const reversedAgain = await req('import', 'POST', {
  ...reversePayload,
  operationId: crypto.randomUUID(),
  accountId: reversed.data.accountId,
});
assert.equal(reversedAgain.status, 200, JSON.stringify(reversedAgain));
assert.equal(reversedAgain.data.added, 0);
assert.equal(reversedAgain.data.skipped, 2);
const boundaryCsv = [
  'Date,Description,Amount',
  ...Array.from(
    { length: 2000 },
    (_, index) => `2026-07-01,QA BOUNDARY ${index + 1},-${index + 1}.00`,
  ),
].join('\n');
const boundary = await req('import', 'POST', {
  ...payload,
  operationId: crypto.randomUUID(),
  csv: boundaryCsv,
  filename: 'qa-boundary.csv',
  account: {
    bank: 'Boundary Test Institution',
    name: 'QA 2000 row account',
    type: 'Chequing',
    currency: 'CAD',
  },
});
assert.equal(boundary.status, 200, JSON.stringify(boundary));
assert.equal(boundary.data.total, 2000);
assert.equal(boundary.data.added, 2000);
const boundaryAgain = await req('import', 'POST', {
  ...payload,
  operationId: crypto.randomUUID(),
  accountId: boundary.data.accountId,
  csv: boundaryCsv,
  filename: 'qa-boundary-again.csv',
});
assert.equal(boundaryAgain.status, 200, JSON.stringify(boundaryAgain));
assert.equal(boundaryAgain.data.skipped, 2000);
const renamed = await req('account', 'PATCH', {
  id: accountId,
  action: 'update',
  bank: 'Pacific Test Credit Union',
  name: 'QA renamed account',
  type: 'Chequing',
  currency: 'CAD',
});
assert.equal(renamed.status, 200, JSON.stringify(renamed));
assert.equal(
  (
    await req('account', 'PATCH', {
      id: accountId,
      action: 'update',
      bank: 'Pacific Test Credit Union',
      name: 'QA renamed account',
      type: 'Savings',
      currency: 'CAD',
    })
  ).status,
  409,
);
assert.equal(
  (await req('account', 'PATCH', { id: accountId, action: 'archive' })).status,
  200,
);
assert.equal(
  (await req('account', 'PATCH', { id: accountId, action: 'archive' })).status,
  200,
);
assert.equal(
  (
    await req('import', 'POST', {
      ...payload,
      operationId: crypto.randomUUID(),
      accountId,
    })
  ).status,
  409,
);
assert.equal(
  (await req('account', 'PATCH', { id: accountId, action: 'restore' })).status,
  200,
);
assert.equal((await req('account', 'DELETE', { id: accountId })).status, 409);
const reviewOperationId = crypto.randomUUID();
const reviewPayload = {
  id: rows[0].id,
  category: 'Transfers',
  action: 'correct',
  learn: true,
  operationId: reviewOperationId,
  expectedRevision: rows[0].category_revision,
};
const changed = await req('category', 'PATCH', reviewPayload);
assert.equal(changed.status, 200);
const replay = await req('category', 'PATCH', reviewPayload);
assert.equal(replay.status, 200);
assert.equal(replay.data.replayed, true);
assert.equal(
  (
    await req('category', 'PATCH', {
      ...reviewPayload,
      category: 'Income',
    })
  ).status,
  409,
);
assert.equal(
  (
    await req('category', 'PATCH', {
      ...reviewPayload,
      operationId: crypto.randomUUID(),
    })
  ).status,
  409,
);
const memoryOff = await req('category', 'PATCH', {
  id: rows[0].id,
  category: 'Transfers',
  action: 'memory_disable',
  learn: false,
  operationId: crypto.randomUUID(),
  expectedRevision: changed.data.categoryRevision,
});
assert.equal(memoryOff.status, 200);
const enrichmentMapping = { ...mapping, subDescription: 'Memo' };
const enrichmentCsv =
  'Date,Description,Memo,Amount\n2026-08-01,QA BUS,Route 4,-3.25\n2026-08-01,QA BUS,Route 7,-3.25\n2026-08-02,QA PAYROLL,September payroll,2000.00';
const enrichedImport = await req('import', 'POST', {
  ...payload,
  operationId: crypto.randomUUID(),
  accountId,
  csv: enrichmentCsv,
  filename: 'qa-enrichment.csv',
  mapping: enrichmentMapping,
});
assert.equal(enrichedImport.status, 200, JSON.stringify(enrichedImport));
assert.equal(enrichedImport.data.added, 0);
assert.equal(enrichedImport.data.skipped, 3);
assert.equal(enrichedImport.data.enriched, 3);
const enrichmentDetails = await req(
  `imports/${enrichedImport.data.importId}?outcome=duplicate_enriched`,
);
assert.equal(enrichmentDetails.data.outcomes.length, 3);
const skippedOverwrite = await req('import', 'POST', {
  ...payload,
  operationId: crypto.randomUUID(),
  accountId,
  csv: enrichmentCsv
    .replaceAll('Route 4', 'Replacement')
    .replaceAll('Route 7', 'Replacement 2'),
  filename: 'qa-no-overwrite.csv',
  mapping: enrichmentMapping,
});
assert.equal(skippedOverwrite.status, 200, JSON.stringify(skippedOverwrite));
assert.equal(skippedOverwrite.data.enriched, 0);
const memoryState = await req('review-memory');
assert.equal(memoryState.status, 200);
assert.equal(
  memoryState.data.reviews.find((review) => review.transactionId === rows[0].id)
    .memoryEnabled,
  0,
);
assert.equal(
  (
    await req('category', 'PATCH', {
      id: rows[0].id,
      category: 'Invalid',
      action: 'correct',
      operationId: crypto.randomUUID(),
      expectedRevision: memoryOff.data.categoryRevision + 1,
    })
  ).status,
  400,
);
assert.equal(
  (
    await req('category', 'PATCH', {
      id: 'someone-elses-id',
      category: 'Income',
      action: 'correct',
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
    })
  ).status,
  404,
);
assert.equal(
  (
    await req('account', 'PATCH', {
      id: accountId,
      balance: 54321,
      balanceDate: '2026-08-31',
    })
  ).status,
  400,
);
all = await req('data');
assert.equal(
  all.data.accounts.find((a) => a.id === accountId).name,
  'QA renamed account',
);
assert.equal(all.data.accounts.find((a) => a.id === accountId).archived, false);
assert.equal(
  all.data.transactions.filter((t) => t.account_id === accountId).length,
  4,
);
assert.equal(
  all.data.transactions.find((t) => t.id === rows[0].id).source,
  'manual',
);
assert.equal(
  all.data.transactions.find((t) => t.id === rows[0].id).has_review,
  true,
);
assert.equal(
  ['Route 4', 'Route 7', 'September payroll'].includes(
    all.data.transactions.find((t) => t.id === rows[0].id).sub_description,
  ),
  true,
);
assert.equal(
  all.data.transactions.find((t) => t.id === rows[0].id).category_revision,
  memoryOff.data.categoryRevision + 1,
);
assert.equal(
  (
    await req('import', 'POST', {
      ...payload,
      operationId: crypto.randomUUID(),
      accountId,
      csv: 'Date,Description,Amount,Currency\n2026-08-01,QA USD,50,USD',
    })
  ).status,
  400,
);
assert.equal(
  (
    await req('import', 'POST', {
      ...payload,
      operationId: crypto.randomUUID(),
      accountId,
      csv: 'Date,Description,Amount\n2026-02-30,QA BAD,50',
    })
  ).status,
  400,
);
assert.equal(
  (
    await req('import', 'POST', {
      ...payload,
      operationId: crypto.randomUUID(),
      accountId: 'someone-elses-id',
    })
  ).status,
  404,
);
if (!all.data.aiReady)
  assert.equal(
    (
      await req('map-csv', 'POST', {
        headers: ['Date', 'Description', 'Amount'],
        rows: [['2026-08-01', 'QA PURCHASE', '12.34']],
        bank: 'QA institution',
        accountType: 'Credit card',
      })
    ).status,
    503,
  );

const protectedCategorizeOperation = crypto.randomUUID();
const protectedCategorizePayload = {
  operationId: protectedCategorizeOperation,
  ids: [rows[0].id, 'missing-categorize-id'],
};
const protectedCategorize = await req(
  'categorize',
  'POST',
  protectedCategorizePayload,
);
assert.equal(
  protectedCategorize.status,
  200,
  JSON.stringify(protectedCategorize),
);
assert.equal(protectedCategorize.data.categorized, 0);
assert.deepEqual(protectedCategorize.data.protectedIds, [rows[0].id]);
assert.deepEqual(protectedCategorize.data.unavailableIds, [
  'missing-categorize-id',
]);
const protectedCategorizeReplay = await req(
  'categorize',
  'POST',
  protectedCategorizePayload,
);
assert.equal(protectedCategorizeReplay.status, 200);
assert.equal(protectedCategorizeReplay.data.replayed, true);
assert.equal(
  (
    await req('categorize', 'POST', {
      operationId: protectedCategorizeOperation,
      ids: [rows[0].id],
    })
  ).status,
  409,
);
if (!all.data.aiReady)
  assert.equal(
    (
      await req('categorize', 'POST', {
        operationId: crypto.randomUUID(),
        ids: [rows[1].id],
      })
    ).status,
    503,
  );

const deleteFixture = await req('import', 'POST', {
  ...payload,
  operationId: crypto.randomUUID(),
  accountId,
  csv: 'Date,Description,Amount\n2026-08-21,QA DELETE REIMPORT,-17.49',
  filename: 'qa-delete.csv',
});
assert.equal(deleteFixture.status, 200, JSON.stringify(deleteFixture));
all = await req('data');
const deleteTarget = all.data.transactions.find(
  (transaction) =>
    transaction.account_id === accountId &&
    transaction.description === 'QA DELETE REIMPORT',
);
const deleteReviewOperation = crypto.randomUUID();
const deleteReviewPayload = {
  id: deleteTarget.id,
  category: 'Other',
  action: 'correct',
  learn: true,
  operationId: deleteReviewOperation,
  expectedRevision: deleteTarget.category_revision,
};
assert.equal((await req('category', 'PATCH', deleteReviewPayload)).status, 200);
assert.equal(
  (
    await req('transactions/delete', 'POST', {
      operationId: crypto.randomUUID(),
      ids: [],
    })
  ).status,
  400,
);
assert.equal(
  (
    await req('transactions/delete', 'POST', {
      operationId: crypto.randomUUID(),
      ids: Array.from({ length: 51 }, (_, index) => `missing-${index}`),
    })
  ).status,
  400,
);
const deleteOperationId = crypto.randomUUID();
const localDatabase = globSync(
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite',
).find((path) => !path.endsWith('/metadata.sqlite'));
assert.ok(localDatabase, 'Expected the disposable local D1 database.');
const currentUserId = execFileSync(
  'sqlite3',
  [localDatabase, `SELECT user_id FROM accounts WHERE id='${accountId}';`],
  { encoding: 'utf8' },
).trim();
const foreignAccountId = crypto.randomUUID();
const foreignTransactionId = crypto.randomUUID();
execFileSync('sqlite3', [localDatabase], {
  input: `PRAGMA foreign_keys=ON;
    INSERT INTO accounts (id,user_id,bank,name,type,currency,archived,created_at)
      VALUES ('${foreignAccountId}','other-test-user','Other institution','Foreign fixture','Chequing','CAD',0,'2026-08-21T00:00:00Z');
    INSERT INTO transactions (id,user_id,account_id,date,description,sub_description,amount,fingerprint,import_id,category,source,confidence,category_revision,categorization_evidence,created_at)
      VALUES ('${foreignTransactionId}','other-test-user','${foreignAccountId}','2026-08-21','FOREIGN DELETE FIXTURE','',-100,'foreign-delete-fingerprint','foreign-import','Uncategorized','none',NULL,0,NULL,'2026-08-21T00:00:00Z');`,
});
execFileSync('sqlite3', [localDatabase], {
  input: `UPDATE transaction_reviews SET reviewed_at=NULL
    WHERE user_id='${currentUserId}' AND transaction_id='${deleteTarget.id}';`,
});
const migratedReviewProjection = await req('data');
const migratedReviewedTransaction =
  migratedReviewProjection.data.transactions.find(
    (transaction) => transaction.id === deleteTarget.id,
  );
assert.equal(migratedReviewedTransaction.reviewed_at, null);
assert.equal(migratedReviewedTransaction.has_review, true);
const isolatedCategorize = await req('categorize', 'POST', {
  operationId: crypto.randomUUID(),
  ids: [deleteTarget.id, foreignTransactionId],
});
assert.equal(
  isolatedCategorize.status,
  200,
  JSON.stringify(isolatedCategorize),
);
assert.deepEqual(isolatedCategorize.data.protectedIds, [deleteTarget.id]);
assert.deepEqual(isolatedCategorize.data.unavailableIds, [
  foreignTransactionId,
]);
assert.equal(
  execFileSync(
    'sqlite3',
    [
      localDatabase,
      `SELECT source FROM transactions WHERE id='${foreignTransactionId}' AND user_id='other-test-user';`,
    ],
    { encoding: 'utf8' },
  ).trim(),
  'none',
);
const contextBeforeDelete = Number(
  execFileSync(
    'sqlite3',
    [
      localDatabase,
      `SELECT revision FROM categorization_contexts WHERE user_id='${currentUserId}';`,
    ],
    { encoding: 'utf8' },
  ).trim(),
);
const deletePayload = {
  operationId: deleteOperationId,
  ids: [deleteTarget.id, foreignTransactionId],
};
const deleted = await req('transactions/delete', 'POST', deletePayload);
assert.equal(deleted.status, 200, JSON.stringify(deleted));
assert.deepEqual(deleted.data.deletedIds, [deleteTarget.id]);
assert.deepEqual(deleted.data.unavailableIds, [foreignTransactionId]);
assert.equal(
  execFileSync(
    'sqlite3',
    [
      localDatabase,
      `SELECT COUNT(*) FROM transactions WHERE id='${foreignTransactionId}' AND user_id='other-test-user';`,
    ],
    { encoding: 'utf8' },
  ).trim(),
  '1',
);
assert.equal(
  Number(
    execFileSync(
      'sqlite3',
      [
        localDatabase,
        `SELECT revision FROM categorization_contexts WHERE user_id='${currentUserId}';`,
      ],
      { encoding: 'utf8' },
    ).trim(),
  ),
  contextBeforeDelete + 1,
);
const deleteReplay = await req('transactions/delete', 'POST', deletePayload);
assert.equal(deleteReplay.status, 200, JSON.stringify(deleteReplay));
assert.equal(deleteReplay.data.replayed, true);
assert.equal(
  Number(
    execFileSync(
      'sqlite3',
      [
        localDatabase,
        `SELECT revision FROM categorization_contexts WHERE user_id='${currentUserId}';`,
      ],
      { encoding: 'utf8' },
    ).trim(),
  ),
  contextBeforeDelete + 1,
);
assert.equal(
  (
    await req('transactions/delete', 'POST', {
      operationId: deleteOperationId,
      ids: ['different-id'],
    })
  ).status,
  409,
);
assert.equal((await req('category', 'PATCH', deleteReviewPayload)).status, 404);
assert.equal(
  execFileSync(
    'sqlite3',
    [
      localDatabase,
      `SELECT COUNT(*) FROM transaction_review_events WHERE user_id='${currentUserId}' AND operation_id='${deleteReviewOperation}';`,
    ],
    { encoding: 'utf8' },
  ).trim(),
  '1',
);
assert.equal(
  execFileSync(
    'sqlite3',
    [
      localDatabase,
      `SELECT COUNT(*) FROM transaction_reviews WHERE user_id='${currentUserId}' AND transaction_id='${deleteTarget.id}';`,
    ],
    { encoding: 'utf8' },
  ).trim(),
  '0',
);
const afterDeleteMemory = await req('review-memory');
assert.equal(
  afterDeleteMemory.data.reviews.some(
    (review) => review.transactionId === deleteTarget.id,
  ),
  false,
);
const retainedDeleteOutcome = await req(
  `imports/${deleteFixture.data.importId}?outcome=added`,
);
assert.equal(
  retainedDeleteOutcome.data.outcomes[0].current_transaction_id,
  null,
);
const reimportedDelete = await req('import', 'POST', {
  ...payload,
  operationId: crypto.randomUUID(),
  accountId,
  csv: 'Date,Description,Amount\n2026-08-21,QA DELETE REIMPORT,-17.49',
  filename: 'qa-delete-reimport.csv',
});
assert.equal(reimportedDelete.data.added, 1);
all = await req('data');
const replacement = all.data.transactions.find(
  (transaction) =>
    transaction.account_id === accountId &&
    transaction.description === 'QA DELETE REIMPORT',
);
assert.notEqual(replacement.id, deleteTarget.id);
assert.equal(replacement.source, 'none');
execFileSync('sqlite3', [localDatabase], {
  input: `PRAGMA foreign_keys=ON; DELETE FROM accounts WHERE id='${foreignAccountId}' AND user_id='other-test-user';`,
});
console.log(
  'PASS: sign-in, account lifecycle, imports and retained outcomes, safe receipt-backed deletion and re-import, review replay protection, unavailable-AI fallback, unauthenticated and cross-origin requests.',
);
console.log('QA account ID: ' + accountId);
