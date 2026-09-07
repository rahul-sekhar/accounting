import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  AccountStoreError,
  deleteAccount,
  setAccountArchived,
  updateAccount,
} from '../lib/accounts-server.ts';

const root = new URL('../', import.meta.url);
const migration = (name) =>
  readFileSync(new URL(`drizzle/${name}`, root), 'utf8').replaceAll(
    '--> statement-breakpoint',
    '',
  );

function d1(database) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) {
          values = next;
          return this;
        },
        async first() {
          return database.prepare(sql).get(...values);
        },
        async run() {
          const result = database.prepare(sql).run(...values);
          return { meta: { changes: result.changes } };
        },
      };
    },
  };
}

function migratedDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const name of [
    '0000_awesome_leper_queen.sql',
    '0001_foamy_zzzax.sql',
    '0002_robust_shooting_star.sql',
    '0003_daily_the_fury.sql',
    '0004_import_outcomes.sql',
  ])
    database.exec(migration(name));
  return database;
}

test('populated migration removes balances without losing history or indexes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(migration('0000_awesome_leper_queen.sql'));
  db.exec(migration('0001_foamy_zzzax.sql'));
  db.exec(migration('0002_robust_shooting_star.sql'));
  db.exec(`
    INSERT INTO accounts VALUES ('a1','u1','Legacy Bank','Main','Chequing','CAD',12345,'2026-08-31','2026-01-01');
    INSERT INTO imports VALUES ('i1','u1','a1','fixture.csv',1,0,'2026-01-02');
    INSERT INTO transactions (id,user_id,account_id,date,description,sub_description,amount,fingerprint,import_id,category,source,confidence,category_revision,categorization_evidence,created_at)
      VALUES ('t1','u1','a1','2026-01-02','Fixture','Memo',-100,'f1','i1','Other','manual',NULL,1,NULL,'2026-01-02');
    INSERT INTO category_definitions VALUES ('u1','Other','Other','expense',0);
    INSERT INTO transaction_reviews VALUES ('u1','t1','op1','Other',1,1,'2026-01-03','Fixture','Memo',-100,'CAD','a1','Chequing','manual');
    INSERT INTO transaction_review_events VALUES ('op1','u1','t1','confirm',NULL,'Other','none',NULL,NULL,1,'Fixture','Memo',-100,'CAD','a1','Chequing','2026-01-03','2026-01-03',1,'manual','hash');
  `);

  db.exec(migration('0003_daily_the_fury.sql'));

  const columns = db
    .prepare('PRAGMA table_info(accounts)')
    .all()
    .map((row) => row.name);
  assert.equal(columns.includes('balance'), false);
  assert.equal(columns.includes('balance_date'), false);
  assert.equal(columns.includes('archived'), true);
  assert.equal(
    db.prepare('SELECT archived FROM accounts WHERE id=?').get('a1').archived,
    0,
  );
  for (const table of [
    'accounts',
    'imports',
    'transactions',
    'category_definitions',
    'transaction_reviews',
    'transaction_review_events',
  ])
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      1,
    );
  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL",
    )
    .all()
    .map((row) => row.name);
  for (const name of [
    'accounts_owner',
    'imports_owner',
    'transactions_dedupe',
    'transactions_owner_date',
    'transaction_reviews_owner_memory',
    'review_events_owner_transaction',
  ])
    assert.equal(indexes.includes(name), true, `${name} was preserved`);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('account mutations are owner-scoped and protect populated history', async () => {
  const database = migratedDatabase();
  database.exec(`
    INSERT INTO accounts (id,user_id,bank,name,type,currency,archived,created_at)
      VALUES ('a1','owner-1','Generic Bank','Main','Chequing','CAD',0,'2026-01-01'),
             ('a2','owner-2','Other Bank','Private','Savings','USD',0,'2026-01-01'),
             ('a3','owner-1','Unused Bank','Spare','Savings','CAD',0,'2026-01-01');
    INSERT INTO imports (id,user_id,account_id,filename,added,skipped,created_at)
      VALUES ('i1','owner-1','a1','fixture.csv',0,0,'2026-01-02');
  `);
  const databaseApi = d1(database);
  const input = {
    bank: 'Changed Bank',
    name: 'Changed',
    type: 'Investment',
    currency: 'CAD',
  };

  await assert.rejects(
    updateAccount(databaseApi, 'owner-1', 'a2', input),
    (error) => error instanceof AccountStoreError && error.status === 404,
  );
  await assert.rejects(
    setAccountArchived(databaseApi, 'owner-1', 'a2', true),
    (error) => error instanceof AccountStoreError && error.status === 404,
  );
  await assert.rejects(
    deleteAccount(databaseApi, 'owner-1', 'a2'),
    (error) => error instanceof AccountStoreError && error.status === 404,
  );
  const untouched = database
    .prepare('SELECT name,archived FROM accounts WHERE id=?')
    .get('a2');
  assert.equal(untouched.name, 'Private');
  assert.equal(untouched.archived, 0);

  await assert.rejects(
    updateAccount(databaseApi, 'owner-1', 'a1', input),
    (error) => error instanceof AccountStoreError && error.status === 409,
  );
  await assert.rejects(
    deleteAccount(databaseApi, 'owner-1', 'a1'),
    (error) => error instanceof AccountStoreError && error.status === 409,
  );
  const renamed = await updateAccount(databaseApi, 'owner-1', 'a1', {
    bank: 'Generic Credit Union',
    name: 'Main renamed',
    type: 'Chequing',
    currency: 'CAD',
  });
  assert.equal(renamed.name, 'Main renamed');
  await deleteAccount(databaseApi, 'owner-1', 'a3');
  assert.equal(
    database.prepare('SELECT 1 FROM accounts WHERE id=?').get('a3'),
    undefined,
  );
});
