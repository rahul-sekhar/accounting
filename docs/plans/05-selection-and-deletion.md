# 05 — Selection across pages and bulk transaction deletion

Depends on: [04](04-transaction-filters.md).

## Outcome and selection contract

- Row checkboxes select individual transactions. Header checkbox selects/deselects the current page and supports an indeterminate state.
- Offer a distinct “Select all N matching transactions” action. Capture every filtered ID, including other pages, at that moment. Display total selected and allow clear selection.
- Preserve selection on page navigation. Changing any filter/currency clears selection with a notice. Refresh intersects selection with still-existing matching rows and reports removed items.
- An operation captures its own immutable IDs; newly imported/matching rows are never silently added. Disable overlapping mutations while the operation runs.
- Bulk delete confirms the exact count and scope before execution. It deletes transactions, not the account or import history. This in-product confirmation is part of the feature, not a request for approval to implement it.

## Current code to inspect

`app/dashboard.tsx` has no selection model and pages locally. `db/schema.ts`, `lib/reviews-server.ts`, and `lib/review-memory.ts` define review events, active review projections, and owner context revisions. `app/api/categorize/route.ts` guards concurrent writes. Plan 3 adds retained import-row outcomes.

## Work steps

1. Implement shared selection state and a bulk toolbar, separate from table pagination. Provide accessible checkbox names, keyboard operation, selected count, and pending/error states.
2. Add the owner-scoped bulk-delete endpoint in the shared contracts, accepting a bounded explicit ID list and operation ID. Validate uniqueness and input limits. Process owned IDs only; report deleted, unknown, and unowned IDs identically as unavailable when they are not current owned targets. Never query another owner's records to distinguish these cases.
3. Use a documented conservative batch size compatible with D1 bind/statement limits. Execute batches sequentially against the captured IDs. A selection can exceed that size; client orchestration must not truncate it.
4. In each committed batch, remove live transactions and their active `transaction_reviews` projections, and increment the owner categorization context revision atomically when memory/targets change. Retain immutable review events as audit history, but ensure deleted transactions never contribute to active memory or backfill.
5. Retain import outcome snapshots and aggregate counts. Results must display a deleted/unavailable transaction reference honestly. Account deletion rules from Plan 1 must still recognize retained history.
6. Preserve AI concurrency guards: deletion during an AI request cannot recreate a transaction or commit stale categorization evidence. Review retries against deleted transactions must not appear to restore them.
7. Report committed progress, failures, and remaining IDs. A failed later batch must not imply earlier batches rolled back. Retry only unfinished work with consistent operation identity. Refresh rows, summaries, selection, and page bounds after completion.
8. Document re-import behavior: deleting a transaction removes its live fingerprint, so a later deliberate import may add it again with a new transaction ID. Retained reviews must not automatically resurrect it as a manually reviewed row.

## Acceptance and verification

- With 80 matching rows across pages, select all, deselect one off-page row, and delete exactly 79. Unmatched rows remain.
- Page-only selection deletes only that page. Changing filters clears selection before any new bulk action.
- Verify repeated operation requests, partial batch failure/retry, missing IDs, empty selection, oversized payloads, and cross-owner isolation with indistinguishable unavailable IDs.
- Deleted reviewed transactions disappear from active memory; historical events/import reports remain. In-flight AI writes conflict or skip safely without partial stale saves.
- Re-import after deletion follows the documented behavior. No unintended account cascade occurs.
- Add integration coverage for database side effects and selection tests for pagination/filter behavior; run relevant review-memory regressions and build checks.

## Handoff

Use [Implementation contracts](implementation-contracts.md) for receipt schema and retry rules. Start with a maximum of 50 IDs per delete request and validate the actual SQL limits. A receipt stores exact deleted/unavailable IDs; use it to recover counts after response loss. Mutation, active-review removal, context increment, and receipt insertion form one atomic batch. Increment context only when rows were actually deleted, once per committed batch.

There is a concrete existing replay edge in `lib/reviews-server.ts`: `saveReview` returns an old event result before checking whether its transaction still exists. Before returning such a replay, check current owner-scoped transaction existence; a deleted transaction returns 404 and does not display a renewed saved/reviewed state. Preserve immutable historical events and ordinary replay behavior for existing transactions. Add a regression for reviewing → deleting → replaying the old review request.

Make `loadReviewRows` defensively join live owner-scoped transactions in addition to deleting active projections. This prevents any stale projection from leaking deleted examples into prompts. Do not backfill or move retained events onto a newly re-imported transaction.

Make the selection capture, bounded progress UI, failure reporting, and retry conventions reusable by Plan 6. Record audit-retention behavior in user-facing documentation without implying deletion erases historical import/review reports.
