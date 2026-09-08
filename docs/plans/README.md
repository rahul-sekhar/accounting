# Transaction workflow implementation plans

Implementer: GPT 5.6 Sol (`gpt-5.6-sol`). Project: `/Users/rahul/Documents/ChatGPT/Accounting`.

These plans follow the six-part division approved by the user. Execute them in order, finishing each plan's verification and handoff before starting the next. This directory is a planning deliverable; its creation does not implement or deploy these changes.

| Order | Plan                                                             | Result                                                                   |
| ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1     | [Generic accounts and no balances](01-generic-accounts.md)       | Bank-independent account management and transaction-only reporting       |
| 2     | [Imported amount direction](02-amount-direction.md)              | Verified AI-to-preview-to-save direction handling                        |
| 3     | [Import outcomes and duplicates](03-import-outcomes.md)          | Persistent row outcomes and a post-import results page                   |
| 4     | [Transaction filters and import view](04-transaction-filters.md) | Combined filters, separate sub-description column, automatic import view |
| 5     | [Selection and bulk deletion](05-selection-and-deletion.md)      | Stable selection across pages and bounded, safe deletion                 |
| 6     | [Bulk categorization](06-bulk-categorization.md)                 | Selection-driven AI categorization with progress and retry handling      |

## Post-implementation remediation

[07 — Workflow gap remediation](07-workflow-gap-remediation.md) was implemented on 2026-09-07. It closes the bulk-operation locking and recovery, cumulative retry totals, filter/selection restoration, and deterministic AI integration/race-test gaps. See the [Plan 7 completion note](07-workflow-gap-remediation-completion.md) for exact evidence and remaining verification boundaries.

## Shared implementation rules

Read [Implementation contracts](implementation-contracts.md) before any numbered plan. It resolves endpoint, retry, transaction, and test-harness choices shared across plans. Each numbered plan is a vertically complete change; implement its API, migration, UI, and tests together. Do not leave placeholder endpoints for a later plan.

- Inspect the current checkout and applicable AGENTS.md and Sites skills before implementation. Preserve the existing app, authentication, deployment identity, dependencies, and unrelated behavior. Refactor the large dashboard only where it makes these changes easier to maintain.
- New requirements supersede conflicting scope exclusions in the historical `docs/ai-review-memory-plan.md`, if still present, especially its old restriction to uncategorized transactions. Current code and the preservation rules in these plans are authoritative; do not require that historical document to exist. Preserve review-memory integrity and privacy.
- Existing bank names stored as user account data remain valid. Remove product assumptions and branding, not legitimate user data or historical migration contents.
- Use integer cents and the existing sign convention: positive is money in, negative is money out. Debit/credit filters refer to that convention, not double-entry bookkeeping. Keep CAD/USD separation and existing refund, transfer, and investment category semantics; generic bank support does not mean currency conversion or brokerage accounting.
- Add new migrations; never rewrite applied migrations or snapshots. Inspect generated SQL and test upgrades with populated synthetic data. Do not reset databases or remove real transactions to make tests pass.
- Scope every read and mutation by the authenticated owner. Preserve origin checks, input validation, optimistic concurrency, and AI context guards. Treat imported text and model outputs as untrusted data.
- Keep original CSV retention unchanged: do not persist the original file or arbitrary unmapped columns. Import reporting may retain only the normalized fields needed to explain outcomes.
- Reuse the app's existing configured AI connection under applicable credential guidance. Never expose secrets. Deterministic tests must not require live AI. If a live diagnostic is used, keep it synthetic and bounded and report it separately.
- No bank connectors, balance calculations, exchange rates, fuzzy duplicate removal, import undo, scheduled categorization, or framework replacement are included.

## Cross-plan contracts

1. Account IDs and transaction IDs remain stable. Archive hides an account from new import choices, not its historical transactions.
2. `transactions.import_id` remains the import that originally created a transaction. Later duplicate matches do not replace it. Import-row outcome records describe later encounters separately.
3. The import-group transaction filter means **transactions newly added by that import and still present**. Duplicate matches appear in the results page with their recorded actions. Historical outcome counts remain unchanged after deletion.
4. On import completion, show an import results page. Plan 4 adds the automatically filtered transaction table to that page, so both the duplicate report and imported transactions are immediately available without a competing redirect.
5. Filters define a complete result set before pagination. Selection captures explicit transaction IDs from that set. Page changes preserve selection; changes to any filter clear it with a visible notice.
6. Bulk actions operate on a captured selection, not a live query that could grow while the action runs. Plan 5 establishes the shared selection and bounded operation UI; Plan 6 reuses it.
7. Manual/reviewed categories remain protected from AI overwrite. Bulk AI supports uncategorized rows and rerunning unreviewed AI suggestions; reviewed rows are explicitly reported as skipped.
8. Plan 3 owns import operation receipts; Plan 5 adds delete receipts using the shared mechanism; Plan 6 adds categorization receipts. Plan 1 must not import or reference tables that will only be introduced later. When Plan 3 adds retained history, extend the account deletion guard in that same plan.

## Requirement coverage

| User request                                               | Owning plan                  |
| ---------------------------------------------------------- | ---------------------------- |
| Sub-description field in table                             | 04                           |
| AI amount-direction check                                  | 02                           |
| Generic bank support                                       | 01                           |
| Remove balances                                            | 01                           |
| Post-import duplicate/actions page                         | 03, integrated table in 04   |
| Filter by import and automatically show it                 | 04, using provenance from 03 |
| Selection and delete across all filtered pages             | 05                           |
| Replace auto-categorization box with bulk operation        | 06                           |
| Manage accounts                                            | 01                           |
| Search, direction, amount, category, account, date filters | 04                           |

## Verification and handoff

Each plan owns its tests; do not defer all verification to Plan 6. Use synthetic fixtures and local integration data. At each handoff record changed files, migrations, exact checks and outcomes, unresolved limitations, and any API contract changes in that plan's implementation notes or an adjacent completion note.

Run relevant existing tests plus focused new cases, type checking (`npx tsc --noEmit`), lint (`npm run lint`), and the production build (`npm run build`) as applicable under current project instructions. Existing runnable tests include `tests/banking.test.mjs`, `tests/review-memory.test.mjs`, `tests/api-smoke.mjs`, and `tests/category-mapping-smoke.mjs`; inspect them before running because some require a local server or make live AI calls. Update outdated balance expectations and clean up only test-created records.

At the end, verify the full scenario: create a generic account → import → inspect duplicate actions and imported rows → combine filters → select more than one page → categorize → review → bulk delete → re-import. Verify archived accounts and a second user's isolation. Follow applicable Sites validation and hosting instructions during implementation; do not deploy merely to publish these plan documents.
