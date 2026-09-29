import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const base = 'http://localhost:3000';
async function req(path, method = 'GET', payload) {
  const started = performance.now();
  const response = await fetch(`${base}/api/${path}`, {
    method,
    headers: payload
      ? { 'Content-Type': 'application/json', Origin: base }
      : undefined,
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const data = await response.json();
  return {
    status: response.status,
    data,
    latencyMs: Math.round(performance.now() - started),
  };
}
async function review(transaction, category, learn) {
  return req('category', 'PATCH', {
    id: transaction.id,
    category,
    action: transaction.category === category ? 'confirm' : 'correct',
    learn,
    operationId: crypto.randomUUID(),
    expectedRevision: transaction.category_revision,
  });
}
async function categorize(transaction) {
  const result = await req('categorize', 'POST', { ids: [transaction.id] });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const data = (await req('data')).data;
  return {
    result,
    transaction: data.transactions.find((item) => item.id === transaction.id),
  };
}

let data = (await req('data')).data;
let business = data.categories.find(
  (category) => category.name === 'QA Business expenses',
);
if (!business) {
  const created = await req('categories', 'POST', {
    name: 'QA Business expenses',
    kind: 'expense',
    archived: false,
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  business = created.data.categories.find(
    (category) => category.name === 'QA Business expenses',
  );
}
const runTag = crypto.randomUUID().slice(0, 8).toUpperCase();
const cafeDescription = `QA ${runTag} CORNER CAFE`;
const amazonDescription = `QA ${runTag} AMAZON`;
const csv = [
  'Date,Description,Memo,Amount',
  `2026-01-01,${cafeDescription},CLIENT MEETING,-18.50`,
  `2026-01-02,${cafeDescription},CLIENT MEETING,-18.50`,
  `2026-01-03,${cafeDescription},CLIENT MEETING,-18.50`,
  `2026-01-04,${amazonDescription},,-34.99`,
  `2026-01-05,${amazonDescription},,-42.99`,
  `2026-01-06,${amazonDescription},,-39.99`,
].join('\n');
const imported = await req('import', 'POST', {
  csv,
  filename: `review-memory-eval-${crypto.randomUUID()}.csv`,
  mapping: {
    date: 'Date',
    description: 'Description',
    subDescription: 'Memo',
    amount: 'Amount',
    debit: '',
    credit: '',
    mode: 'signed',
    sign: 'normal',
    dateFormat: 'YMD',
  },
  account: {
    bank: 'Scotiabank',
    name: 'QA review memory evaluation',
    type: 'Credit card',
    currency: 'CAD',
  },
});
assert.equal(imported.status, 200, JSON.stringify(imported.data));
data = (await req('data')).data;
const rows = data.transactions.filter(
  (item) => item.account_id === imported.data.accountId,
);
const cafes = rows
  .filter((item) => item.description === cafeDescription)
  .sort((a, b) => a.date.localeCompare(b.date));
const amazons = rows
  .filter((item) => item.description === amazonDescription)
  .sort((a, b) => a.date.localeCompare(b.date));

assert.equal((await review(cafes[0], 'Education', false)).status, 200);
const withoutMemory = await categorize(cafes[1]);
data = (await req('data')).data;
const cafeTraining = data.transactions.find((item) => item.id === cafes[0].id);
assert.equal(
  (
    await req('category', 'PATCH', {
      id: cafeTraining.id,
      category: 'Education',
      action: 'memory_enable',
      learn: true,
      operationId: crypto.randomUUID(),
      expectedRevision: cafeTraining.category_revision,
    })
  ).status,
  200,
);
const withMemory = await categorize(cafes[2]);

assert.equal((await review(amazons[0], business.id, true)).status, 200);
assert.equal((await review(amazons[1], 'Shopping', true)).status, 200);
const conflict = await categorize(amazons[2]);

console.log(
  JSON.stringify(
    {
      withoutMemory: {
        category: withoutMemory.transaction.category,
        confidence: withoutMemory.transaction.confidence,
        inputTokens: withoutMemory.result.data.usage?.inputTokens,
        latencyMs: withoutMemory.result.latencyMs,
      },
      withMemory: {
        category: withMemory.transaction.category,
        confidence: withMemory.transaction.confidence,
        cited: JSON.parse(
          withMemory.transaction.categorization_evidence || '[]',
        ).length,
        inputTokens: withMemory.result.data.usage?.inputTokens,
        latencyMs: withMemory.result.latencyMs,
      },
      conflict: {
        category: conflict.transaction.category,
        confidence: conflict.transaction.confidence,
        cited: JSON.parse(conflict.transaction.categorization_evidence || '[]')
          .length,
        inputTokens: conflict.result.data.usage?.inputTokens,
        latencyMs: conflict.result.latencyMs,
      },
    },
    null,
    2,
  ),
);
