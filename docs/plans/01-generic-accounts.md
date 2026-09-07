# 01 — Generic accounts and removal of balances

Depends on: shared rules in [README](README.md). Supplies account behavior to all later plans.

## Outcome and decisions

The app manages transactions from any bank. Users can create and edit accounts outside import, archive/restore accounts, and delete unused accounts. No balance snapshot, current balance, debt balance, or balance editor remains.

- Use a free-text institution name and account nickname instead of bank enums. Preserve existing names; a user's account may still be named Scotiabank or Wealthsimple.
- Keep existing account types and CAD/USD support. Allow editing name/institution. Allow type/currency changes only on unused accounts; this avoids silently reinterpreting money or reviewed account context.
- Archive is reversible and retains accounts in historical filters and reports, with an archived label. Block new imports to archived accounts on the server as well as in the picker.
- An unused account has no transactions, imports, or retained review/import history. Delete only such accounts; otherwise offer archive. Do not expose cascading deletion of populated accounts.
- Keep income/expense summaries and their current category semantics. Any net-flow value must be labeled as transaction flow and never presented as an account balance.

## Current code to inspect

`app/dashboard.tsx` contains bank defaults, account cards, import choices, balance state/dialog, and totals. `app/api/account/route.ts` only updates balances. `app/api/import/route.ts` validates a two-bank allowlist and creates accounts. `app/api/data/route.ts`, `lib/banking.ts`, and `db/schema.ts` expose balance fields. Also inspect `app/globals.css`, `app/layout.tsx`, `README.md`, and existing API tests for branding or balance dependencies.

## Work steps

Use the endpoint shapes in [Implementation contracts](implementation-contracts.md). Trim institution/nickname; require 1–80 characters each, preserve Unicode, and allow duplicate labels because IDs disambiguate accounts. Add `archived` as non-null false by default. Include it in `/api/data` and shared account types. Update/archive/restore operations may return the full authoritative account record for refresh.

For existing account imports, read and guard the account's active state inside the committing batch. Type/currency updates and deletion use owner-scoped `NOT EXISTS` history predicates at write time, not only an earlier UI/API check. Through Plan 1, history comprises `transactions`, `imports`, `transaction_reviews`, and `transaction_review_events`. Plan 3 extends this check for new outcome history. Do not query a not-yet-created table.

Reject unknown balance fields explicitly rather than interpreting a legacy request as an account update. Keep archive idempotent and restore idempotent. Account management must be reachable even when there are zero accounts or imports.

1. Inventory all runtime bank assumptions and balance reads/writes. Distinguish current product strings from immutable migrations and historical documentation.
2. Add an archived flag with existing accounts active by default. Remove balance columns using a new inspected migration. Verify generated SQLite table reconstruction, if any, preserves IDs, indexes, foreign keys, and related rows.
3. Replace the balance endpoint behavior with owner-scoped account create/update/archive/restore/delete operations. Share account validation with import creation. Reject blank/oversized names, unsupported currencies/types, forbidden edits, and stale or missing accounts.
4. Enforce archive/delete/type/currency rules at mutation time, atomically with relevant existence checks. Account creation/import races must not bypass deletion or archive restrictions.
5. Add account-management UI using existing components and reuse its fields in import. Replace bank logos and hardcoded examples with neutral account presentation. Keep empty states useful without fabricated bank accounts.
6. Remove balance UI, request fields, types, summaries, styles no longer used, and documentation claims. A stale balance update request must not silently succeed.

## Acceptance and verification

- Create an account at an arbitrary institution, edit its label, import into it, and see the same transaction ownership afterward.
- Archive/restore a populated account; historical transactions remain visible, archive blocks import, restore allows it.
- Delete an unused account; attempts to delete a populated account fail without deleting any related data. Reject another owner's IDs.
- Reject type/currency changes after history exists. Existing amounts and reviewed context remain unchanged.
- A populated migration fixture retains accounts, transactions, imports, categories, review history, and indexes while removing balance fields.
- Runtime code and public documentation no longer advertise bank-specific support or balances. Historical migrations and legitimate stored names need not be scrubbed.
- Update balance-dependent smoke tests; run relevant API tests, type check, lint, and build.

## Handoff

Document the account endpoint contract, migration, and archived-account behavior for Plans 2–4. Do not add transaction bulk deletion here.
