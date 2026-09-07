# 03 — Persistent import outcomes and duplicate results

Depends on: [01](01-generic-accounts.md), [02](02-amount-direction.md).

## Outcome and decisions

After import, show a dedicated results page with summary counts and a row-level duplicate report. Explain whether each matching row was skipped unchanged or supplied a missing sub-description. Report completed actions, not speculative actions.

- Preserve existing fingerprint semantics: owner + account + date + normalized description + amount + occurrence number. Equal repeated rows within one export remain distinct occurrences.
- Use statuses such as `added`, `duplicate_skipped`, and `duplicate_enriched`. In the existing aggregate contract, `skipped` means all matching rows, including enrichment; display an enrichment breakdown so counts cannot be mistaken for disjoint totals.
- Do not add fuzzy matching or ask the user to resolve exact matches already handled automatically.
- Duplicate enrichment fills only an empty sub-description; it never overwrites nonempty details or category/review decisions.
- Original transaction import ownership remains unchanged on subsequent matches.

## Current code to inspect

`app/api/import/route.ts` currently performs conflict-aware inserts and returns only counts/account ID; it stores import aggregates. `db/schema.ts` contains imports and transaction fingerprints. `app/api/data/route.ts` returns only the latest 20 imports and omits transaction import IDs. `app/dashboard.tsx` closes import and displays a notice. Inspect current duplicate tests and review snapshot handling.

## Work steps

Read [Implementation contracts](implementation-contracts.md) for endpoints, owner-scoped receipts, and atomicity. Use 1-based **data-row ordinal**, excluding the header, for report position; quoted multiline cells must not be confused with physical file line numbers. Outcome rows use `(user_id,import_id,row_ordinal)` as their primary/unique key. Keep the outcome's original matched transaction ID as historical data even if that transaction later disappears.

For each report, enforce `total = added + skipped` and `0 ≤ enriched ≤ skipped`; `enriched` counts only `duplicate_enriched`. New reports set `detailsAvailable:true`, including a zero-duplicate report. Legacy reports set it false; a table with no outcome rows alone must not be mistaken for a new zero-row import. Add a nullable report-version marker to imports, leaving existing imports null and writing version 1 for new imports. Include account currency in the result metadata for Plan 4.

Store the parsed incoming sub-description in the outcome and the action status; do not present it as the current stored detail when the match was skipped because existing detail was nonempty. Link to the current transaction separately. Enrichment must not rewrite existing review snapshots. It must increment the enriched transaction's `category_revision` so an in-flight AI call based on the former description cannot commit stale evidence. This is an optimistic-concurrency revision even when the category itself did not change.

For new-account imports, receipt, account, transactions, outcomes, and report must commit together. Replaying after a lost response must not create a second account. Extend Plan 1 account deletion guards to include retained outcome history in this migration's implementation.

1. Add a new import-row outcomes table with owner/import ID, source row position or parsed ordinal, occurrence, normalized date/description/sub-description/amount, outcome, matched/created transaction ID, and minimal action detail. Use an owner/import/row uniqueness constraint and appropriate indexes.
2. Preserve outcome records after transaction deletion. A transaction reference may become unavailable; avoid a cascading foreign key that deletes the report. Store only normalized reporting fields, not raw files or arbitrary source columns.
3. Refactor import writes so outcome classification, enrichment/insertion, and aggregate counts agree with committed results. Avoid a read-before-write race that labels a concurrent match as newly added. Use atomic D1 batches/conditional SQL and bounded statement sizes compatible with 2,000-row imports.
4. Introduce an owner-scoped client operation ID for a save attempt. Replaying the same operation returns the same import; reject reuse with different input. This distinguishes network retry from an intentional new import of the same CSV.
5. Return `importId`, account ID, and result counts. Add owner-scoped result/detail reads with pagination and missing/deleted transaction handling. Expose import history beyond the current latest-20 cutoff without losing older groups.
6. Add a results page reachable immediately after save and again from import history. Show filename, account, time, totals, duplicate rows, action taken, loading/error states, and an explicit no-duplicates state. Include a transaction-view area/link for Plan 4.
7. Existing imports keep their recorded aggregates. Mark detailed results unavailable for imports predating the new table; do not invent row-level history. Existing transaction import IDs remain usable for filtering.

## Acceptance and verification

- First import records added outcomes. Exact re-import records skips. Overlapping exports add only new rows while preserving repeated occurrences.
- Re-import with missing-detail enrichment records that action accurately and preserves manual categories and nonempty details.
- Importing only duplicates still yields a useful results page with zero newly added transactions.
- Same-operation retry returns the same report; a distinct operation creates a new import report. Failure leaves no misleading success report or inconsistent outcome counts.
- Concurrent overlapping imports cannot both claim the same row was added. Test transaction atomicity, not just aggregate arithmetic.
- Reports are owner-scoped, pageable, durable after refresh, and valid after referenced transactions are removed in Plan 5.
- Verify the 2,000-row boundary and older import fallback with synthetic integration fixtures; run existing duplicate regressions and build checks.

## Handoff

Document result/status schemas and endpoints for Plan 4. Historical `added`/`skipped` values describe import-time events, not current transaction counts.
