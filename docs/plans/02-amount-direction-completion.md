# Plan 2 completion — imported amount direction

Completed: 2026-09-06.

## Root cause and resolution

The existing `normal`/`reverse` value already flowed from the AI response into the mapping control, `mapTransactions`, the preview, and `/api/import`. The deterministic sign math was not being overwritten. The reproducible weaknesses were suggestion quality and stale context: mapping sent only the first five rows, and changing the selected account, institution, or account type did not invalidate an in-flight AI response.

Mapping now selects no more than five deterministic representative rows, prioritizing positive, negative, zero, debit-only, credit-only, both-populated, both-blank, and explicit direction evidence before filling across the file. Cells remain capped at 500 characters and the full CSV is never sent to the mapping endpoint. File, account-context, and manual mapping changes invalidate and abort pending suggestions. Save remains disabled while a suggestion is active.

Uniform signed samples without explicit transaction-direction evidence are surfaced as low-confidence rather than treated as proof. The preview labels every normalized amount as “Money out,” “Money in,” or “Zero.” Manual direction changes remain authoritative.

## Supported semantics

- Signed normal: preserve the parsed sign; reverse: multiply it by `-1`.
- Split normal: `abs(credit) - abs(debit)`; reverse: negate that result.
- Negative values in a split column retain the column's debit/credit meaning.
- If both split columns contain values, their absolute values are netted. If both are blank, the row is rejected. These existing behaviors are now explicit regression cases.
- Zero is normalized to positive JavaScript zero under either direction.
- Fingerprints still use the confirmed normalized amount. Existing transactions are not changed, and re-importing with the same mapping remains deduplicated.

## Verification

- `node --experimental-strip-types --test tests/banking.test.mjs tests/import-mapping.test.mjs tests/review-memory.test.mjs` — 23 tests passed. Direction fixtures cover signed positive/negative/zero, normal/reverse, split positive/negative cells, both populated, both blank, representative sampling, low-confidence evidence, and stale suggestion gates.
- `BASE_URL=http://localhost:3001 node tests/api-smoke.mjs` — passed against the disposable local D1 database. A reverse card fixture persisted `12.34` as `-1234` cents and a `-3.00` refund as `+300` cents, then re-imported as two skips. The unavailable-AI response remains a manual-workflow `503`.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; all page and API routes built.

No migration or endpoint contract changed. No live-provider diagnostic was run, so the implementation does not claim universal AI suggestion accuracy. Historical transactions with an incorrect direction are intentionally unchanged and require a separate correction workflow.
