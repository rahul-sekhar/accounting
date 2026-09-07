# Plan 4 completion — transaction filters and import view

Implemented one complete client-side transaction filter contract over the owner-scoped `/api/data` transaction dataset. Filtering happens before the fixed 25-row pagination boundary and exposes `filteredTransactions`, `filteredIds`, and `filterValid` from the pure helper for Plan 5.

## Delivered contracts

- URL filter keys are `currency`, `q`, `direction`, `minAmount`, `maxAmount`, `category`, `account`, `from`, `to`, and `importGroup`. The import report continues to use the distinct `view=import&importId=...` keys.
- Search trims its query and performs a case-insensitive literal substring match across description and sub-description. Direction uses the stored sign convention and leaves zero-amount rows in the all-directions result only.
- Amount bounds are parsed directly from decimal strings to integer cents and are inclusive absolute-value comparisons. Invalid, negative, over-precision, reversed, or unsafe bounds invalidate the result instead of broadening it.
- Date bounds accept real `YYYY-MM-DD` dates without timezone conversion and are inclusive. Either bound can be omitted.
- Category, account, and import filters use stable IDs. Archived categories and accounts remain selectable and visibly labeled. Import labels include filename, account, and local timestamp.
- The import picker pages through the full owner-scoped import history in batches of 100 rather than inheriting `/api/data`'s recent-history display cap.
- Selecting an import group establishes its account and currency. Changing to an incompatible account or currency clears the group with a notice. Malformed URL values safely reset with a notice; in-form invalid amount/date values remain visible with field errors.
- Individual filter edits use `replaceState`; entering an import result uses navigation history; `popstate` restores validated state. Filter changes reset pagination to the first page.
- `/api/data` preserves complete owner transaction retrieval and now uses stable `(date DESC, id DESC)` ordering.
- Transaction income, spending, category breakdown, review count, match count, and visible rows use the same complete filtered set.
- Sub-description now has its own labeled, wrapping table column with an em-dash placeholder and is no longer repeated under description.
- Import completion opens the historical results page with currency, account, and creating import preselected. The same filter controls and a paged transaction table appear beside the duplicate report. All-duplicate imports retain their report and show zero new transactions.

No schema migration or new endpoint was required for this plan. `transactions.import_id` and the paged import APIs introduced by Plan 3 supply the provenance and full picker history.

## Verification

- `node --experimental-strip-types --test tests/banking.test.mjs tests/accounts.test.mjs tests/account-migration.test.mjs tests/import-mapping.test.mjs tests/import-outcomes.test.mjs tests/review-memory.test.mjs tests/transaction-filters.test.mjs` — 38 passed.
- Focused filter cases cover combined predicates, exact cent/date boundaries, literal punctuation, sub-description search, debit/credit/zero behavior, invalid bounds, archived account/import restoration, and malformed stable IDs.
- `node tests/api-smoke.mjs` — passed against the local Sites runtime, including authentication/origin checks, generic account lifecycle, import/re-import outcomes, protected history, and owner-scoped data refresh.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `npm run build` — passed with the existing authenticated page and API routes.
- `git diff --check` — passed.

The implementation keeps the existing complete client dataset approach: there is no server transaction cap and no separate ID-resolution endpoint is needed for Plan 5. Browser interaction QA was not requested; the compiled local preview was opened without claiming visual or interaction testing.
