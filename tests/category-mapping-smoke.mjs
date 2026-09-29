import assert from 'node:assert/strict';
const base = 'http://localhost:3000';
async function req(path, method = 'GET', payload, auth = true) {
  const r = await fetch(base + '/api/' + path, {
    method,
    headers: {
      ...(!auth ? { 'X-Account-View-Local-Auth': 'disabled' } : {}),
      ...(payload ? { 'Content-Type': 'application/json', Origin: base } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
assert.equal((await req('map-csv', 'POST', {}, false)).status, 401);
assert.equal((await req('categories', 'POST', {}, false)).status, 401);
const headers = [
  'Posted',
  'Payee',
  'Additional memo',
  'Debit CAD',
  'Credit CAD',
];
const sample = [
  ['2026-08-02', 'CARD PURCHASE', 'VETERINARY CLINIC PET CHECKUP', '85.00', ''],
  ['2026-08-03', 'PAYROLL', 'EMPLOYER DEPOSIT', '', '2000.00'],
];
const ai = await req('map-csv', 'POST', {
  headers,
  rows: sample,
  bank: 'Scotiabank',
  accountType: 'Chequing',
});
console.log('AI mapping:', JSON.stringify(ai.data));
assert.equal(ai.status, 200, JSON.stringify(ai));
assert.equal(ai.data.mapping.date, 'Posted');
assert.equal(ai.data.mapping.description, 'Payee');
assert.equal(ai.data.mapping.subDescription, 'Additional memo');
assert.equal(ai.data.mapping.mode, 'split');
assert.equal(ai.data.mapping.debit, 'Debit CAD');
assert.equal(ai.data.mapping.credit, 'Credit CAD');
assert.equal(ai.data.mapping.sign, 'normal');
const created = await req('categories', 'POST', {
  name: 'QA Veterinary care and pet supplies',
  kind: 'expense',
  archived: false,
});
assert.equal(created.status, 200);
const custom = created.data.categories.find(
  (c) => c.name === 'QA Veterinary care and pet supplies',
);
console.log('QA category ID: ' + custom.id);
assert.equal(
  (
    await req('categories', 'POST', {
      name: 'qa veterinary care and pet supplies',
      kind: 'expense',
      archived: false,
    })
  ).status,
  400,
);
assert.equal(
  (
    await req('categories', 'PATCH', {
      id: 'Uncategorized',
      name: 'Changed',
      kind: 'expense',
      archived: true,
    })
  ).status,
  400,
);
assert.equal(
  (
    await req('categories', 'PATCH', {
      id: 'other-user-category',
      name: 'Changed',
      kind: 'expense',
      archived: false,
    })
  ).status,
  404,
);
const csv = [headers.join(','), ...sample.map((r) => r.join(','))].join('\n');
const payload = {
  csv,
  filename: 'qa-category-map.csv',
  mapping: { ...ai.data.mapping, subDescription: '' },
  account: {
    bank: 'Scotiabank',
    name: 'QA mapping disposable account',
    type: 'Chequing',
    currency: 'CAD',
  },
};
const imported = await req('import', 'POST', payload);
assert.equal(imported.status, 200, JSON.stringify(imported));
console.log('QA account ID: ' + imported.data.accountId);
assert.equal(imported.data.added, 2);
const enriched = await req('import', 'POST', {
  ...payload,
  accountId: imported.data.accountId,
  mapping: ai.data.mapping,
});
assert.equal(enriched.data.added, 0);
assert.equal(enriched.data.skipped, 2);
let data = (await req('data')).data;
let rows = data.transactions.filter(
  (t) => t.account_id === imported.data.accountId,
);
assert.equal(
  rows.find((t) => t.description === 'CARD PURCHASE').sub_description,
  'VETERINARY CLINIC PET CHECKUP',
);
const classified = await req('categorize', 'POST', {
  ids: rows.map((t) => t.id),
});
assert.equal(classified.status, 200, JSON.stringify(classified));
data = (await req('data')).data;
rows = data.transactions.filter(
  (t) => t.account_id === imported.data.accountId,
);
assert.equal(
  rows.find((t) => t.description === 'CARD PURCHASE').category,
  custom.id,
);
const pet = rows.find((t) => t.category === custom.id);
const renamed = await req('categories', 'PATCH', {
  ...custom,
  name: 'QA Pet care renamed',
});
assert.equal(renamed.status, 200);
data = (await req('data')).data;
assert.equal(
  data.categories.find((c) => c.id === custom.id).name,
  'QA Pet care renamed',
);
assert.equal(
  data.transactions.find((t) => t.id === pet.id).category,
  custom.id,
);
assert.equal(
  (
    await req('categories', 'PATCH', {
      ...custom,
      name: 'QA Pet care renamed',
      archived: true,
    })
  ).status,
  200,
);
assert.equal(
  (
    await req('category', 'PATCH', {
      id: pet.id,
      category: custom.id,
      action: 'confirm',
      learn: true,
      operationId: crypto.randomUUID(),
      expectedRevision: pet.category_revision,
    })
  ).status,
  200,
);
data = (await req('data')).data;
assert.equal(
  data.transactions.find((t) => t.id === pet.id).category,
  custom.id,
);
assert.equal(
  (
    await req('categories', 'PATCH', {
      ...custom,
      name: 'QA Pet care renamed',
      archived: false,
    })
  ).status,
  200,
);
assert.equal(
  (
    await req('category', 'PATCH', {
      id: pet.id,
      category: custom.id,
      action: 'confirm',
      learn: true,
      operationId: crypto.randomUUID(),
      expectedRevision: data.transactions.find((t) => t.id === pet.id)
        .category_revision,
    })
  ).status,
  200,
);
console.log(
  'PASS: AI maps split columns and memo, re-import enriches legacy rows without duplicates, AI uses sub-description and custom category, category rename/archive/restore preserve history, invalid writes rejected.',
);
