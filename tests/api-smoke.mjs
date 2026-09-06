import assert from 'node:assert/strict';
const base = 'http://localhost:3000';
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
    body: data ? JSON.stringify(data) : undefined,
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
    bank: 'Scotiabank',
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
const changed = await req('category', 'PATCH', {
  id: rows[0].id,
  category: 'Transfers',
});
assert.equal(changed.status, 200);
assert.equal(
  (await req('category', 'PATCH', { id: rows[0].id, category: 'Invalid' }))
    .status,
  400,
);
assert.equal(
  (
    await req('category', 'PATCH', {
      id: 'someone-elses-id',
      category: 'Income',
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
  200,
);
all = await req('data');
assert.equal(all.data.accounts.find((a) => a.id === accountId).balance, 54321);
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
  'PASS: sign-in, CSV import, repeat import, legitimate duplicates, persisted edits and balances, rejected invalid rows and currency, unauthenticated and cross-origin requests.',
);
console.log('QA account ID: ' + accountId);
