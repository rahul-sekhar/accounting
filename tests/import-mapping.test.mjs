import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MappingSuggestionGate,
  assessDirectionEvidence,
  selectRepresentativeRows,
} from '../lib/import-mapping.ts';
import { mapTransactions, parseCsv, suggestMapping } from '../lib/banking.ts';

test('signed normal and reverse suggestions drive the reviewed preview amounts', () => {
  const csv = parseCsv(
    'Date,Description,Amount\n2026-08-01,Purchase,12.34\n2026-08-02,Refund,-3.00',
  );
  const normal = suggestMapping(csv.headers);
  const mockedAiMapping = { ...normal, sign: 'reverse' };
  assert.deepEqual(
    mapTransactions(csv, normal).transactions.map((row) => row.amount),
    [1234, -300],
  );
  assert.deepEqual(
    mapTransactions(csv, mockedAiMapping).transactions.map((row) => row.amount),
    [-1234, 300],
  );
});

test('split layouts preserve debit/credit meaning for signed cells', () => {
  const csv = parseCsv(
    [
      'Date,Description,Debit,Credit',
      '2026-08-01,Debit positive,12.34,',
      '2026-08-02,Credit positive,,12.34',
      '2026-08-03,Debit negative,-12.34,',
      '2026-08-04,Credit negative,,-12.34',
      '2026-08-05,Both populated,12.34,2.34',
    ].join('\n'),
  );
  const normal = suggestMapping(csv.headers);
  assert.deepEqual(
    mapTransactions(csv, normal).transactions.map((row) => row.amount),
    [-1234, 1234, -1234, 1234, -1000],
  );
  assert.deepEqual(
    mapTransactions(csv, { ...normal, sign: 'reverse' }).transactions.map(
      (row) => row.amount,
    ),
    [1234, -1234, 1234, -1234, 1000],
  );
});

test('both blank split cells are invalid and reverse zero is canonical', () => {
  const blank = parseCsv('Date,Description,Debit,Credit\n2026-08-01,Missing,,');
  assert.equal(
    mapTransactions(blank, suggestMapping(blank.headers)).errors.length,
    1,
  );

  const zero = parseCsv('Date,Description,Amount\n2026-08-01,Zero,0.00');
  const result = mapTransactions(zero, {
    ...suggestMapping(zero.headers),
    sign: 'reverse',
  }).transactions[0].amount;
  assert.equal(result, 0);
  assert.equal(Object.is(result, -0), false);
});

test('representative sampling finds late sign and split variation within five rows', () => {
  const signed = parseCsv(
    [
      'Date,Description,Amount',
      ...Array.from(
        { length: 8 },
        (_, index) =>
          `2026-08-${String(index + 1).padStart(2, '0')},Charge ${index},12.34`,
      ),
      '2026-08-09,Refund,-3.00',
      '2026-08-10,Zero,0.00',
    ].join('\n'),
  );
  const sample = selectRepresentativeRows(signed);
  assert.ok(sample.some((row) => row[2] === '-3.00'));
  assert.ok(sample.some((row) => row[2] === '0.00'));
  assert.ok(sample.length <= 5);

  const split = parseCsv(
    'Date,Description,Debit,Credit\n2026-08-01,A,1,\n2026-08-02,B,,2\n2026-08-03,C,3,4\n2026-08-04,D,,',
  );
  assert.deepEqual(selectRepresentativeRows(split, 5), split.rows);
});

test('uniform unsigned evidence is uncertain while an explicit refund is useful', () => {
  const ambiguous = parseCsv(
    'Date,Description,Amount\n2026-08-01,Alpha,12.34\n2026-08-02,Beta,4.56',
  );
  assert.equal(
    assessDirectionEvidence(ambiguous, suggestMapping(ambiguous.headers))
      .uncertain,
    true,
  );
  const card = parseCsv(
    'Date,Description,Amount\n2026-08-01,Purchase,12.34\n2026-08-02,Refund,-3.00',
  );
  assert.equal(
    assessDirectionEvidence(card, suggestMapping(card.headers)).uncertain,
    false,
  );
});

test('file, account, and manual changes invalidate delayed suggestions', () => {
  const gate = new MappingSuggestionGate();
  const oldFile = gate.begin();
  gate.invalidate();
  assert.equal(gate.accepts(oldFile), false);

  const oldAccount = gate.begin();
  gate.invalidate();
  assert.equal(gate.accepts(oldAccount), false);

  const beforeManualEdit = gate.begin();
  gate.invalidate();
  assert.equal(gate.accepts(beforeManualEdit), false);
  assert.equal(gate.accepts(gate.begin()), true);
});
