# Plan 7 completion — workflow gap remediation

Implemented one authoritative bulk-operation workflow, exact ambiguous-request recovery, explicit URL filter restoration, and deterministic production-service categorization/race coverage. No schema migration or live model call was required.

## Gap closure

| Gap | Implementation | Regression evidence |
| --- | --- | --- |
| G1 — one authoritative bulk lock | [`BulkOperationController`](../../lib/bulk-operation.ts) owns the active delete or categorization operation, applies a synchronous start guard, and drives both toolbar surfaces and dashboard mutation locks. Completed summaries cannot mask a later active operation. | [`bulk-operation.test.mjs`](../../tests/bulk-operation.test.mjs) covers categorize→delete, delete→categorize, and double starts. |
| G2 — ambiguous recovery | Every sent batch retains immutable IDs, UUID, status, and outcome. Unknown commit state remains `unresolved`; recovery resends the exact request before unsent work. Stale context creates a new deliberate retry identity, while operation conflicts remain terminal. | Controller tests cover lost delete and categorization responses, pre-send loss, stop during uncertainty, stale context, conflicts, and exact receipt replay. [`categorization-server.test.mjs`](../../tests/categorization-server.test.mjs) proves replay after later manual edits causes no new mutation. |
| G3 — delete failure releases busy state | Definitive known non-commit errors release the active lock and retain retryable work. Atomic D1 delete failures now return `delete_not_committed`; unknown/proxy/transport outcomes remain unresolved. Refresh is a separate retry that never repeats a committed mutation. | Controller tests cover definitive later-batch failure and refresh failure. Service tests induce delete batch failure and prove transaction/receipt rollback. |
| G4 — explicit, selection-safe restoration | Serialized table state carries `tableFilters=explicit`, including a deliberately cleared/default state. Bare legacy import-report links apply their account/currency/import defaults once. Normalized real filter changes clear selection and reset the page; unchanged refresh still intersects selection. Running or unresolved mutations defer in-app and Back/Forward navigation. | [`transaction-filters.test.mjs`](../../tests/transaction-filters.test.mjs) covers bare entry, explicit clear/reload, legacy supplied filters, invalid filters, and restoration. Existing selection tests cover page preservation and refresh intersection. Interactive local QA confirmed `?tableFilters=explicit&q=QA` → clear → reload remains `?tableFilters=explicit` with an empty search field. |
| G5 — cumulative retries | The controller retains the original total, resolved batch outcomes, unavailable/protected counts, and remaining work across stop, failure, recovery, and resume. A resolved batch is counted once even when its receipt is replayed. | Controller tests cover 80 deletes with 50 committed before failure and 121 categorizations across stop/resume. |
| G6 — production AI integration/races | [`categorization-server.ts`](../../lib/categorization-server.ts) contains the production service behind injected D1, owner, configuration, and Responses transport seams; the route keeps authentication/origin/body validation and invokes it. Tests use actual production SQL, real migrations, transaction rollback, deferred-promise races, and mocked Responses payloads. | [`categorization-server.test.mjs`](../../tests/categorization-server.test.mjs) covers mixed 60-target success, protected/foreign targets, invalid output, provider failures, manual/category/delete/enrichment/competing-write races, replay/conflict/concurrent duplicate requests, context-read order, and induced SQL rollback. |

## Contract changes

- Client request failures preserve HTTP status, stable application code, and commit certainty. Network failures, malformed success responses, and unclassified server failures are unresolved rather than assumed safe to repeat.
- Known provider failures use stable `provider_not_configured`, `provider_transport`, `provider_rate_limit`, `provider_auth`, `provider_unavailable`, or `provider_output` codes. Proven atomic delete rejection uses `delete_not_committed`.
- The delete limit remains 50 IDs, categorization remains 60 IDs, endpoint request and success response shapes remain unchanged, and owner scoping/origin/authentication checks are preserved.
- Recovery state remains in memory for the mounted application. Full reload or tab-close persistence is intentionally outside Plan 7; transaction payloads are not written to browser storage.
- `importId` continues to identify the historical report, while `importGroup` controls the transaction table. Clearing or changing the table filter no longer changes the report identity or produces a misleading report-row label.

## Verification

- `node --experimental-strip-types --test tests/*.test.mjs` — 70 passed, 0 failed. This included a disposable Miniflare/workerd D1 instance for the real 60-target compatibility check; the remaining database integration tests used Node SQLite with foreign keys, all real migrations, and transactional D1 batch behavior.
- `BASE_URL=http://localhost:3017 node tests/api-smoke.mjs` — passed against a separate disposable repository copy and D1 database with no `.env.local`, so it neither changed workspace accounting data nor called a live model. It covered sign-in/origin isolation, account/import/report flows, receipt-backed deletion/re-import, review replay protection, categorization replay/conflict, and unavailable-AI behavior.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; all page and API routes compiled.
- `git diff --check` — passed.
- Interactive local browser check — dashboard rendered with no console errors; non-default search serialized the explicit marker, and clearing then reloading preserved the deliberately empty filter state.

The ambiguous response, forced failure, race, rollback, cross-page total, and stop/resume cases were verified through the production controller/service harness rather than a browser-only test endpoint. No production auth bypass or fake-model request parameter was added. A single browser session did not repeat the entire synthetic end-to-end matrix; HTTP integration and deterministic service/controller tests provide that coverage without exposing a runtime test bypass.

No deployment was performed: Plan 7 requested implementation and verification, and its scope explicitly excluded deploying merely to publish the plan.
