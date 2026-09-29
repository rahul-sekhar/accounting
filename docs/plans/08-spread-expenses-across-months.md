# 08 — Spread expenses across months

Status: proposed design and implementation plan. No feature code or deployment is included in this deliverable.

## Product decision

Add **Spread across months** to individual transactions and a **Monthly expenses** report with **Spread / As paid** modes. The original transaction retains its full amount, payment date, category, account, and import identity. A saved schedule changes when the report counts that expense; it does not create additional bank transactions.

This is a personal expense reporting feature. A laptop's chosen duration expresses how the user wants to distribute its cost, not a tax depreciation calculation or an installment payment plan.

| Example | Original payment | User chooses | Spread report |
| --- | --- | --- | --- |
| Home insurance | $1,200 in January | January, 12 months | $100 each month, January–December |
| Laptop | $2,400 in March | March, 24 months | $100 each month, through February two years later |
| Electricity | $180 in March | January, 2 months | $90 in January and February; $0 in March from this bill |

Amounts in these examples are displayed as positive expense values; stored transaction amounts remain negative for money out. Currency always follows the source account.

## Current app and integration points

- `app/dashboard.tsx` contains the main transaction table, the separate import-results table, and the category spending breakdown. Its breakdown currently sums `filteredTransactions`, whose dates are original payment dates. There is no dedicated monthly report in the current checkout.
- `lib/transaction-filters.ts` owns transaction filters; `lib/transaction-selection.ts` owns selection of real transaction IDs. Preserve those meanings.
- `lib/banking.ts` owns `Transaction`, `AppData`, category kinds, integer-cent amounts, and `summary`. Expenses and unclassified outflows contribute to spending; categorized refunds reduce expenses; transfers and investments are excluded.
- `app/api/data/route.ts` returns all owner-scoped transactions. Version one can derive monthly contributions from that complete dataset without another reporting endpoint.
- `db/schema.ts`, `drizzle/`, `lib/operations-server.ts`, and existing guarded mutation patterns provide storage, migration, concurrency, and retry foundations.

Read `implementation-contracts.md` and current code before implementation. Earlier plans are historical context, not a request to reimplement completed work. Preserve authentication, origin checks, AI review memory, account currency separation, import fingerprints, stable IDs, and bulk-operation recovery. Follow applicable Sites instructions when implementing; publishing this plan does not require deploying the app.

## User experience

### Set up a spread

1. Open a transaction's row action **Spread across months**. Offer it on both the main and import transaction tables, and from the monthly report's source details.
2. Open a dialog titled **Spread across months** showing the merchant, original payment date, full amount, currency, and category.
3. Choose **Start month** and **Number of months**. Start defaults to the payment month. Duration defaults to **12 months**, with quick choices of 2, 3, 6, 12, 24, and 36 plus custom entry. Opening an existing spread uses its saved duration. The default is only a form value; no spread applies until the user saves. Do not infer coverage dates from merchant names.
4. Show the derived **End month**, approximate monthly expense, and an expandable month-by-month preview with exact amounts. Preview updates immediately; saving remains explicit.
5. Save with **Save spread**. Refresh the shared data and show a notice such as “$1,200 spread across January–December 2026.” Include a **View monthly expenses** link opening that range in Spread mode.

Recommended helper copy: “Choose the months this cost belongs to. Your original payment stays the same.” For a utility bill: “For a bill paid after the service period, choose an earlier start month.”

The start can be before or after the payment month. This supports service periods paid in arrears and prepaid costs. Version one uses whole calendar months and equal portions, regardless of day counts; there is no partial-month proration.

Eligibility: nonzero transactions in an expense category, or unclassified outflows. Expense-category credits are eligible as refunds. Income, transfers, investments, zero amounts, and unclassified inflows cannot receive a new spread. Explain disabled actions and let users categorize first where appropriate.

### Review, edit, and remove

- Keep the transaction row's original date and full amount visible. Add a compact clickable label, e.g. **Spread · 12 months**, with the month range in accessible details. Avoid adding 12 synthetic rows to the transaction table.
- Opening the label shows the saved preview with **Save changes** and **Remove spread**. A separate confirmation dialog is unnecessary for reversible removal; explain beside the action that the full expense returns to its payment month.
- Edits immediately recalculate all affected historical and future months. Show the before/after range in the dialog; explain “Changes update past monthly reports too.” No closed reporting periods or historical snapshots in version one.
- Removing a spread does not remove the payment. Deleting the source transaction removes its contribution everywhere, including all allocated months. Extend existing deletion copy when selected transactions have spreads.
- Saving/loading/error states preserve entered values. A stale edit offers reload and review; it never silently overwrites another edit. Restore focus to the originating action on close; use labeled inputs and a scrollable preview on small screens.

### Monthly expenses report

Add **Monthly expenses** to existing navigation, using `/?view=monthly`. Keep it a compact working surface:

1. Header with **Spread / As paid**, currency, account, category, and an inclusive month range. Default to Spread and the current calendar year; future months in that year remain visibly labeled. Provide year navigation and a custom month range up to 120 months.
2. A net expense total for the selected period and a compact comparison: **As paid: $X · Spread: $Y**. Explain differences as amounts assigned into or outside the period, not savings.
3. A monthly bar chart and an accessible table of month, as-paid expenses, spread expenses, and difference. Negative net-expense months must remain visible. Future months use a distinct treatment and the caption “Includes only costs already recorded.” Zero means no recorded contribution, not a forecast of zero spending.
4. Select a month to see category totals and the contributing source transactions. A spread entry shows **$100 this month · $1,200 original payment · 1 of 12**, its payment date, and its coverage range. Open the original transaction details to edit its category or spread.

Month selection changes detail, not the overall range. Preserve report controls in dedicated URL parameters (for example `basis=spread&monthFrom=2026-01&monthTo=2026-12&currency=CAD` plus report account/category parameters). Back, Forward, and reload restore the report. Existing `view=transactions` and `view=import` continue to work. Keep preferences in the URL rather than saving financial data in browser storage.

Report filters are independent of transaction filters. On first opening from Transactions, carry over currency only; do not silently inherit search, import, amount, direction, or payment-date restrictions. Users can choose account/category explicitly in the report. Both modes use the same account/category scope. Archived accounts remain available for historical reporting.

The existing transaction breakdown remains labeled **As paid** and retains its current filter semantics. Add a **View monthly expenses** link. The monthly report must not reuse the dashboard's payment-date-filtered array: a March bill spread into January must appear in January even though its original date is outside that month.

## Calculation rules and edge cases

1. **Exactly one treatment per source:** in As paid, use the original signed amount in its payment month. In Spread, replace that contribution with its saved monthly portions; unscheduled transactions continue in their payment month. Never add the original and the portions together.
2. **Exact cents:** for absolute amount `A` and `N` months, use `floor(A/N)` cents each month and add one cent to the earliest `A % N` months. Reapply the original sign. For $100 over three months, show $33.34, $33.33, $33.33. Preview and report use the same function. Durations longer than the number of cents can have zero-value months, which the preview should show.
3. **Calendar arithmetic:** represent months as validated `YYYY-MM` values; use integer month indexes, not local date parsing or 30-day increments. Require duration 2–120, valid years 1900–9999, and an end month inside that range. A one-month allocation is unnecessary; remove the spread to use the payment month.
4. **Date boundary:** allocate the full schedule before restricting contributions to the selected reporting months. Do not redistribute the full amount among only visible months. Crossing years and leap years changes neither the duration nor total.
5. **Categories:** each contribution uses the source's current category and account. Recategorization updates every affected month, consistent with current reporting. A category rename does not break a spread. If the category becomes ineligible, retain the schedule for possible restoration but ignore it in expense reporting, show **Spread inactive**, and still allow removal. Becoming eligible again reactivates it. Spreading itself does not change category revisions or AI review evidence.
6. **Refunds:** preserve the app's signed semantics. An expense-category credit reduces expense in its payment month by default. The user may separately spread that refund over chosen months, including the original coverage period. Do not automatically link it, resize the purchase, or guess a refund relationship. Unclassified credits stay outside expense reporting until categorized appropriately.
7. **Negative totals:** net expenses can be negative. Use signed totals consistently across headline, monthly table, and category details. Do not reuse the current breakdown's positive-only category clipping for this report. Prefer bars/table over a pie chart that cannot represent negatives.
8. **Currency:** never sum CAD and USD together. All calculations are scoped by account currency before aggregation. No exchange conversion.
9. **Imports:** duplicate detection and enrichment preserve the existing spread because they preserve the original transaction ID. Deleting and re-importing creates a new transaction with no spread. Import history remains a record of actual imports and is never populated with monthly portions.
10. **Lifetime reconciliation:** over the union of all payment and coverage months, signed As paid and Spread totals match exactly for the same eligible source set. Totals over a smaller range may legitimately differ.

## Storage and API design

For equal monthly spreads, store the schedule directly on the source transaction. A child ledger of materialized monthly rows would duplicate derivable data and introduce synchronization work unnecessary for this version.

Add an additive migration with:

| Transaction column | Meaning |
| --- | --- |
| `spread_start_month TEXT NULL` | First covered month; null means no active saved schedule |
| `spread_month_count INTEGER NULL` | 2–120 when a schedule exists |
| `spread_revision INTEGER NOT NULL DEFAULT 0` | Independent concurrency counter, retained and incremented when a spread is removed |

Enforce paired nullability and duration constraints in the database where supported by the additive D1 migration, and all calendar/eligibility checks in the service. Generate and inspect the actual migration; do not reconstruct populated transaction tables merely for a check constraint. Existing records initialize to no spread and unchanged totals. Extend `Transaction` and the explicit `/api/data` SELECT. Keep original amount/date/fingerprint and `category_revision` untouched by spread mutations.

Proposed endpoint: `PUT /api/transactions/[id]/spread`.

```ts
type SpreadRequest = {
  operationId: string;
  expectedRevision: number; // spread_revision from current data
  schedule: { startMonth: string; monthCount: number } | null;
};

type SpreadResult = {
  operationId: string;
  transactionId: string;
  schedule: { startMonth: string; monthCount: number } | null;
  revision: number;
  replayed: boolean;
};
```

`schedule: null` removes the schedule. Any successful new request increments the spread revision once, including removal, so remove/recreate cannot reset concurrency protection.

- Require existing auth/origin validation and strict JSON, ID, safe-integer revision, month, and duration validation. Use 400 for invalid inputs, 401 for anonymous access, indistinguishable 404 for missing/unowned transactions, and 409 `stale_spread` for revision mismatch. Use a stable `ineligible_transaction` validation code for an owned source that cannot receive a schedule. Removal remains allowed regardless of category.
- Use owner-scoped operation receipts with kind `spread`, hashing transaction ID, expected revision, and canonical schedule. Check receipts before comparing current revision. Identical retries replay the receipt; reused operation IDs with different inputs give 409 `operation_conflict`.
- Commit the guarded update and receipt in one atomic D1 batch. The database guard must enforce source existence, owner, expected spread revision, and current eligibility at commit. Read-before-write alone is insufficient. Prove rollback on guard or receipt conflict using persisted state.
- A category change racing the save must either leave a valid schedule under the committed category or reject the save. A later category change can make the stored schedule inactive according to the rules above. Do not involve AI context revision merely to save reporting preferences.
- Retain the exact request while a response is uncertain and retry with the same operation ID. After success, refresh current data separately: receipt replay describes the prior save and must not overwrite later edits in client state.
- Reuse the existing operation-lock convention: spread mutations cannot overlap with bulk delete/categorize, category edits, or other conflicting local mutations. Lock navigation and preserve unresolved requests within the mounted app. Do not extend the current recovery lifetime to cross-tab persistence as incidental scope.

No reporting endpoint, scheduler, recurring job, background monthly writes, provider calls, or new credentials are needed. With the current complete `/api/data` payload, derive only contributions intersecting the selected report range and memoize them. Keep the pure calculation module reusable for a later server report if data loading becomes paginated.

### Monthly query contract

Monthly account expense totals have two explicit query bases. In both, scope source transactions by authenticated owner, selected account(s), currency, and eligible category before aggregation. Group contributions by account and reporting month; never combine currencies into one total.

- **As paid:** select transactions whose payment dates fall in the reporting period and aggregate their original signed amounts under existing expense/refund rules.
- **Spread:** combine unscheduled eligible transactions paid in the reporting period with scheduled eligible transactions whose coverage intersects the reporting period, irrespective of payment date. Each scheduled source contributes only its exact portion for each intersecting month. Exclude the scheduled source's original payment from this branch.

For inclusive report month indexes `[R0, R1]`, a schedule starting at `S` for `N` months overlaps when `S <= R1 && S + N > R0`. Expand only month indexes from `max(S, R0)` through `min(S + N - 1, R1)`. The portion ordinal remains `monthIndex - S`, so remainder cents do not move when the report range changes. Payment date predicates must apply only to the unscheduled branch, never to the scheduled branch. Use disjoint branches (or their equivalent) to prevent double counting.

For example, January's report includes a $1,200 insurance payment made the previous December if its 12-month coverage starts that December: $100 contributes to January. It also includes $90 from a $180 March electricity payment spread across January–February. Both sources would be missed by a query restricted to January payment dates.

Version one still fetches all owner-scoped source transactions through `/api/data`, now including spread metadata, and applies this contract in the shared pure aggregation function. Thus no new database reporting query is required initially. If transaction loading later becomes paginated or date-limited, move the same contract to a server report query that retrieves both branches; never calculate monthly reports from one transaction page. Any future SQL must bind parameters and preserve owner predicates on both branches. Consider indexes and an indexed coverage end only after measuring the server query; no materialized monthly ledger is required now.

The transaction list and import queries continue to use original payment dates and amounts. This feature changes monthly expense attribution, not account balances or recorded cash movements.

## Implementation sequence

### 1. Establish calculation contracts

Create `lib/expense-spreading.ts` for month validation/arithmetic, schedule validation, eligibility, exact signed portions, and report aggregation. Make both preview and report depend on it. Define contribution records with source transaction ID, month, signed allocated amount, original amount/date, and portion ordinal; they are report data, never `Transaction` objects.

Add `tests/expense-spreading.test.mjs` using the existing Node test runner. Cover the three product examples, remainder cents of both signs, one-cent amounts, 120 months, year crossings, invalid months, date-range overlap, future months, currencies, refunds, inactive schedules, and exact lifetime reconciliation. Verify that an unscheduled dataset matches existing signed expense semantics, including negative net categories.

### 2. Persist and safely mutate schedules

Extend `db/schema.ts`, generate the next available migration, extend `lib/banking.ts` and `/api/data`, and implement the owner-scoped service in `lib/expense-spreading-server.ts` plus the proposed route. Extend operation receipt types/helpers where appropriate without rewriting existing operations.

Add service tests for create/edit/remove, concurrent revisions, retry replay, operation conflicts, two-owner isolation, deletion/category races, and atomic rollback. Apply the migration to populated synthetic data with foreign keys enabled; verify existing IDs, deduplication, categories, reviews, receipts, amounts, and dates survive. No reset of user data.

### 3. Add the transaction interaction

Create a shared `app/expense-spread-dialog.tsx` using existing dialog/form components. Add actions and labels to both transaction table surfaces. Integrate save, refresh, inactive schedules, validation, and unresolved-request recovery with existing mutation locks. Extend deletion copy for scheduled transactions. Extract small pure controller transitions for focused tests rather than installing a new component framework.

Acceptance: a user can preview, save, reopen, edit, and remove a spread while the original row remains intact. Failed requests retain inputs, stale saves do not overwrite newer work, and unresolved saves cannot be discarded by competing actions.

### 4. Add Monthly expenses

Create `app/monthly-expenses.tsx`, integrate `view=monthly` in the dashboard and navigation, and implement independent report URL state, selectors, chart/table, and month details. Add source access even for a transaction paid outside the selected report range. Ensure the report does not depend on transaction table pagination or selection.

Acceptance: the March electricity bill appears in January and February in Spread mode and only in March in As paid mode. Currency/account/category changes update all visible totals and detail consistently. Refresh, direct links, and Back/Forward retain the report state. Original transaction filters and selection retain their established behavior when navigating under existing lock rules.

### 5. Verify and hand off

- Run the focused tests plus relevant filtering, selection, deletion, categorization, banking, and import regression suites. Do not run live AI scripts for this feature.
- Run TypeScript, lint, and the production build under current project instructions.
- Verify the complete synthetic flow: import insurance/laptop/electricity → spread → inspect past/future months → edit → refund → recategorize → remove → delete → duplicate import/re-import. Record outcomes against the acceptance criteria below.
- Check loading, empty, negative-total, validation, stale, unresolved-save, and refresh-failure states through deterministic tests. If browser testing is requested during implementation, check desktop/mobile, keyboard/focus, month details, both transaction surfaces, and report URL navigation; otherwise explicitly record visual verification as not performed under Sites instructions.
- Add an adjacent completion note with migration details, exact checks, unresolved limitations, and any approved scope changes. Follow applicable Sites hosting instructions for the completed implementation, not for this planning deliverable.

## Release acceptance criteria

1. All three examples produce the monthly amounts above while retaining one original transaction each.
2. Changing mode changes timing only; lifetime totals reconcile to the cent without double counting.
3. Payments outside the report range contribute when their spread intersects it; future portions appear without implying future bank payments.
4. Editing/removing a schedule updates all affected months; deleting a source leaves no contribution behind.
5. Refunds, unclassified amounts, category changes, transfers, investments, and currencies obey the explicit rules above.
6. Duplicate imports preserve spreads; a new transaction created after deletion starts without one.
7. The original transaction table, filters, import counts, bulk selection, and AI review history retain their current meanings.
8. Two-owner isolation, concurrency, idempotent retries, atomic rollback, and populated migration preservation are demonstrated by tests.

## Deliberate version-one boundary

Ship manual equal monthly schedules, exact previews, edit/remove, and a complete monthly comparison report together. Defer custom uneven allocations, day-based service periods, partial-amount spreading, automatic merchant rules, recurring renewals, bulk scheduling, linked-refund automation, asset depreciation, and historical report snapshots. These can be added later without changing the original transaction model.
