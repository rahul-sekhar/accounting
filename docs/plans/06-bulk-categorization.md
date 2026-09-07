# 06 — Selection-driven bulk AI categorization

Depends on: [05](05-selection-and-deletion.md).

## Outcome and eligibility

Remove the standalone auto-categorization box and global uncategorized action. Users select transactions and choose **Categorize selected** in the bulk toolbar. Import never starts categorization automatically.

| Selected row | Behavior |
| --- | --- |
| Never categorized (`source='none'`) | Eligible |
| Unreviewed AI suggestion (`source='ai'`, no current review) | Eligible for rerun; disclose how many suggestions may be replaced |
| Manually assigned or explicitly reviewed | Protected; skip and report count |
| Missing/deleted/unowned before inference | Report as unavailable; never recreate or distinguish ownership |

Check reviewed status using the actual review projection, not only `reviewed_at`, because migrated reviews can have a null timestamp. Reviewed Uncategorized rows remain protected. Manual category dropdowns and explicit category acceptance remain available. A bulk manual-category assignment tool and overriding reviewed decisions are outside this plan.

## Current code to inspect

`app/dashboard.tsx` currently batches every `source='none'` transaction in groups of 60 and has an AI confirmation dialog. `app/api/categorize/route.ts` accepts IDs but restricts both reads and guarded writes to `source='none'`. It already uses review memory, category/context revisions, strict output validation, and evidence snapshots. Inspect every eligibility predicate, not only the first query.

## Work steps

Read [Implementation contracts](implementation-contracts.md), especially the receipt, context-capture ordering, and bind-count sections. Expose an explicit `has_review` boolean from the current review projection in `/api/data`; client eligibility is `source in {'none','ai'} && !has_review`. The server applies the equivalent owner-scoped `NOT EXISTS` review predicate. Do not infer this boolean from `reviewed_at` or `memory_enabled`.

Build batches from the captured selected IDs and let the server classify each as eligible/protected/unavailable authoritatively; client counts are a preview. Return one disjoint outcome for every submitted ID on success. `categorized = categorizedIds.length`. A batch with no eligible rows succeeds without a provider call. If a previously eligible target becomes missing/protected or changes revision **during inference**, fail the entire eligible write set with 409 `stale_context` and no success receipt, rather than silently applying the rest.

Read context revision before categories/targets/memory and guard it at commit. Guard against sub-description enrichment from Plan 3 using target revisions as well. The current query's large repeated CASE/IN binding lists require a runtime-limit check and likely SQL restructuring or smaller batches; do not assume its existing 60-ID input validator proves it works at 60.

1. Replace global categorization UI/state with the shared selection toolbar. Show selected, eligible, protected, and rerun counts before starting. Reuse concise existing AI disclosure where applicable; unavailable AI explains why the action is disabled.
2. Define one consistent eligibility rule for client counts and server enforcement. Extend server targeting to unreviewed AI suggestions while preserving manual/review protection. Update final conditional writes as well as initial reads.
3. Capture selection once and submit selected IDs in sequential batches of at most 60; the server processes the eligible subset and returns the other outcomes. Show completed/remaining/failed/protected counts. Filters and selection must not silently retarget an in-progress operation.
4. Preserve active category IDs, archived-category exclusion, input masking, request-local account references, bounded review memory, evidence citations, `store:false`, and configured model use. AI assignments must not become review-memory examples without an explicit human review.
5. Keep transaction revision and owner context revision guards atomic. If a manual review, deletion, or category change happens during inference, return the existing retryable conflict semantics without stale partial writes. Report the batch result honestly.
6. Add operation identity/replay handling sufficient for retry after an ambiguous network response: a committed batch replay must return its recorded result instead of rerunning and replacing suggestions again. Do not retain raw prompts or responses solely for replay.
7. Allow stopping before the next batch, with completed work retained. On retry, process only failed/unprocessed batches after refreshing eligibility. Do not automatically retry permanent validation errors or loop on conflicts.
8. Refresh table categories, confidence, evidence, revisions, summary totals, and needs-review indicators. Preserve a clear completion summary even if changed categories no longer match the current filter.
9. Remove obsolete uncategorized-global UI code and update README instructions. Keep review-memory explanation and manual category functionality accurate.

## Acceptance and verification

- Select more than 60 transactions across pages; only those captured IDs are considered. Unselected uncategorized rows remain untouched.
- Mixed selection processes new rows and unreviewed AI suggestions, reports protected reviewed/manual rows, and never overwrites them, including migrated reviews with null timestamps.
- Mock model results to verify multiple batches, invalid outputs, unknown categories/citations, a later batch failure, stopping, ambiguous-response replay, and retry without double processing.
- Concurrent manual review, category-definition change, or deletion blocks stale AI writes. AI suggestions do not increase active review-memory counts.
- No selection/all-protected selection/AI unavailable each has a useful state. Import alone makes no categorize request.
- Run focused endpoint tests, existing review-memory and banking tests, type check, lint, and build. Use a bounded synthetic live check only if needed for the changed model integration.

## Final integration handoff

Run the end-to-end scenario in the index with synthetic data. Report completion of all six plans, migrations and deployed/runtime validation as applicable, remaining limitations, and the final account/import/filter/selection semantics. Do not claim browser QA or live AI verification unless actually performed under applicable instructions.
