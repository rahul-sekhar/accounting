# Account View

Private, institution-independent CSV account dashboard, built with React/Vinext and deployed directly to Cloudflare Workers. Cloudflare Access protects the entire application and the Worker verifies every Access JWT before deriving an owner identity. Every API query is scoped to that verified owner; anonymous API requests are rejected.

## Supported workflow

- Upload a CSV for a new or existing account. Match columns, choose date format and debit/credit direction, review five sample rows, then save.
- Create and edit accounts from any institution. Archive and restore accounts without losing historical transactions; delete only accounts with no retained history. Account type and currency become fixed after history exists.
- Store parsed transactions and durable row-level import outcomes in D1. Original CSV files are not retained. Limits: 5 MB and 2,000 rows per import. Separate accounts and currencies into distinct exports.
- Overlapping imports match date, normalized description, amount and repeated occurrence number within an account. Identical repeated rows in a single export remain separate. Export complete days: partial-day identical transactions cannot be uniquely distinguished without bank transaction IDs.
- After every import, a reloadable results page shows added and matching counts plus the exact action taken for each duplicate. Matching rows may fill a previously empty sub-description but never overwrite an existing detail or category decision. Older imports retain their totals without invented row-level history.
- View CAD and USD separately; no exchange-rate conversion. Combine search, direction, amount, category, account, date, and import-group filters. Refunds reduce their spending category after categorization. Transfers and investment trades are excluded from income/spending. Uncategorized inflows provisionally count as income and need review.
- Select individual rows, a page, or every currently matching transaction across pages. Bulk deletion confirms the captured count and runs in recoverable batches of at most 50; filter changes clear the selection so hidden rows are never silently included. Deletion removes live transactions and active review examples, while immutable review events, import outcomes, aggregate import counts, accounts, and operation receipts remain as private audit history. A later deliberate re-import can add the transaction again with a new ID and does not restore its old reviewed state.
- Select transactions and choose **Categorize selected** to request AI suggestions in recoverable batches of at most 60. New rows and unreviewed AI suggestions are eligible; manual assignments and every explicitly reviewed row are protected and reported as skipped. Progress, stopping before the next batch, receipt-backed retry, and unavailable rows are reported without silently expanding the captured selection. Importing never starts categorization.
- A sent bulk batch whose response is lost stays locked until **Recover sent batch** replays its exact operation ID and transaction IDs. Committed totals survive stop/resume and later-batch failures, and a saved mutation is never repeated just because refreshing the table failed. This recovery state is intentionally in memory for the mounted app only; a full reload or closed tab does not retain the pending payload.
- AI categorization uses OpenAI Responses with a strict JSON schema. Only descriptions (long numeric references masked), integer amounts, currency, opaque request-local account references and account type are sent, with `store: false`. AI does not receive owner identity, account nicknames, dates, or the entire CSV. Descriptions themselves may contain personal information. Low-confidence suggestions are flagged for review.
- Explicit corrections and **Accept category** confirmations become review examples automatically. Per-review controls are intentionally hidden for now. This is bounded reference-based personalization, not model training, and future matches are not guaranteed.

## Runtime

The application runs as a Vinext Cloudflare Worker with static assets and a D1 database bound as `DB` by `wrangler.jsonc`. Generated Drizzle migrations live in `drizzle/`; never edit a migration after it has been applied. `OPENAI_MODEL` defaults to `gpt-4.1-mini`. `OPENAI_API_KEY` is optional, must remain server-side, and is configured as a Worker secret in production. Without it, manual CSV mapping and categorization remain available.

Supported commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Fast Vinext development server |
| `npm run build` | Production Vinext/Worker build |
| `npm run preview` | Build and run the production Worker locally in workerd |
| `npm run cf:typegen` | Regenerate `worker-configuration.d.ts` from Wrangler configuration |
| `npm run db:migrate:local` | Apply all committed migrations to the explicitly named local D1 database |
| `npm run db:migrate:remote` | Apply pending migrations to the explicitly named remote D1 database |
| `npm run deploy` | Build and deploy with the supported Vinext Cloudflare adapter |
| `npm run verify` | Deterministic tests, fresh-D1 check, types, lint, compatibility check, and build |

Use `npx drizzle-kit generate` to generate a new schema migration. The command-line workflow is authoritative; neither Codex nor CI is required to build or release the application.

## Local development

Install Node 22.13 or newer and dependencies, then configure the deliberately separate local identity:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Local identity activates only when `APP_ENV=development`, `LOCAL_AUTH_ENABLED=true`, all synthetic user values are present, and the request host is exactly `localhost`, `127.0.0.1`, or `[::1]`. `.dev.vars` is ignored. Never define any `LOCAL_AUTH_*` variable on a deployed Worker. If native file watching is unavailable, copy `.env.example` to `.env.local`, uncomment `VITE_USE_POLLING=true`, and restart development.

`npm run preview` uses the same local variables and D1 state. Run `node tests/api-smoke.mjs` against a running local server to exercise the complete synthetic API workflow. The live AI scripts are intentionally excluded from default verification.

## Cloudflare bootstrap and release

The repository contains safe placeholders, not account resources. An operator must complete these steps from an ordinary terminal:

1. Log in to the intended account with `npx wrangler login`, then confirm it with `npx wrangler whoami`. In CI, use a narrowly scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` instead.
2. Create the empty production database with `npx wrangler d1 create account-view`. Copy the returned database ID into the `account-view` entry in `wrangler.jsonc`; do not change the `DB` binding or `migrations_dir`.
3. In Cloudflare Zero Trust, create a self-hosted Access application covering every production route: the `workers.dev` hostname, preview hostnames if enabled, and any custom hostname. Start with an Allow policy containing only the explicitly approved email addresses and one-time PIN or an approved identity provider. Do this before entering financial data.
4. Replace `ACCESS_TEAM_DOMAIN` with the exact `https://<team>.cloudflareaccess.com` issuer and `ACCESS_AUD` with the application's Audience tag in `wrangler.jsonc`. Keep `APP_ENV=production`. Do not add local-auth variables.
5. Apply the existing migration chain explicitly with `npm run db:migrate:remote`. Run `npx wrangler d1 migrations list account-view --remote --config wrangler.jsonc` and require “No migrations to apply” before deploying.
6. If AI features are desired, set the secret interactively with `npx wrangler secret put OPENAI_API_KEY --config wrangler.jsonc`. Rotate it by running the same command again. Never put the key in Wrangler variables, a committed environment file, logs, or browser code.
7. Run `npm run verify`, then `npm run deploy`.

The deploy command uses `@vinext/cloudflare`; it builds the application and invokes Wrangler using `wrangler.jsonc`. No live database, Access, or OpenAI call is part of `npm run verify`.

After deployment, use an incognito browser and synthetic data to verify that an unapproved visitor is challenged, an allowlisted address can enter and sign out, `/cdn-cgi/access/logout` clears the application session, and returning requires authentication. Exercise empty state, account creation, import, filtering, categorization, review memory, expense spreading, and deletion. Direct API calls without a valid `Cf-Access-Jwt-Assertion` must return 401. Confirm that HTML, client assets, JSON responses, and logs contain no secret material. `/api/data` reports only `aiReady`, never the key.

Record the Cloudflare account/resource names, D1 database ID, Access audience, policy scope, deployed URL, verification output, and whether live AI was tested with synthetic data in the release handoff. Do not commit the real email allowlist. The existing OpenAI Site is not changed or deleted by this workflow; restrict or retire it only as a separate approved action after cutover.

## Authentication contract

Production identity comes only from `Cf-Access-Jwt-Assertion`. The Worker verifies RS256 signature, exact Access issuer, application audience, expiry/not-before, the signed Access application-token type, and nonempty subject and email claims against the team JWKS. The optional JOSE `typ` header is not used as an identity control. Service tokens are rejected as interactive users. The verified owner key is `cloudflare:<sub>` and the normalized verified email is used for display. The remote JWKS resolver is cached at module scope while retaining JOSE key-rotation behavior.

Cloudflare Access edge policy and application JWT validation are both required. Do not expose the Worker on an alternate unprotected hostname. Sign-out uses the application-domain `/cdn-cgi/access/logout` endpoint.

## Recovery and CI

A code rollback checks out a known-good commit and reruns `npm run verify` and `npm run deploy`. Database recovery uses D1 Time Travel or an export; never roll back by changing or deleting an applied migration. Access can be tightened, sessions revoked, or the application disabled independently of a code rollback. Worker secrets persist independently of source releases and should be rotated rather than committed.

CI is optional. A verification workflow needs only Node and `npm ci`. A production deployment job should use a protected environment, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`; the token needs only the account permissions required for Workers deployment and D1 migration. Do not expose those secrets to pull requests, and never migrate the remote database or deploy production from an arbitrary pull request.

## Verification

`node --experimental-strip-types --test tests/banking.test.mjs` covers CSV quoting, multiline fields, headerless exports, date ambiguity, malformed rows, debit/credit signs, cents, duplicate occurrences and refund/transfer calculations.

`node tests/api-smoke.mjs` exercises the explicit loopback identity, generic account lifecycle rules, saving and re-importing synthetic transactions, invalid data/currency, missing account IDs and unauthenticated/cross-origin rejection. It uses only localhost and creates disposable synthetic accounts; remove those accounts from the local test database after the run. Local migration configuration is kept under ignored `.wrangler/`.

`tests/access-auth.test.mjs` uses locally generated signing keys to cover valid Access identity plus malformed, tampered, expired, not-yet-valid, wrong-issuer, wrong-audience, wrong-type, incomplete, and service-token assertions. It also proves the local identity cannot activate in production or for a non-loopback host. `npm run db:verify:fresh` applies the real migration chain to a disposable local D1 database and checks the migration ledger, tables, owner indexes, and foreign keys.

The optional WebMCP `start_bank_csv_import` opens the same import dialog without uploading or saving. No supported WebMCP test context was exposed, so its live registration remains unverified. Live AI classification was previously verified with synthetic transactions. No real institution export has been supplied; the import review handles differing column names and signs explicitly.

## Categorization memory

Every review appends an immutable owner-scoped event and replaces that transaction's current review projection. Repeated edits therefore remain visible in history but contribute at most one active example. Review writes use operation IDs for retry idempotency and transaction revisions for optimistic concurrency. AI writes are guarded by both the target revisions and an owner-scoped context revision, so a concurrent review or category-definition change causes a retryable conflict rather than a stale partial save.

Memory normalization is deterministic and versioned (`v1`): Unicode NFKC, locale-aware case folding and whitespace normalization. Its conservative grouping key retains description, sub-description, account, account type, currency and inflow/outflow/zero direction. Digits and merchant/recipient wording are preserved. Conflicting categories remain alternatives in one indivisible cluster. Category names and types are resolved from current stable category IDs; archived and Uncategorized examples are excluded from prompts.

The serialized review reference is capped at 16,000 UTF-8 bytes. Small memories are included completely; larger memories are selected deterministically by exact context, exact description, then lexical overlap, with support and recency only as tie-breakers. Whole conflict clusters are either included or omitted. AI results may cite only supplied memory IDs, and a bounded evidence snapshot is stored with the suggestion for the “AI cited your previous reviews” disclosure. It is evidence provenance, not raw reasoning or proof of causation.

Existing manual assignments are migrated in idempotent batches of up to 100. The normal first load runs one bounded batch of 50 and never overwrites a newer review; the endpoint can be repeated until it reports completion. Legacy rows retain an unknown (`null`) original review time and are labeled as migrated prior decisions.

`node --experimental-strip-types --test tests/*.test.mjs` covers deterministic normalization, filtering and URL restoration, stable selection, the shared bulk-operation controller, bounded batches, protected categorization eligibility, receipt recovery, cumulative stop/retry totals, production categorization SQL, concurrent stale-write guards, and atomic rollback. The categorization service tests use a mocked Responses transport and both a SQLite-backed D1 adapter and disposable workerd D1 runtime; they never call a live model. `node tests/api-smoke.mjs` also verifies idempotent operation replay, conflicting operation reuse, stale revision rejection and memory exclusion using synthetic local data.

The bounded synthetic live evaluation in `tests/review-memory-live-eval.mjs` uses three one-transaction calls and no bank data. In the recorded run, the no-memory café case selected the conventional business category at high confidence; after one explicit counter-conventional review it selected Education at high confidence and cited one review. The equal-context Amazon conflict was saved at low confidence. Input usage was 2,076, 2,217 and 2,445 tokens respectively (141-token personalized overhead for the matched café call); observed request latency was 2,879 ms, 1,088 ms and 1,063 ms. These are observations from one bounded run, not an accuracy guarantee or stable performance benchmark.

## CSV mapping and category management

AI mapping receives CSV headers and up to five sample rows and suggests the date, description, optional sub-description, amount layout, sign direction and date format. All suggestions remain editable. Server validation checks the proposed fields and sample data; uncertain dates are flagged. Manual mapping stays available on AI failures.

Sub-descriptions are stored separately, displayed below the primary description, and included in categorization. The existing duplicate identity remains unchanged so old exports do not duplicate on re-import. A matching row can gain a previously missing sub-description; existing nonempty detail and category edits are preserved.

Category management supports adding, renaming, changing type, archiving and restoring. Stable category IDs preserve existing assignments on rename. Archived categories are excluded from new assignments and AI suggestions but keep their historical labels and totals. Uncategorized remains available as the permanent fallback. Custom categories are scoped to the signed-in user and supplied to AI with their types.

`node tests/category-mapping-smoke.mjs` uses synthetic local data to verify live AI CSV mapping, sub-description enrichment, custom AI categories, and category rename/archive/restore. Remove its printed QA account/category IDs from the local test database afterward.
