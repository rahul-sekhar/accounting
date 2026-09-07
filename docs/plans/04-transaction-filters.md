# 04 — Transaction filters, sub-description column, and import view

Depends on: [03](03-import-outcomes.md).

## Outcome and filter contract

Provide one coherent filterable transaction table, reusable on the main transaction screen and import results page. Apply all filters before pagination.

| Filter | Required behavior |
| --- | --- |
| Search | Case-insensitive literal substring across description and sub-description; trim outer whitespace; no regex or AI search |
| Direction | All, debit/money out (`amount < 0`), credit/money in (`amount > 0`); zero rows appear in All |
| Amount | Inclusive min/max absolute amount in the selected currency; direction is separate; validate nonnegative values and min ≤ max |
| Category | Stable category ID, including assigned archived categories and existing needs-review behavior |
| Account | Stable account ID, including archived accounts with clear labels |
| Date | Inclusive start/end transaction dates, with either bound optional and no timezone shift |
| Import group | Original creating import ID; show filename/account/time to distinguish repeated filenames |

Keep the currency scope explicit. Search and filters combine with AND; clear filters returns to the current currency's full transaction list. Summaries and result counts must follow the same full filtered set, not just the current page.

## Current code to inspect

`app/dashboard.tsx` currently filters all fetched transactions by currency/account/month/category and slices 25 rows per page. Sub-description is already shown below description. `lib/banking.ts` owns shared types and summary helpers. `app/api/data/route.ts` currently fetches all owner transactions, but omits `import_id`.

## Work steps

Use `/?view=transactions` and `/?view=import&importId=...` as defined in [Implementation contracts](implementation-contracts.md). URL filter keys: `currency`, `q`, `direction`, `minAmount`, `maxAmount`, `category`, `account`, `from`, `to`, and `importGroup`. Encode amount bounds as decimal currency units and parse to integer cents; blank means no bound. Keep the results-page `importId` distinct from the transaction-table `importGroup` so clearing table filters does not switch the historical report being read.

Replace the existing month constraint with the date range; do not leave a hidden month filter narrowing results. Existing month shortcuts may populate the date range. Invalid user-entered bounds show a field error and disable bulk actions until corrected; do not silently apply an unfiltered set. Malformed URL values fall back to defaults with a notice. Use `replaceState` for individual filter edits and navigation state for entering/leaving the results page; handle `popstate` without reload loops.

Selecting an import group establishes its account and currency; switching account to another account or currency clears that group with a notice. Search is trimmed, case-insensitive literal matching, with no accent folding requirement. Date strings are validated real `YYYY-MM-DD` dates. Keep the existing stable descending-date/ID ordering and 25-row page size. Extract reusable `filteredTransactions`, `filteredIds`, and `filterValid` outputs for Plan 5.

1. Expose transaction `import_id` and complete import picker history through the APIs established in Plan 3. Update shared types and validate selected IDs within owner scope.
2. Extract a typed, pure filter function and reusable filter/table components as needed. Preserve the existing complete client dataset approach for this scope unless measured constraints require server pagination. Never introduce an undocumented fetch cap that makes “all matching” incomplete.
3. Implement the filter contract and reset pagination to page one on any filter change. Use stable date/ID ordering. Show match count, clear filters, and useful empty/invalid states.
4. Display sub-description in its own labeled table column, with an empty placeholder and readable wrapping. Remove its redundant rendering under description. Preserve import preview and review-evidence detail.
5. Make filter state navigable/restorable using the URL contract above. Validate malformed parameters and do not place raw CSV data in URLs.
6. On import success, open the results page with currency/account/import group set to that import and unrelated filters cleared. Render the filtered newly added transactions automatically alongside the results summary and duplicate section from Plan 3. All-duplicate imports show zero new transactions with the duplicate report still available.
7. Keep import group and account/currency changes coherent: clear an incompatible import group and notify rather than silently hiding transactions. Expose archived historical groups without allowing new imports into archived accounts.

## Acceptance and verification

- Combined filters work across more than 25 rows, including exact amount/date boundaries, zero amounts, blank details, refunds, and archived categories/accounts.
- Search matches sub-description and treats punctuation as literal text. Amount filtering uses integer cents without floating-point boundary errors.
- Counts, income/expense summaries, category breakdown, and visible rows agree on filter scope.
- Import success automatically displays only newly created, still-existing rows from that group. Enriched/skipped matches appear in the outcome report, not as new transactions.
- Older-than-20 imports remain selectable. Reload/back navigation restores valid filters; invalid state has a safe fallback.
- Empty results do not strand pagination. Run focused pure filter tests and relevant API/type/build checks.

## Handoff

Expose the full filtered transaction list/IDs independently of pagination for Plan 5. State clearly whether data is complete; if server pagination was necessary, implement a bounded complete ID-resolution path before calling this plan complete.
