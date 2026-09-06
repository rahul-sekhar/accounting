# Account View

Private Scotiabank and Wealthsimple CSV account dashboard, built with React/Vinext on Sites. ChatGPT sign-in and owner-only hosting protect the workspace. Every API query is scoped to the authenticated user; anonymous API requests are rejected.

## Supported workflow

- Upload a CSV for a new or existing account. Match columns, choose date format and debit/credit direction, review five sample rows, then save.
- Store parsed transactions and import history in D1. Original CSV files are not retained. Limits: 5 MB and 2,000 rows per import. Separate accounts and currencies into distinct exports.
- Overlapping imports match date, normalized description, amount and repeated occurrence number within an account. Identical repeated rows in a single export remain separate. Export complete days: partial-day identical transactions cannot be uniquely distinguished without bank transaction IDs.
- Track explicit balance snapshots with their dates. Transaction imports do not imply a current balance or automatically update snapshots. Enter debt as a negative balance.
- View CAD and USD separately; no exchange-rate conversion. Filter by account, month, and category. Refunds reduce their spending category after categorization. Transfers and investment trades are excluded from income/spending. Uncategorized inflows provisionally count as income and need review.
- AI suggests categories using OpenAI Responses with a strict JSON schema. Only descriptions (long numeric references masked), integer amounts, currency, opaque request-local account references and account type are sent, with `store: false`. AI does not receive owner identity, account nicknames, dates, or the entire CSV. Descriptions themselves may contain personal information. Manual category changes are preserved. Low-confidence suggestions are flagged for review.
- Explicit corrections and **Accept category** confirmations become review examples by default. **Use for future categorization** can exclude or restore each review without changing the transaction category. This is bounded reference-based personalization, not model training, and future matches are not guaranteed.

## Runtime

The Sites manifest declares `DB`; generated Drizzle migrations live in `drizzle/`. Do not change applied migrations. `OPENAI_API_KEY` must be configured as a hosted secret before AI is available. Optional `OPENAI_MODEL` defaults to `gpt-4.1-mini`. No key is bundled or exposed to the browser. Authorized local secret destination is `.env.local` (ignored); the app uses the approved API key configured as a hosted secret.

`npm run dev` starts the local Sites preview. Its built-in local sign-in is development-only. `npm run build` builds the Cloudflare Worker and copies the manifest/migrations. `npx drizzle-kit generate` generates schema migrations.

## Verification

`node --experimental-strip-types --test tests/banking.test.mjs` covers CSV quoting, multiline fields, headerless exports, date ambiguity, malformed rows, debit/credit signs, cents, duplicate occurrences and refund/transfer calculations.

`node tests/api-smoke.mjs` exercises local sign-in, saving and re-importing synthetic transactions, persisted edits/balances, invalid data/currency, missing account IDs and unauthenticated/cross-origin rejection. It uses only localhost and creates a disposable synthetic account; remove that account from the local test database after the run. Local migration configuration is kept under ignored `.wrangler/`.

Type-check and production build passed. Browser interaction/visual QA was not requested and was not performed. The optional WebMCP `start_bank_csv_import` opens the same import dialog without uploading or saving. No supported WebMCP test context was exposed, so its live registration remains unverified. Live AI classification was verified with synthetic transactions. No real bank export has been supplied; the import review handles differing column names and signs explicitly.

## Categorization memory

Every review appends an immutable owner-scoped event and replaces that transaction's current review projection. Repeated edits therefore remain visible in history but contribute at most one active example. Review writes use operation IDs for retry idempotency and transaction revisions for optimistic concurrency. AI writes are guarded by both the target revisions and an owner-scoped context revision, so a concurrent review or category-definition change causes a retryable conflict rather than a stale partial save.

Memory normalization is deterministic and versioned (`v1`): Unicode NFKC, locale-aware case folding and whitespace normalization. Its conservative grouping key retains description, sub-description, account, account type, currency and inflow/outflow/zero direction. Digits and merchant/recipient wording are preserved. Conflicting categories remain alternatives in one indivisible cluster. Category names and types are resolved from current stable category IDs; archived and Uncategorized examples are excluded from prompts.

The serialized review reference is capped at 16,000 UTF-8 bytes. Small memories are included completely; larger memories are selected deterministically by exact context, exact description, then lexical overlap, with support and recency only as tie-breakers. Whole conflict clusters are either included or omitted. AI results may cite only supplied memory IDs, and a bounded evidence snapshot is stored with the suggestion for the “AI cited your previous reviews” disclosure. It is evidence provenance, not raw reasoning or proof of causation.

Existing manual assignments are migrated in idempotent batches of up to 100. The normal first load runs one bounded batch of 50 and never overwrites a newer review; the endpoint can be repeated until it reports completion. Legacy rows retain an unknown (`null`) original review time and are labeled as migrated prior decisions.

`node --experimental-strip-types --test tests/banking.test.mjs tests/review-memory.test.mjs` covers deterministic normalization, ten-review condensation, context separation, exclusions, whole conflict clusters, non-ASCII byte limits and stable selection. `node tests/api-smoke.mjs` also verifies idempotent operation replay, conflicting operation reuse, stale revision rejection and memory exclusion using synthetic local data.

The bounded synthetic live evaluation in `tests/review-memory-live-eval.mjs` uses three one-transaction calls and no bank data. In the recorded run, the no-memory café case selected the conventional business category at high confidence; after one explicit counter-conventional review it selected Education at high confidence and cited one review. The equal-context Amazon conflict was saved at low confidence. Input usage was 2,076, 2,217 and 2,445 tokens respectively (141-token personalized overhead for the matched café call); observed request latency was 2,879 ms, 1,088 ms and 1,063 ms. These are observations from one bounded run, not an accuracy guarantee or stable performance benchmark.

## CSV mapping and category management

AI mapping receives CSV headers and up to five sample rows and suggests the date, description, optional sub-description, amount layout, sign direction and date format. All suggestions remain editable. Server validation checks the proposed fields and sample data; uncertain dates are flagged. Manual mapping stays available on AI failures.

Sub-descriptions are stored separately, displayed below the primary description, and included in categorization. The existing duplicate identity remains unchanged so old exports do not duplicate on re-import. A matching row can gain a previously missing sub-description; existing nonempty detail and category edits are preserved.

Category management supports adding, renaming, changing type, archiving and restoring. Stable category IDs preserve existing assignments on rename. Archived categories are excluded from new assignments and AI suggestions but keep their historical labels and totals. Uncategorized remains available as the permanent fallback. Custom categories are scoped to the signed-in user and supplied to AI with their types.

`node tests/category-mapping-smoke.mjs` uses synthetic local data to verify live AI CSV mapping, sub-description enrichment, custom AI categories, and category rename/archive/restore. Remove its printed QA account/category IDs from the local test database afterward.
