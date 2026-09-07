# Plan 5 completion — selection and bulk deletion

Implemented stable transaction selection across local pagination and owner-scoped, receipt-backed bulk deletion.

## Delivered contracts

- Every transaction row has an accessible checkbox. The header checkbox selects or clears the current 25-row page and exposes checked/indeterminate state. Selection persists through page navigation.
- “Select all N matching transactions” captures the complete filtered ID set at that moment. Newly matching rows are not added. Any filter or currency edit clears selection with a notice; refresh intersects selection with live rows still in the current filter and reports removals.
- The shared bulk toolbar shows selected count, clear/delete actions, committed progress, unavailable count, stop-before-next-batch, failure details, and retry of only unfinished IDs. Filters, imports, row review edits, selection edits, and competing mutations are disabled during a running delete; pagination remains usable.
- Deletion confirmation states the exact captured count and that accounts/import history remain. Client orchestration processes all captured IDs sequentially in conservative batches of at most 50 without truncation. An unresolved request retains the same operation ID and payload for receipt recovery.
- `POST /api/transactions/delete` accepts `{operationId,ids}` and returns `{operationId,deletedIds,unavailableIds,replayed}`. UUIDs, nonempty unique string IDs, and the 50-ID request limit are validated. Canonical hashing sorts the explicit IDs.
- Receipts are scoped by authenticated owner and `kind='delete'`. Same operation and payload replays the exact result; different payload reuse returns `409` with `code: "operation_conflict"`.
- Unknown, deleted, and other-owner IDs are all returned as unavailable. The endpoint queries and mutates only current owner rows and never distinguishes why an ID is unavailable.
- Receipt insertion, active `transaction_reviews` deletion, live transaction deletion, and one owner context-revision increment execute in one D1 batch. The context changes only when that batch actually deletes at least one live transaction.
- Immutable `transaction_review_events`, retained `import_row_outcomes`, import aggregates, accounts, and historical receipts remain. Import reports already label their missing live references as unavailable.
- Review-event replay now checks that its owner-scoped transaction still exists and returns 404 after deletion. Review-memory loading defensively joins live owner-scoped transactions, preventing stale projections from reaching prompts.
- Deleting a transaction removes its live fingerprint. A deliberate later import can add the same row with a new transaction ID; historical events are not moved or backfilled onto that replacement.

No migration was required. Plan 3's durable `operation_receipts` table accepts the new delete kind, and retained outcome/event schemas already deliberately avoid cascading transaction foreign keys.

## Verification

- `node --experimental-strip-types --test tests/banking.test.mjs tests/review-memory.test.mjs tests/transaction-filters.test.mjs tests/transaction-selection.test.mjs tests/transaction-deletion.test.mjs tests/import-outcomes.test.mjs tests/accounts.test.mjs tests/account-migration.test.mjs tests/import-mapping.test.mjs` — 45 passed.
- Selection coverage includes 80 matching rows across pages, off-page deselection for an exact 79-row capture, page-only selection, refresh intersection, immutable select-all capture, 50/50/21 batching, and a later-batch failure that preserves committed progress and retries only the remaining 30 IDs.
- `node tests/api-smoke.mjs` — passed against local D1. It covers empty/oversized input, missing and second-owner IDs as indistinguishable unavailable results, exact receipt replay and conflict, owner isolation, one context increment, active-review removal, immutable event/outcome retention, review→delete→old-operation replay returning 404, and re-import with a new unreviewed transaction ID.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `npm run build` — passed and includes `/api/transactions/delete`.
- `git diff --check` — passed.

The implementation reuses the existing complete owner-scoped client transaction dataset, so “select all matching” captures explicit IDs after all filters and before pagination without adding an ID-resolution endpoint. Browser interaction QA was not requested; the compiled local preview was opened without claiming visual or interaction testing.
