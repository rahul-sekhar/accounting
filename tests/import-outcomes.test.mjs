import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importListCursor,
  importRequestKey,
  pageLimit,
  parseImportListCursor,
  sha256,
  transactionFingerprint,
  validOperationId,
} from '../lib/imports.ts';
import { mapTransactions, parseCsv, suggestMapping } from '../lib/banking.ts';

test('import request hashing includes exact CSV and normalized semantic input', async () => {
  const mapping = suggestMapping(['Date', 'Description', 'Amount']);
  const base = {
    csv: 'Date,Description,Amount\n2026-01-01,Coffee,-4.25',
    filename: 'one.csv',
    mapping,
    accountId: 'account-1',
  };
  const hash = await sha256(importRequestKey(base));
  assert.equal(hash, await sha256(importRequestKey({ ...base, mapping: { ...mapping, subDescription: '' } })));
  assert.notEqual(hash, await sha256(importRequestKey({ ...base, csv: `${base.csv}\n` })));
  assert.notEqual(hash, await sha256(importRequestKey({ ...base, accountId: 'account-2' })));
});

test('fingerprints preserve exact-match occurrence semantics', async () => {
  const common = { date: '2026-01-01', description: 'Coffee   Shop', amount: -425 };
  assert.equal(
    await transactionFingerprint({ ...common, occurrence: 1 }),
    await transactionFingerprint({ ...common, description: 'coffee shop', occurrence: 1 }),
  );
  assert.notEqual(
    await transactionFingerprint({ ...common, occurrence: 1 }),
    await transactionFingerprint({ ...common, occurrence: 2 }),
  );
});

test('report cursors and limits reject malformed values', () => {
  const encoded = importListCursor('2026-09-06T12:00:00.000Z', 'import-1');
  assert.deepEqual(parseImportListCursor(encoded), {
    createdAt: '2026-09-06T12:00:00.000Z',
    id: 'import-1',
  });
  assert.equal(parseImportListCursor('bad'), undefined);
  assert.equal(pageLimit(null), 50);
  assert.equal(pageLimit('100'), 100);
  assert.equal(pageLimit('101'), null);
  assert.equal(validOperationId('ca1a0868-7884-4c7b-b1d3-ff4bb02fe7dd'), true);
  assert.equal(validOperationId('retry-me'), false);
});

test('2,000 parsed data rows have stable one-based ordinals despite multiline cells', () => {
  const lines = ['Date,Description,Amount', '2026-01-01,"First\nrow",-1.00'];
  for (let index = 2; index <= 2000; index++)
    lines.push(`2026-01-01,Row ${index},-${index}.00`);
  const csv = parseCsv(lines.join('\n'));
  const mapped = mapTransactions(csv, suggestMapping(csv.headers));
  assert.equal(mapped.errors.length, 0);
  assert.equal(mapped.transactions.length, 2000);
  assert.equal(mapped.transactions[0].description, 'First\nrow');
  assert.equal(mapped.transactions.at(-1).description, 'Row 2000');
});

test('Plan 3 migration upgrades populated data and outcomes survive transaction deletion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'accountview-plan3-'));
  const database = join(directory, 'test.sqlite');
  for (let index = 0; index <= 3; index++) {
    const migration = readFileSync(
      join(process.cwd(), 'drizzle', `${String(index).padStart(4, '0')}_${['awesome_leper_queen', 'foamy_zzzax', 'robust_shooting_star', 'daily_the_fury'][index]}.sql`),
      'utf8',
    );
    execFileSync('sqlite3', [database], { input: migration });
  }
  execFileSync('sqlite3', [database], {
    input: `PRAGMA foreign_keys=ON;
      INSERT INTO accounts (id,user_id,bank,name,type,currency,archived,created_at) VALUES ('a','u','Test','Everyday','Chequing','CAD',0,'2026-01-01T00:00:00Z');
      INSERT INTO imports (id,user_id,account_id,filename,added,skipped,created_at) VALUES ('i','u','a','old.csv',1,0,'2026-01-01T00:00:00Z');
      INSERT INTO transactions (id,user_id,account_id,date,description,sub_description,amount,fingerprint,import_id,category,source,category_revision,created_at) VALUES ('t','u','a','2026-01-01','Coffee','',-425,'f','i','Uncategorized','none',0,'2026-01-01T00:00:00Z');`,
  });
  execFileSync('sqlite3', [database], {
    input: readFileSync(join(process.cwd(), 'drizzle/0004_import_outcomes.sql'), 'utf8'),
  });
  const legacy = execFileSync('sqlite3', [database, "SELECT enriched,report_version FROM imports WHERE id='i';"], { encoding: 'utf8' }).trim();
  assert.equal(legacy, '0|');
  execFileSync('sqlite3', [database], {
    input: `PRAGMA foreign_keys=ON;
      INSERT INTO import_row_outcomes (user_id,import_id,account_id,row_ordinal,occurrence,date,description,sub_description,amount,fingerprint,outcome,transaction_id,action_detail) VALUES ('u','i','a',1,1,'2026-01-01','Coffee','memo',-425,'f','duplicate_enriched','t','Filled the missing sub-description');
      DELETE FROM transactions WHERE id='t';`,
  });
  assert.equal(execFileSync('sqlite3', [database, 'SELECT COUNT(*) FROM import_row_outcomes;'], { encoding: 'utf8' }).trim(), '1');
  assert.equal(execFileSync('sqlite3', [database, 'PRAGMA foreign_key_check;'], { encoding: 'utf8' }).trim(), '');
});
