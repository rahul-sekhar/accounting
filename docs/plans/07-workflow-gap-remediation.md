# 07 — Close the transaction workflow verification gaps

Implementer: GPT 5.6 Sol (`gpt-5.6-sol`).
Project: `/Users/rahul/Documents/ChatGPT/Accounting`.
Status: implemented on 2026-09-07; see [the completion note](07-workflow-gap-remediation-completion.md). No deployment was performed as part of this plan.

## Objective and scope

Fix the six gaps identified in the verification review of Plans 1–6. Preserve the implemented account, import, filtering, review-memory, and owner-isolation contracts. Read [implementation-contracts.md](implementation-contracts.md), Plans 4–6, and their completion notes first. Some shared-contract descriptions describe pre-implementation code; inspect the current checkout rather than recreating already completed work.

The review baseline passed 49 deterministic tests, TypeScript, lint, and the production build. Those checks did not establish browser behavior or the successful AI inference/race paths. No source changes were made during that review.

| Finding | Priority | User impact | Rough effort including focused tests |
| --- | --- | --- | --- |
| G1: Completed categorization masks a running deletion | P1 | After categorizing, a user starts deletion and can start another bulk action while it runs | 1–2 hours |
| G2: Ambiguous categorization loses recovery workflow | P1 | A committed batch whose response was lost can be submitted again under a different operation ID after changing selection | 3–5 hours |
| G3: Delete failure leaves the dashboard busy | P2 | A definitively rejected deletion leaves filters, import, and row editing disabled | 1–2 hours |
| G4: URL restoration mishandles selection and import scope | P2 | Back changes filters without clearing selection; reload restores an import filter the user cleared | 2–4 hours |
| G5: Retry resets committed totals | P2 | Deleting 50 rows, then retrying 30, reports only the last 30 | 1–2 hours |
| G6: Missing deterministic AI integration/race verification | P2 | Stale AI writes and rollback protections are implemented but unproven through the actual service | 4–8 hours |

Total estimate: 12–23 hours. The implementation steps below group related findings to avoid separate patches to the same state machinery. Do not treat the estimate as a completion deadline.

No schema migration, new provider, new credential, queue, framework replacement, bulk manual categorization, or transaction data repair is expected. No live model calls are required. Preserve endpoint request shapes, receipts, batch limits (delete 50, categorize 60), integer cents, origin/auth checks, and the configured Responses integration. Inspect applicable AGENTS.md and skills before implementation. Do not deploy merely to publish this plan.

## Step 1 — Establish one authoritative bulk-operation state (G1, G3, G5)

Inspect `app/dashboard.tsx` (`runDeletion`, `categorize`, `editSelection`, toolbar call sites), `app/transaction-selection-toolbar.tsx`, `lib/transaction-selection.ts`, and `lib/transaction-categorization.ts`.

Current causes:

- The toolbar picks `categorizeOperation || deleteOperation`, so historical categorization can override the active delete state.
- `runDeletion` returns from its catch without clearing `busy`.
- Retry invokes the original start function, which calls `begin*Progress` again and discards committed totals.

Extract a small shared operation controller with pure transitions and injectable request/refresh callbacks, used by the actual dashboard. Keep the dashboard as the composing screen; do not rewrite unrelated UI. Prefer a discriminated union with one operation kind, rather than two independent states competing for display. Retain completed summaries separately if necessary, but never derive mutation locks from a historical summary.

Each operation must retain its captured IDs, original total, batch records, committed outcomes, unsent IDs, and any unresolved request. Store the exact UUID and payload on the batch, not solely in a map indexed by whatever selection the UI currently holds. Count each committed batch once, including receipt replays. Selection and the operation's immutable work list are distinct.

Use these observable states (equivalent names are acceptable):

| State | Meaning | Allowed behavior |
| --- | --- | --- |
| idle | No operation | Normal interaction |
| running | Sending/processing a batch | Lock mutations, filters, and selection; pagination may work |
| unresolved | A sent batch may have committed | Retain exact request; offer receipt recovery; keep competing mutations locked |
| stopped | Stopped before another batch was sent | Preserve totals; allow resume of unsent work or explicit abandonment |
| failed | Definitive non-commit or terminal error | Release active lock; retain result/error summary and applicable remaining work |
| completed | All submitted work resolved | Show cumulative totals and refreshed data |

Add a synchronous start guard as well as disabled controls so double clicks or callbacks cannot start competing operations before React rerenders. Both transaction surfaces must use the same lock. Audit imports, account/category management, manual row reviews, toolbar actions, and any registered import-opening callback. A completed operation must never mask a new running one.

Stopping applies before the next unsent batch. It does not cancel or declare failure of a sent request. Resume must carry forward previous committed totals, rather than starting a new progress object. If the user explicitly abandons definitively unsent work and later starts a new operation, a new total is appropriate.

Acceptance tests through the production controller:

1. Categorize → complete → select other rows → delete. Delete progress is visible and competing actions are rejected until it resolves. Test the reverse order and double start too.
2. Delete 80 captured IDs: commit 50, fail the next 30 definitively, retry successfully. Final total is 80, deleted count includes both batches, and the first batch was sent only once.
3. Categorize 121 captured IDs: commit 60, stop before the next batch, resume. Original total and all outcome counts survive.
4. A definitive deletion rejection releases the lock and provides a useful error; a transport failure follows Step 2 instead.
5. A refresh failure after a successful mutation does not reclassify the committed batch as uncommitted or repeat its writes.

## Step 2 — Preserve unresolved requests and distinguish error types (G2, G3)

Inspect the dashboard `api` helper, error codes from `lib/server.ts`, delete/categorize endpoints, and receipt helpers. Preserve HTTP status and stable application code in client errors. Do not classify every exception or HTTP error as proof that no mutation committed.

Implement an explicit error policy:

- Network interruption, client timeout, malformed/incomplete success response, or an unclassified server/proxy failure: mark the sent batch unresolved. Do not count it as committed or available for a fresh operation by guesswork. A generic HTTP 500 is not sufficient proof of non-commit.
- Successful, validated receipt/result: record it once, then refresh current data separately. Refresh failure offers a refresh retry without repeating the resolved mutation.
- `409 stale_context`: the eligible write set did not commit. Refresh current data; allow a deliberate retry with a new UUID after reconciling remaining work and current eligibility. Preserve cumulative earlier results.
- `409 operation_conflict`: show a terminal identity-conflict error. Never silently generate a new UUID to bypass it.
- Validation/auth/known pre-commit provider errors: show actionable failure and release the active lock. Retry transient failures only on user action; do not loop on permanent errors. Add stable server codes for known pre-commit failures if needed, without altering the success contract or weakening server validation.

Recovery resends exactly the unresolved batch's UUID and IDs before any unsent batch. If it already committed, the server returns its receipt without another AI mutation. If it never reached the server, the same request may execute normally. External inference itself is not guaranteed exactly once.

Filter changes, clear-selection, operation dismissal, and in-app navigation must not discard unresolved work or make it possible to start a replacement action. Protect both dashboard surfaces. If Back/Forward changes the location during running/unresolved work, defer applying that navigation until the batch is resolved; do not silently change the captured work. Do not claim to cancel an already-sent request.

Keep the existing in-memory lifetime: persistence across a full reload/tab close is not part of these six fixes. Do not add transaction payloads to local storage as an incidental solution. Document that boundary; within the mounted application, preserve recovery even when navigation is attempted.

After resolution, keep failed/unsent selection consistent with current existing matching rows. Do not change an unresolved payload to perform that reconciliation. When reconciling definitively unsent work, retain explicit accounting for removed/unavailable/protected IDs so the original total remains understandable. Server eligibility remains authoritative, including review projections with null timestamps.

Acceptance tests:

1. Commit categorization, drop its response, attempt filter/selection/navigation changes, recover. Exact UUID and payload are replayed; the committed batch is counted once and no new suggestion replaces it.
2. Repeat for deletion; receipt recovery restores correct deleted/unavailable counts.
3. Drop a request before it reaches the server; recovery safely executes the same batch once.
4. Change membership after a resolved operation and start a deliberate new operation; it gets a new identity. Membership edits are unavailable while unresolved.
5. `stale_context` allows deliberate refresh/retry with a new identity; `operation_conflict` does not automatically retry.
6. Stop requested during a lost-response batch takes effect only after recovery, before any next batch.

## Step 3 — Make filter navigation explicit and selection-safe (G4)

Inspect `lib/transaction-filters.ts`, the dashboard URL restoration effect and `popstate` listener, import-success navigation, `app/import-history.tsx`, and links in `app/import-results.tsx`.

Use one transition for effective filter changes regardless of origin: control edit, currency switch, clear, import completion, or Back/Forward. Compare normalized filter values; on a real change clear selection and show a notice, reset pagination, and update URL/state consistently. A normal refresh with unchanged valid filters must preserve selection through the existing intersection rule. Running/unresolved operations use the navigation policy in Step 2.

Separate first-entry defaults from restoration. `importId` selects the historical report; `importGroup` selects the table's original creating import. The absence of `importGroup` can mean the user deliberately cleared it, and must not always cause it to be reinserted.

Use an explicit URL marker, such as `tableFilters=explicit`, to distinguish an intentionally persisted table state (including all-default filters) from a legacy bare import-report link. Teach URL serialization/restoration to round-trip it. Apply import defaults once for a bare `/?view=import&importId=...` link, then serialize an explicit state. Preserve supplied valid filter parameters on links; do not overwrite them with entry defaults. Import success should continue to write the complete initial currency/account/importGroup state immediately.

Keep filter parsing pure and testable. Do not make data refresh rerun first-entry initialization or turn currently invalid user input into a broader valid view. Retain real-date/amount validation and safe malformed-URL notices. Update labels on the results table when the user clears/switches its import filter: it must not claim all visible transactions were added by the report being displayed.

Acceptance tests:

1. Open a bare import report: default to that import's account/currency/new rows.
2. Clear filters there, refresh data, reload the URL: the table remains at the current currency's full set; the same historical report remains visible.
3. Change account or currency incompatibly: group clears with notice and stays cleared after restoration.
4. Select rows, then Back/Forward to different filters: selection clears with notice before another action is enabled. Include default and empty-result views.
5. Page changes preserve selection; unchanged-filter refresh intersects existing matching IDs and reports removals.
6. Invalid filters never enable a bulk action against a silently broadened result set. Test restoration and refresh interactions.

## Step 4 — Add deterministic server integration and race coverage (G6)

Build the missing harness rather than marking its absence as an accepted limitation again. Inspect `app/api/categorize/route.ts`, `lib/reviews-server.ts`, `lib/categories-server.ts`, `lib/operations-server.ts`, and existing migration/API tests.

Extract the production categorization service behind a server-only seam with injected database, authenticated owner, configuration, and Responses transport. The route retains identity/origin/body validation and invokes that same service. Tests must exercise the production SQL, validation, and receipt code; do not duplicate their logic inside fake service implementations. Never add fake-model request parameters, auth bypasses, or a production endpoint for test setup.

Use Node's existing test runner. A SQLite-backed D1 adapter is acceptable if it executes actual prepared SQL with bindings and provides real transaction rollback for `batch`; use a disposable local D1 runtime to additionally establish runtime compatibility at 60 targets. Enable foreign keys and apply the real migrations to synthetic fixtures. No dependency-heavy component framework is required. Service-local imports must work with the documented test command.

Use a deferred promise in the mock transport to pause after context/target capture, run a competing production mutation against the same synthetic database, and release the response. Synchronize using promises, not timing sleeps.

Required matrix:

| Scenario | Evidence required |
| --- | --- |
| Mixed successful 60-target batch | All submitted IDs get exactly one outcome; eligible rows increment revision once; manual/reviewed rows stay unchanged; no AI rows become review-memory examples |
| All protected/unavailable, including another owner | No provider request; indistinguishable unavailable IDs; correct durable receipt; other owner's state unchanged |
| Invalid JSON, missing/duplicate/unknown IDs, unknown categories/citations, malformed result entries, incomplete output | Controlled error; no target writes or success receipt |
| Provider error/timeout | No target writes or success receipt; client recognizes known non-commit versus transport uncertainty appropriately |
| Manual review during inference, including reviewed Uncategorized | `stale_context`; no partial AI writes; human review/projection remains authoritative |
| Category definition change during inference | `stale_context`; no stale definitions committed |
| Deletion during inference | `stale_context`; no resurrection or partial writes; retained history and active-memory rules hold |
| Sub-description enrichment or competing categorization | Captured target revision blocks stale writes |
| Receipt replay after response loss and after a later manual edit | Exact saved outcome; no new provider call for an already committed receipt; newer edit preserved |
| Same operation ID with different IDs | `operation_conflict`; no additional writes |
| Concurrent duplicate operation requests | At most one mutation batch commits; authoritative replay result; inference may be duplicated |
| Induced SQL failure after receipt insertion or an earlier row update | Persisted state proves complete rollback, including receipt absence and unchanged target revisions |

Read transactions, revisions, review projections/events, context revision, and receipts after race/rollback tests. Distinguish the expected effects of the competing mutation from forbidden AI effects. Verify context capture ordering before category/target/memory reads. Include null-timestamp migrated review protection. Correct defects exposed by these tests within this scope.

## Step 5 — Integrated verification and handoff

Keep tests next to the existing `.test.mjs` files. Add controller tests for the actual orchestration used by the dashboard, not just arithmetic helper tests. Verify both toolbar call sites use the authoritative controller and navigation lock.

Run:

```sh
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Inspect `tests/api-smoke.mjs` before running it against an explicitly disposable local server/database; it performs mutations. Run the relevant existing API smoke cases and the new local D1 checks. Do not run live-provider scripts as a substitute for mocks or mutate real accounting records.

Perform targeted browser interaction checks on synthetic local data: categorize then delete, disable competing actions, definitive delete failure recovery, dropped-response recovery, stop/resume totals, clear import filters then reload, and Back/Forward selection clearing. Use a test-only runtime/transport fixture for failure scenarios, not a production bypass. If browser access is unavailable, report those checks as unperformed; passing pure tests is not a browser-QA claim.

End-to-end fixture: create a generic account → import more than 60 rows → inspect the report → select across pages → categorize with mocked AI → review a row → delete across batches with failure/recovery → re-import. Confirm archived-account restrictions, second-owner isolation, durable reports, and unchanged review-memory protections.

Create `07-workflow-gap-remediation-completion.md` with one row for G1–G6 linking the implementation and exact regression evidence, command outcomes, runtime used for database checks, any contract changes, and remaining limitations. Update public usage documentation only where the resulting retry/navigation behavior needs explanation. Do not claim all six gaps closed while the required deterministic inference/race harness is missing. Preserve the historical completion notes rather than rewriting their original verification claims.
