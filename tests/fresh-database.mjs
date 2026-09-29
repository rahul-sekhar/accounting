import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const stateDirectory = mkdtempSync(join(tmpdir(), 'account-view-d1-'));
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const common = [
  'account-view',
  '--local',
  '--persist-to',
  stateDirectory,
  '--config',
  join(root, 'wrangler.jsonc'),
];

function run(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: 'true',
      NO_COLOR: '1',
      WRANGLER_LOG_PATH: join(stateDirectory, 'wrangler.log'),
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `Wrangler failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

try {
  run(['d1', 'migrations', 'apply', ...common]);
  const pending = run(['d1', 'migrations', 'list', ...common]);
  assert.match(pending, /No migrations to apply/);

  const query = [
    "SELECT 'table' AS kind, name AS value FROM sqlite_master WHERE type = 'table'",
    "SELECT 'index' AS kind, name AS value FROM sqlite_master WHERE type = 'index'",
    "SELECT 'migration-count' AS kind, CAST(COUNT(*) AS TEXT) AS value FROM d1_migrations",
    "SELECT 'transaction-fk' AS kind, `table` AS value FROM pragma_foreign_key_list('transactions')",
    "SELECT 'import-fk' AS kind, `table` AS value FROM pragma_foreign_key_list('imports')",
    "SELECT 'outcome-fk' AS kind, `table` AS value FROM pragma_foreign_key_list('import_row_outcomes')",
  ].join('; ');
  const output = run([
    'd1',
    'execute',
    ...common,
    '--command',
    query,
    '--json',
  ]);
  const rows = JSON.parse(output).flatMap((result) => result.results);
  const values = (kind) =>
    new Set(rows.filter((row) => row.kind === kind).map((row) => row.value));

  assert.deepEqual(values('table'), new Set([
    '_cf_METADATA',
    'accounts',
    'categorization_contexts',
    'category_definitions',
    'd1_migrations',
    'import_row_outcomes',
    'imports',
    'operation_receipts',
    'sqlite_sequence',
    'sqlite_stat1',
    'transaction_review_events',
    'transaction_reviews',
    'transactions',
  ]));
  for (const index of [
    'accounts_owner',
    'imports_owner',
    'transactions_dedupe',
    'transactions_owner_date',
    'review_events_owner_transaction',
    'transaction_reviews_owner_memory',
    'import_outcomes_owner_import_outcome',
    'import_outcomes_owner_account',
    'operation_receipts_owner_committed',
  ]) {
    assert.ok(values('index').has(index), `missing index ${index}`);
  }
  assert.deepEqual(values('migration-count'), new Set(['6']));
  assert.deepEqual(values('transaction-fk'), new Set(['accounts']));
  assert.deepEqual(values('import-fk'), new Set(['accounts']));
  assert.deepEqual(values('outcome-fk'), new Set(['imports']));
  console.log('PASS: fresh local D1 applied all migrations and matches the expected schema.');
} finally {
  rmSync(stateDirectory, { recursive: true, force: true });
}
