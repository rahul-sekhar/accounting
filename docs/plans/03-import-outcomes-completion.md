# Plan 3 completion — import outcomes and duplicates

Implemented persistent, owner-scoped import reports and a reloadable post-import results surface.

## Delivered contracts

- `POST /api/import` now requires a UUID `operationId` and returns `{importId,accountId,added,skipped,enriched,total,currency,replayed}`. The canonical request hash covers the exact CSV, normalized mapping, filename, and selected account or normalized new-account fields.
- Reusing an operation ID with the same semantic request replays its committed result. Reusing it with different input returns `409` with `code: "operation_conflict"`.
- `GET /api/imports?accountId=&cursor=&limit=` returns owner-scoped history ordered by `(created_at DESC,id DESC)`, with a maximum page size of 100.
- `GET /api/imports/:id?outcome=&cursor=&limit=` returns report metadata, paged row outcomes, `detailsAvailable`, and a nullable `current_transaction_id`. `outcome=duplicate` includes skipped and enriched matches.
- New row statuses are `added`, `duplicate_skipped`, and `duplicate_enriched`. `skipped` includes both duplicate statuses; `enriched` is its explicit subset. `total = added + skipped`.
- `/api/data` now includes each transaction's immutable `import_id` for Plan 4.

Migration `drizzle/0004_import_outcomes.sql` adds nullable `imports.report_version`, non-null `imports.enriched`, `import_row_outcomes`, and shared `operation_receipts`. Legacy imports retain `report_version = null`; new imports write version 1 even when no duplicates exist. Outcome transaction IDs are historical strings rather than cascading foreign keys, so reports survive later transaction deletion. The account history guard now includes retained outcomes.

Import classification, transaction insert/enrichment, aggregate update, and receipt insertion execute in one D1 batch. Outcome rows are classified from database state inside that transaction. Enrichment only fills an empty sub-description, increments `category_revision`, and does not modify review snapshots, category, source, confidence, or original `transactions.import_id`.

The dashboard now navigates successful saves to `/?view=import&importId=<id>`. The dedicated result surface shows file/account/time metadata, totals, duplicate actions, incoming details, missing-current-transaction state, pagination, legacy fallback, no-duplicate state, and a transaction-view link. Import history is pageable beyond the former recent-20 boundary.

## Verification

- `node --experimental-strip-types --test tests/banking.test.mjs tests/accounts.test.mjs tests/account-migration.test.mjs tests/import-mapping.test.mjs tests/import-outcomes.test.mjs tests/review-memory.test.mjs` — 33 passed after updating the account fixture for migration 0004.
- `node tests/api-smoke.mjs` — passed against migrated disposable local D1. It verifies same-operation replay/conflict, paged reports/history, exact duplicate skipping, missing-detail enrichment and non-overwrite, preservation of a manual review with revision increment, concurrent overlapping imports (exactly one adds), distinct-operation reports, and the 2,000-row add/re-import boundary, plus prior auth/account/direction regressions.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; routes include `/api/imports` and `/api/imports/:id`, and migration 0004 is packaged.
- The populated migration test applies migrations 0000–0004 with foreign keys enabled, confirms legacy report fallback values, deletes a referenced transaction while retaining its outcome, and finishes with a clean `PRAGMA foreign_key_check`.

Two-owner production-auth simulation remains unavailable in the local Sites sign-in harness, which fixes a single development identity and strips spoofed identity headers. All new list/detail/read/write SQL predicates include the authenticated `user_id`, singular unowned lookups return the same 404 as missing IDs, and operation receipt identity is part of its composite primary key; this limitation is not represented as a completed two-owner runtime test.
