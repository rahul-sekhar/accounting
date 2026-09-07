# 02 — Verify and fix imported amount direction

Depends on: [01](01-generic-accounts.md).

## Outcome

AI mapping applies its amount-direction suggestion to the control, parsed preview, and saved transaction amounts consistently. Ambiguous evidence is clearly described. Manual changes remain authoritative.

The current code already calls `setMapping(result.mapping)` and the server accepts `normal`/`reverse`. Do not assume a missing assignment or solve the symptom with an unconditional sign flip. Establish the failure first.

## Current code to inspect

`app/dashboard.tsx`: `loadFile`, `aiMapping`, `mappingRun`, `changeMapping`, account selection, mapping controls, preview, and `saveImport`. `app/api/map-csv/route.ts`: prompt, structured output, validation, mode reconciliation. `lib/banking.ts`: `suggestMapping`, `mapTransactions`, money parsing, and signed/split handling. `app/api/import/route.ts`: final parsing and persistence. Tests: `tests/banking.test.mjs`, `tests/category-mapping-smoke.mjs`.

## Work steps

Use these deterministic fixtures as the minimum direction oracle; values shown are cents after parsing:

| Layout/input | Normal | Reverse |
| --- | --- | --- |
| Signed `-12.34` | -1234 | 1234 |
| Signed `12.34` | 1234 | -1234 |
| Split debit `12.34`, credit blank | -1234 | 1234 |
| Split debit blank, credit `12.34` | 1234 | -1234 |
| Split debit `-12.34`, credit blank | -1234 | 1234 |
| Split debit blank, credit `-12.34` | 1234 | -1234 |
| Signed `0.00` | 0 | 0 |

The current split parser uses absolute values for each column, then subtracts debit from credit before applying reverse. Preserve that behavior unless evidence requires a separately documented parser correction. Do not silently reinterpret negative split credits as debit. A card-spending fixture with signed `12.34` and a clearly identified refund `-3.00` should use reverse, yielding -1234 and +300. An all-positive file without directional evidence must remain uncertain rather than manufacturing a refund/spending distinction.

Normalize negative zero. Add explicit both-split-columns-populated and both-blank cases; document the existing behavior and preserve it unless invalid-data handling needs a deliberate correction. If sampling changes, keep the endpoint's existing row-count/payload cap and select representative rows deterministically within it. State/request cancellation tests must cover changing account context while AI is pending and an unavailable-AI fallback.

1. Build synthetic examples for normal signed money, positive-spending card exports, separate debit/credit columns, signed values within split columns, refunds, zero amounts, and ambiguous all-positive samples. State expected normalized cents for every row.
2. Trace the complete mapping lifecycle using deterministic mocked AI responses. Check whether sign is ignored, overwritten by defaults, mismatched with split mode, or stale after account/file/manual changes. Record the actual cause, or state that deterministic wiring works and the issue is suggestion quality/sample evidence.
3. Fix the demonstrated failure. Ensure mapping requests use current account type/institution. Invalidate stale requests when file, account context, or manual mapping changes. Do not let delayed AI responses replace manual choices.
4. If sample quality is the cause, use a bounded representative sample that includes available sign/debit/credit variation instead of blindly relying on the first five rows. Keep payload limits and data minimization explicit; do not send the whole CSV. Avoid merchant-name guesses as proof of direction.
5. Keep sign choices understandable with money-in/money-out preview labels. Both signed and split modes must follow the same documented normal/reverse semantics. Surface low-confidence direction evidence and allow correction before saving.
6. Prevent save while an automatic suggestion is actively changing the mapping, or explicitly cancel that suggestion before permitting a manual save. Server parsing must use exactly the reviewed mapping.

## Acceptance and verification

- A mocked `reverse` response changes the visible control and expected preview amounts; import persists those exact amounts.
- `normal` and `reverse` both work for each supported layout. Refunds are not automatically treated as spending simply because the account is a credit card.
- A delayed response from an older file/account cannot change the current mapping. A manual override survives pending responses.
- Ambiguous direction is identified as uncertain; malformed AI results preserve a usable manual workflow.
- Re-importing with the same confirmed mapping remains deduplicated. Do not retroactively flip existing transactions or change fingerprints in this plan.
- Add pure parsing and mapping-lifecycle regression tests. Use at most a small synthetic live diagnostic if needed; report observations without claiming universal AI accuracy. Run relevant checks and build.

## Handoff

Record root-cause evidence, supported sign semantics, sample strategy, and any remaining ambiguity. Existing incorrectly imported amounts require a separate deliberate user correction; do not silently repair historical data.
