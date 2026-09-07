import assert from 'node:assert/strict';
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
const second = await req('import', 'POST', { ...payload, accountId });
assert.equal(second.data.added, 0);
assert.equal(second.data.skipped, 3);
let all = await req('data');
assert.equal(all.status, 200);
const rows = all.data.transactions.filter((t) => t.account_id === accountId);
assert.equal(rows.length, 3);
assert.equal(rows.filter((t) => t.description === 'QA BUS').length, 2);
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
  (await req('import', 'POST', { ...payload, accountId })).status,
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
      expectedRevision: memoryOff.data.categoryRevision,
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
  3,
);
assert.equal(
  all.data.transactions.find((t) => t.id === rows[0].id).source,
  'manual',
);
assert.equal(
  (
    await req('import', 'POST', {
      ...payload,
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
      accountId,
      csv: 'Date,Description,Amount\n2026-02-30,QA BAD,50',
    })
  ).status,
  400,
);
assert.equal(
  (await req('import', 'POST', { ...payload, accountId: 'someone-elses-id' }))
    .status,
  404,
);
if (!all.data.aiReady)
  assert.equal(
    (await req('categorize', 'POST', { ids: [rows[1].id] })).status,
    503,
  );
console.log(
  'PASS: sign-in, generic account lifecycle, CSV import, repeat import, legitimate duplicates, protected history, rejected invalid rows and currency, unauthenticated and cross-origin requests.',
);
console.log('QA account ID: ' + accountId);
