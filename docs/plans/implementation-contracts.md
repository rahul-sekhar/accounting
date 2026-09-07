# Shared implementation contracts for Sol

These decisions supplement the six approved plans. Follow them unless actual repository/runtime constraints require an equivalent alternative; record such a deviation and its evidence. Do not silently change user-visible semantics.

## Recommended code boundaries

- Keep `app/dashboard.tsx` as the composing screen. Extract `app/account-manager.tsx`, `app/import-results.tsx`, and transaction filter/table/toolbar components when their owning plan is implemented. Do not rewrite unrelated category UI.
- Put pure filtering and selection helpers under `lib/transaction-filters.ts` and `lib/transaction-selection.ts`. Put operation receipt helpers under `lib/operations-server.ts`. File names may follow existing conventions; behavior and test seams matter more than exact names.
- Keep `/` authenticated through `app/page.tsx`. Use `/?view=import&importId=<id>` for a reloadable import results page within the existing dashboard; normal transaction view is `/?view=transactions`. No new framework/router is required. Render a dedicated page surface, not only a toast or modal.
- Keep database/API `bank` as the free-text institution field to avoid an unnecessary rename migration. Label it “Institution” in the UI. Keep shared API types in one place.

## Endpoint contracts

All endpoints retain current identity/origin validation. Bodies are JSON. Validate input types before reading properties. Error responses keep `{error: string}` and may add a stable `code`.

| Plan | Endpoint | Request and success response |
| --- | --- | --- |
| 01 | `POST /api/account` | `{bank,name,type,currency}` → `{account}` |
| 01 | `PATCH /api/account` | `{id,action:'update',bank,name,type,currency}` or `{id,action:'archive'\|'restore'}` → `{account}` |
| 01 | `DELETE /api/account` | `{id}` → `{deleted:true}`; populated account gives 409 |
| 03 | `POST /api/import` | Existing fields plus `operationId` → `{importId,accountId,added,skipped,enriched,total,replayed}` |
| 03 | `GET /api/imports` | Optional owner-scoped `accountId`, `cursor`, `limit` → `{items,nextCursor}` |
| 03 | `GET /api/imports/[id]` | Optional `outcome`, `cursor`, `limit` → `{import,outcomes,nextCursor,detailsAvailable}` |
| 05 | `POST /api/transactions/delete` | `{operationId,ids}` → `{operationId,deletedIds,unavailableIds,replayed}` |
| 06 | `POST /api/categorize` | `{operationId,ids}` → existing metadata plus `{operationId,categorizedIds,protectedIds,unavailableIds,replayed}`; retain numeric `categorized` for compatibility |

Use 400 for invalid inputs, 401 for anonymous access, and an indistinguishable 404 for missing/unowned singular resources. Bulk requests operate exclusively within the current owner: unknown, deleted, and unowned IDs are all `unavailableIds`, with no distinction or cross-owner lookup. Valid owned IDs may still be processed. This replaces the earlier ambiguous instruction to distinguish foreign IDs from missing IDs. A mixed request must never touch the other user's rows.

Use stable `(created_at DESC,id DESC)` import-list cursors and parsed row ordinal for outcome cursors. Default page size 50, maximum 100. Validate cursors; do not interpolate them into SQL. The import picker must load/search beyond the first page. Duplicate outcome filtering includes both skipped and enriched outcomes. Do not return every outcome of every import inside `/api/data`.

## Operation receipts and retry rules

Plan 3 introduces `operation_receipts`: owner ID, kind (`import`, later `delete`/`categorize`), operation ID, request hash, compact result JSON, and committed timestamp; composite primary key `(user_id,kind,operation_id)`. No global operation lookup. Completed receipts stay durable for this scope; do not silently expire them. Imports may instead use an equivalent unique operation receipt on their own table if the shared helper abstracts it cleanly.

- Generate a UUID once per import save or bulk batch. Save a local in-memory copy until that request is resolved. Retrying an ambiguous network response uses identical operation ID and payload.
- Hash canonical validated semantic input with SHA-256. Sort unique bulk IDs for hashing. For import, include exact CSV content, normalized mapping, filename, and selected account ID or new-account fields; hash CSV content without storing it. Do not store credentials, raw CSVs, prompts, or raw model responses in receipts.
- Look up a receipt before expensive work. Same key/hash returns the saved result with `replayed:true`; same key/different hash returns 409 `operation_conflict`.
- Insert the receipt in the **same atomic database batch** as its data mutations. A competing duplicate receipt insertion must abort/roll back the competing mutations; on uniqueness conflict, read the committed receipt and apply the same hash check. Never upsert a receipt in a way that permits both mutation batches to commit.
- A successful all-protected/all-unavailable batch also gets a receipt. Failed validation, provider failure, or a rolled-back data conflict has no success receipt.
- External AI inference cannot be made exactly once with a database receipt alone. Concurrent duplicate requests may incur duplicate inference, but at most one mutation batch may commit. Do not add a queue/lease system solely to promise exactly-once provider calls.
- On transport uncertainty, resend the same batch to recover its receipt. On an explicit 409 `stale_context`, refresh and let a deliberate retry use a new operation ID for the remaining eligible IDs. Never automatically retry `operation_conflict` with a new ID.
- Receipts describe past actions. Replaying a categorized/deleted/imported receipt does not restore rows or overwrite newer edits. Refresh current data separately.

## Atomicity and query size

The current categorize update repeats IDs through four CASE expressions and several predicates, so the 60-target API limit is not proof that the SQL fits the runtime's bind limit. Inspect the actual statement and verify parameter counts against the deployment's supported limits during implementation. Preserve atomicity when changing the SQL shape; splitting an all-or-nothing guarded update into independent unguarded writes is incorrect.

Implement a checked D1 batch strategy with a database-enforced precondition/guard for operations that must wholly succeed. A JavaScript exception after `db.batch()` has committed does **not** roll back earlier writes. Tests must prove rollback by reading persisted state after an induced failure. Use bounded staging/JSON input if supported and justified, or a smaller request size with an explicitly published client limit. Keep AI batches at no more than 60 and delete batches at no more than 50; reduce further if actual statement limits require it.

Imports remain atomic for up to the existing 2,000-row limit. Classify each row from database state within the same transaction before applying its write; derive aggregates from those committed outcome records. Do not classify rows from a preflight read outside the transaction. Do not implement chunked import commits that can leave a partially saved import unless the product specification is deliberately revised first.

For categorization, capture context revision **before** loading categories, targets, and review memory, and require it unchanged at commit. Current code loads categories before capturing the revision; fixing this ordering belongs to Plan 6. Otherwise a category edit between those reads can make stale definitions appear current. Final guards must also verify every eligible target still exists, retains its captured revision, and has no manual/current review protection. Increment each changed transaction revision once.

## UI operation state

Use `idle → running → completed | stopped | failed` with committed results recorded per batch. A transport-uncertain batch remains unresolved until its receipt is recovered; do not count it as committed or unprocessed by guesswork. Disable filters, import, selection editing, row category edits, and competing bulk actions while a bulk operation is running; page navigation may remain available. Stopping takes effect before the next batch and does not claim to cancel a request already sent.

After completion, clear processed IDs from selection and refresh current data. Failed/unprocessed IDs may remain selected only if still present; show the count. Non-operation refreshes intersect selection with both existing IDs and the current filter result, with a notice if IDs were removed. Never leave invisible selected rows silently actionable after a category change.

## Test harness and minimum evidence

Existing tests use Node's test runner and local HTTP scripts, without an established component test stack. Extract pure state transitions for mapping/selection/filter tests rather than adding a large test framework. Inject/mock the Responses transport behind a server-only seam for deterministic endpoint/service tests; never expose a production request parameter that bypasses auth or supplies fake AI output.

- Pure tests: `node --experimental-strip-types --test tests/banking.test.mjs tests/review-memory.test.mjs` plus the new test files using the same runner. Keep imports compatible with that runner rather than assuming application path aliases resolve.
- API tests: use the existing local sign-in flow in `tests/api-smoke.mjs`, a disposable local database, and synthetic rows. Keep live-provider tests separate; `tests/category-mapping-smoke.mjs` currently makes live calls.
- Two-owner isolation tests require two synthetic authenticated identities in a test-only harness or service-level injected identity. Do not add a production auth bypass, and do not claim the existing missing-ID tests prove two-owner isolation.
- For race tests, pause mocked AI after context capture, perform the competing mutation, then release the response. Read all target rows, review projections, context revision, and operation receipts afterward. Test both commit and rollback paths.
- Test populated upgrades with foreign keys enabled and verify foreign-key integrity after migration. In particular, dropping/recreating `accounts` is hazardous because child tables currently cascade on account deletion. Prefer supported column removal; if reconstruction is required, demonstrate preservation in the actual migration runtime before applying it to user data.
- Add a short per-plan completion note mapping each acceptance criterion to the check that passed or an explicit limitation. Browser QA follows applicable Sites instructions; do not substitute a claim of browser testing for pure-state/API tests.
