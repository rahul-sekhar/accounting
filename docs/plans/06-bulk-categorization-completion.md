# Plan 6 completion — selection-driven bulk AI categorization

Implemented selection-driven categorization with authoritative server eligibility, guarded atomic writes, durable replay receipts, and sequential client progress.

## Delivered contracts

- The standalone global categorization panel was removed. Both the main transaction table and import-results table use the shared cross-page selection toolbar.
- The toolbar previews selected, eligible, protected, and rerun counts. Categorization captures explicit selected IDs, uses batches of at most 60, supports stop-before-next-batch, and retains only failed or unprocessed work for retry.
- Client eligibility is `source in {'none','ai'} && !has_review`. `/api/data` exposes `has_review` from projection existence, protecting migrated reviews whose timestamp is null.
- `POST /api/categorize` accepts `{operationId,ids}` and returns disjoint `categorizedIds`, `protectedIds`, and `unavailableIds`, plus the compatible numeric `categorized` field and `replayed`.
- Owner-scoped server classification protects manual and reviewed transactions, permits rerunning unreviewed AI suggestions, and treats unknown, deleted, and other-owner IDs identically as unavailable.
- All-protected and all-unavailable batches succeed without an AI request. AI-unavailable eligible work returns a useful error while manual category controls remain available.
- The owner context revision is captured before categories, targets, and review memory. Receipt insertion is guarded by the unchanged context, each target revision, current eligibility, and absence of a review.
- Receipt insertion and low-bind-count per-row writes execute in one D1 batch. A stale review, category edit, deletion, enrichment, or target change leaves no success receipt or partial AI write and returns `409 stale_context`.
- Categorization receipts are owner-scoped and hash sorted unique IDs. Exact replay returns the committed result without another model call; conflicting reuse returns `409 operation_conflict`.
- Active, non-archived categories, masked references, request-local account aliases, bounded review memory, evidence snapshots, strict output validation, configured model selection, and `store:false` are preserved. AI results do not create review examples.
- Filters, selection editing, imports, row reviews, and competing bulk actions are locked while a categorization batch is running; pagination remains available. Processed IDs leave selection and data is refreshed after every committed batch.

No migration was required because Plan 3's `operation_receipts` table supports the categorization receipt kind.

## Verification

- `tests/transaction-categorization.test.mjs` covers request validation and canonical hashes, new/unreviewed-AI eligibility, 61-row batching, protected and unavailable outcomes, incomplete model-facing results, stopped progress, failed progress, and retry scope.
- The full pure regression run passed 49 tests across selection, deletion, categorization, filtering, banking, review memory, import outcomes/mapping, accounts, and populated migrations.
- `node tests/api-smoke.mjs` passed against local D1. It verifies all-protected/no-provider success, missing and other-owner IDs as unavailable, receipt replay/conflict, `has_review` protection with a null migrated timestamp, and preservation of the other owner's transaction, alongside the existing import/review/delete scenarios.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` passed. The production build includes both bulk endpoints.

The endpoint preserves the existing Responses integration. No live AI accuracy run was performed for this structural workflow change; deterministic state and non-provider endpoint behavior were verified without adding a production bypass. Provider-output and inference-race guards are implemented but were not exercised with a paused mocked transport because this repository has no server-route injection harness.
