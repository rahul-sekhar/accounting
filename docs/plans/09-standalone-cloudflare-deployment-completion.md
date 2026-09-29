# Plan 9 completion — standalone Cloudflare deployment

Implemented the repository-side migration from OpenAI Sites to an independently operated Vinext Cloudflare Worker. No remote Cloudflare resource was created, no production deployment was performed, and the existing Site was not changed.

## Implementation

- Removed `@openai/sites-vite-plugin`, `.openai/hosting.json`, the Sites binding placeholder, ChatGPT identity headers/routes, and Codex-only watcher behavior.
- Added `wrangler.jsonc` for Worker `account-view`, static assets, `nodejs_compat`, the `DB` D1 binding, `drizzle` migrations, production Access identifiers, and `gpt-4.1-mini`.
- Added the supported `@vinext/cloudflare` deployment adapter and current compatible Vinext/Cloudflare tooling. Added JOSE for Workers-compatible Access verification. Generated `worker-configuration.d.ts` with Wrangler and removed the superseded hand-maintained Workers runtime package.
- Added stable CLI scripts for development, build, workerd preview, type generation, local and remote D1 migration, fresh-D1 validation, deployment, and complete verification.
- Replaced authentication with RS256 Cloudflare Access JWT validation. The verifier checks issuer, audience, signature, expiry/not-before, the signed Access application-token type, subject, email, and service-token indicators. The optional JOSE `typ` header is not treated as an identity control. Owner IDs are `cloudflare:<sub>`. Remote JWKS resolution is cached at module scope.
- Added a separate explicit local identity guarded by development environment, opt-in flag, required synthetic identity, and exact loopback host. Production and non-loopback bypass cases are covered by tests.
- Updated logout to `/cdn-cgi/access/logout`, updated all page/API identity integrations, and retained mutation origin/JSON checks and owner-scoped queries.
- Added `.env.example`, `.dev.vars.example`, authentication regression tests, a disposable fresh-D1 migration/schema verifier, updated API smoke tests, and the independent bootstrap/release/rollback/CI runbook in `README.md`.
- Updated the existing Miniflare regression harness to the current workerd configuration schema. No application schema migration was added or changed.

Key dependency versions at completion: `vinext` 1.0.0, `@vinext/cloudflare` 1.0.0, `@cloudflare/vite-plugin` 1.62.0, Wrangler 4.143.0, JOSE 6.2.12, Vite 8.3.1, and React/React DOM/RSC 19.3.0.

## Database commands

```sh
npx wrangler d1 create account-view
npm run db:migrate:local
npm run db:migrate:remote
npx wrangler d1 migrations list account-view --remote --config wrangler.jsonc
```

`npm run db:verify:fresh` applied committed migrations `0000` through `0005` to a disposable local D1 database, reported no pending migrations, and verified the ledger count, expected tables, owner indexes, and foreign keys.

## Verification

- `npm run verify` — passed: 81 deterministic tests, fresh D1 verification, TypeScript, lint, Vinext compatibility, and production build. Vinext reported 100% compatibility.
- `npm run deploy -- --dry-run` — passed; the adapter recognized the App Router, Vite configuration, and Wrangler configuration without a remote action.
- `npm run preview` plus `BASE_URL=http://localhost:4173 node tests/api-smoke.mjs` — passed against local workerd and D1. This covered anonymous and cross-origin rejection plus the synthetic account/import/review/categorization/deletion/replay workflow.
- Client-asset inspection found no configured local environment value in `dist/client`.
- `npm audit --omit=dev --audit-level=high` found no remaining high or critical advisory after upgrading React RSC and Vite. Moderate advisories remain in current Vinext image-rendering and Cloudflare local-tooling transitive dependencies; npm's suggested fixes are incompatible downgrades.
- `git diff --check` — passed.

No live Access, remote D1, deployment, custom domain, or live OpenAI call was tested. The API smoke run used synthetic data and AI-disabled behavior.

## Required operator steps

The versioned configuration intentionally retains placeholders. Before release, the operator must create `account-view` D1, replace its placeholder database ID, configure an exact-email Cloudflare Access application covering every reachable production/preview hostname, replace the Access issuer and audience values, apply remote migrations, optionally set `OPENAI_API_KEY` with `wrangler secret put`, run verification, and deploy. The deployed URL, Access policy scope, non-secret Cloudflare IDs, and synthetic post-deploy results must be recorded in the release handoff.
