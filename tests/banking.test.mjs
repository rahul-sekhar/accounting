import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,
  mapTransactions,
  suggestMapping,
  parseMoney,
  parseDate,
  summary,
} from '../lib/banking.ts';
test('quoted commas, BOM, multiline descriptions and cents survive CSV parsing', () => {
  const c = parseCsv(
    '\uFEFFDate,Description,Amount\r\n2026-08-01,"SHOP, VANCOUVER",-12.35\r\n2026-08-02,"MULTI\nLINE",100.00',
  );
  const r = mapTransactions(c, suggestMapping(c.headers));
  assert.equal(r.errors.length, 0);
  assert.equal(r.transactions[0].description, 'SHOP, VANCOUVER');
  assert.equal(r.transactions[0].amount, -1235);
  assert.equal(r.transactions[1].description, 'MULTI\nLINE');
});
test('separate debit/credit columns and card reversal normalize sign', () => {
  const c = parseCsv(
    'Date,Description,Debit,Credit\n2026-08-01,Coffee,4.50,\n2026-08-02,Payroll,,2000.25',
  );
  assert.deepEqual(
    mapTransactions(c, suggestMapping(c.headers)).transactions.map(
      (t) => t.amount,
    ),
    [-450, 200025],
  );
  const m = { ...suggestMapping(c.headers), sign: 'reverse' };
  assert.deepEqual(
    mapTransactions(c, m).transactions.map((t) => t.amount),
    [450, -200025],
  );
});
test('identical legitimate transactions retain distinct occurrence numbers', () => {
  const c = parseCsv(
    'Date,Description,Amount\n2026-08-01,Bus,-3.25\n2026-08-01,Bus,-3.25',
  );
  assert.deepEqual(
    mapTransactions(c, suggestMapping(c.headers)).transactions.map(
      (t) => t.occurrence,
    ),
    [1, 2],
  );
});
test('headerless exports retain first transaction', () => {
  const c = parseCsv('2026-08-01,Shop,-10\n2026-08-02,Shop,-20');
  assert.equal(c.rows.length, 2);
  const m = {
    ...suggestMapping(c.headers),
    date: 'Column 1',
    description: 'Column 2',
    amount: 'Column 3',
  };
  assert.equal(mapTransactions(c, m).transactions[0].amount, -1000);
});
test('invalid dates, ambiguous formats and malformed money are rejected', () => {
  assert.equal(parseDate('2026-02-30', 'YMD'), null);
  assert.equal(parseDate('09/02/2026', 'YMD'), null);
  assert.equal(parseDate('09/02/2026', 'DMY'), '2026-02-09');
  assert.equal(parseMoney('1.234'), null);
  assert.equal(parseMoney('not money'), null);
  assert.equal(parseMoney('($1,234.50)'), -123450);
});
test('mismatched CSV rows and missing amounts block import', () => {
  const c = parseCsv(
    'Date,Description,Amount\n2026-08-01,Shop,\n2026-08-01,too,many,fields',
  );
  const r = mapTransactions(c, suggestMapping(c.headers));
  assert.equal(r.errors.length, 2);
  assert.equal(r.transactions.length, 0);
});
test('refunds reduce spending; transfers and investment trades do not inflate totals', () => {
  const t = (amount, category) => ({ amount, category });
  assert.deepEqual(
    summary([
      t(-10000, 'Shopping'),
      t(2000, 'Shopping'),
      t(300000, 'Income'),
      t(-100000, 'Transfers'),
      t(100000, 'Transfers'),
      t(-50000, 'Investments'),
    ]),
    { income: 300000, spending: 8000 },
  );
});

test('optional sub-description maps without becoming required', () => {
  const csv = parseCsv(
    'Date,Description,Memo,Amount\n2026-08-01,Card purchase,PET STORE,-12.50',
  );
  const m = suggestMapping(csv.headers);
  assert.equal(m.subDescription, 'Memo');
  assert.equal(
    mapTransactions(csv, m).transactions[0].subDescription,
    'PET STORE',
  );
  assert.equal(
    mapTransactions(csv, { ...m, subDescription: '' }).transactions[0]
      .subDescription,
    '',
  );
  assert.equal(
    mapTransactions(csv, { ...m, subDescription: 'Description' }).errors.length,
    1,
  );
});
test('custom category types determine totals independently of their names', () => {
  const categories = [
    { id: 'salary', name: 'Pay', kind: 'income', archived: false },
    { id: 'pets', name: 'Pets', kind: 'expense', archived: true },
    { id: 'moving', name: 'Own transfers', kind: 'transfer', archived: false },
  ];
  assert.deepEqual(
    summary(
      [
        { category: 'salary', amount: 100000 },
        { category: 'pets', amount: -2000 },
        { category: 'pets', amount: 500 },
        { category: 'moving', amount: 50000 },
      ],
      categories,
    ),
    { income: 100000, spending: 1500 },
  );
});
