# Account View

Private Scotiabank and Wealthsimple CSV account dashboard, built with React/Vinext on Sites. ChatGPT sign-in and owner-only hosting protect the workspace. Every API query is scoped to the authenticated user; anonymous API requests are rejected.

## Supported workflow

- Upload a CSV for a new or existing account. Match columns, choose date format and debit/credit direction, review five sample rows, then save.
- Store parsed transactions and import history in D1. Original CSV files are not retained. Limits: 5 MB and 2,000 rows per import. Separate accounts and currencies into distinct exports.
- Overlapping imports match date, normalized description, amount and repeated occurrence number within an account. Identical repeated rows in a single export remain separate. Export complete days: partial-day identical transactions cannot be uniquely distinguished without bank transaction IDs.
- Track explicit balance snapshots with their dates. Transaction imports do not imply a current balance or automatically update snapshots. Enter debt as a negative balance.
- View CAD and USD separately; no exchange-rate conversion. Filter by account, month, and category. Refunds reduce their spending category after categorization. Transfers and investment trades are excluded from income/spending. Uncategorized inflows provisionally count as income and need review.
- AI suggests categories using OpenAI Responses with a strict JSON schema. Only descriptions (long numeric references masked), amounts, currency and account type are sent, with `store: false`. AI does not receive owner identity, account nicknames, dates, or the entire CSV. Descriptions themselves may contain personal information. Manual category changes are preserved. Low-confidence suggestions are flagged for review.

## Runtime

The Sites manifest declares `DB`; generated Drizzle migrations live in `drizzle/`. Do not change applied migrations. `OPENAI_API_KEY` must be configured as a hosted secret before AI is available. Optional `OPENAI_MODEL` defaults to `gpt-4.1-mini`. No key is bundled or exposed to the browser. Authorized local secret destination is `.env.local` (ignored); no key has been provisioned yet because secure Platform key tools are unavailable in this task.

`npm run dev` starts the local Sites preview. Its built-in local sign-in is development-only. `npm run build` builds the Cloudflare Worker and copies the manifest/migrations. `npx drizzle-kit generate` generates schema migrations.

## Verification

`node --experimental-strip-types --test tests/banking.test.mjs` covers CSV quoting, multiline fields, headerless exports, date ambiguity, malformed rows, debit/credit signs, cents, duplicate occurrences and refund/transfer calculations.

`node tests/api-smoke.mjs` exercises local sign-in, saving and re-importing synthetic transactions, persisted edits/balances, invalid data/currency, missing account IDs and unauthenticated/cross-origin rejection. It uses only localhost and creates a disposable synthetic account; remove that account from the local test database after the run. Local migration configuration is kept under ignored `.wrangler/`.

Type-check and production build passed. Browser interaction/visual QA was not requested and was not performed. The optional WebMCP `start_bank_csv_import` opens the same import dialog without uploading or saving. No supported WebMCP test context was exposed, so its live registration remains unverified. Live AI classification remains unverified pending API credentials. No real bank export has been supplied; the import review handles differing column names and signs explicitly.
