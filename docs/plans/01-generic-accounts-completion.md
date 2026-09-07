# Plan 1 completion — Generic accounts and no balances

Completed: 2026-09-06.

## Delivered behavior

- Accounts accept trimmed, free-text institution and nickname values (1–80 characters, Unicode preserved), while retaining the existing account types and CAD/USD currencies.
- `POST /api/account` creates an account. `PATCH /api/account` supports `update`, `archive`, and `restore`. `DELETE /api/account` deletes only unused accounts. Successful mutations return the authoritative `{account}` record; delete returns `{deleted:true}`.
- Missing and unowned account IDs return the same 404 response. Type/currency updates and deletion use owner-scoped, write-time history guards across transactions, imports, transaction reviews, and review events. Populated accounts can still be renamed or moved between institutions.
- Archived accounts remain in dashboard history and filters, carry an archived label, and are removed from import choices. The import endpoint rejects archived accounts and repeats its active-account/currency guard inside the committing D1 batch.
- Account creation/editing is available outside the import dialog and remains available with zero accounts. The same account fields are reused when an import creates an account.
- Balance fields, balance editing, balance summaries, bank-specific presentation, and public documentation claims were removed. Income and spending are labeled as transaction flow.
- Legacy balance request fields are rejected explicitly.

## Migration

`drizzle/0003_daily_the_fury.sql` adds `accounts.archived` as non-null false, then removes `balance` and `balance_date` with SQLite `DROP COLUMN`. Applied migrations and snapshots were not rewritten.

The populated in-memory upgrade fixture applies migrations 0000–0003 with foreign keys enabled. It verifies account, transaction, import, category, review, and review-event rows; all existing named indexes; no balance columns; the active default; and a clean `PRAGMA foreign_key_check`.

## Verification

- `node --experimental-strip-types --test tests/accounts.test.mjs tests/account-migration.test.mjs tests/banking.test.mjs tests/review-memory.test.mjs` — 22 passed.
- `BASE_URL=http://localhost:3001 node tests/api-smoke.mjs` — passed against the migrated disposable local D1 database. It covers arbitrary/Unicode institutions, unused edit/delete, populated rename, protected type change/delete, idempotent archive/restore, archived import rejection, transaction ownership retention, stale balance rejection, and existing import/auth cases.
- The account service test uses two real synthetic owners and proves another owner cannot update, archive, or delete the first owner’s account.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed. Generated catalog UI and its generated mobile hook are excluded from project linting; application, API, library, and test source remains covered.
- `npm run build` — passed and included migration 0003 in `dist/.openai/drizzle`.
- The app route compiled and returned the expected sign-in redirect; the authenticated API flow returned successfully. Browser interaction/visual QA was not requested and was not performed.

## Handoff for Plans 2–4

- `accounts.bank` remains the free-text institution column for compatibility.
- `accounts.archived` is the authoritative active/importable flag. Existing account import commits require matching owner, `archived=0`, and the previously read currency.
- Account IDs and transaction ownership remain unchanged. Archived accounts stay present in `/api/data` and historical filters.
- Plan 3 must extend the account history guard when it adds retained import-outcome/receipt history, as required by the shared contract.
