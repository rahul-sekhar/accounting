# 09 — Standalone Cloudflare deployment

Status: proposed migration and implementation plan. No deployment, remote resource creation, or production teardown is included in this deliverable.

## Outcome

Move the existing application from OpenAI Sites-managed deployment to an independently operated Cloudflare deployment. After this work, a developer can build, test, migrate an empty database, and deploy the application with documented CLI commands or CI without Codex, ChatGPT, or Sites.

The target architecture is:

```text
Browser → Cloudflare Access → Cloudflare Worker / Vinext → D1
                                                        └→ OpenAI Responses API
```

Keep the current application framework, schema, D1 query layer, and OpenAI API behavior. Codex can remain an optional development tool, but it is not part of the build, runtime, authentication flow, or release path.

## Decisions and scope

- Deploy the existing Vinext application directly to Cloudflare Workers.
- Provision a new D1 database in the owner's Cloudflare account and apply every existing migration in order. Start with an empty application dataset; do not export, transform, or import Sites data.
- Protect the entire production Worker/hostname with Cloudflare Access. Initially allow only explicitly named email addresses, using one-time PIN or an approved identity provider.
- Validate the `Cf-Access-Jwt-Assertion` JWT inside the application. Edge protection alone is not the application identity contract.
- Use the verified Access `sub` claim, namespaced as `cloudflare:<sub>`, as `userId`. Use the verified email for display. Because the database starts empty, no old-to-new identity mapping is required.
- Retain `gpt-4.1-mini` as the default configured model and retain the existing direct Responses API calls. This removes Sites/Codex deployment dependence, not the optional OpenAI API dependency.
- Retain the guarded WebMCP registration. Browsers without `document.modelContext` already ignore it, so it is not a deployment dependency.
- Make the CLI workflow authoritative. CI may invoke the same commands, but the application must remain deployable without CI.

Out of scope:

- Existing Sites/D1 data migration or reconciliation.
- Replacing D1 with PostgreSQL or making the database layer provider-agnostic.
- Replacing the OpenAI model or changing categorization behavior.
- New accounting features, UI redesign, custom domains, or multi-role authorization.
- Deleting the existing Site. Restriction or deletion is a separate, explicit post-cutover action.

## Current coupling to remove

| Coupling | Current location | Replacement |
| --- | --- | --- |
| Sites build plugin | `package.json`, `vite.config.ts` | Standard Vinext/Cloudflare deployment configuration |
| Sites project and binding manifest | `.openai/hosting.json`, `vite.config.ts` | Versioned `wrangler.jsonc` with a normal `DB` binding |
| Sites-injected identity headers | `app/chatgpt-auth.ts` | Verified Cloudflare Access JWT claims |
| ChatGPT sign-in/sign-out paths | `app/chatgpt-auth.ts`, `app/app-navbar.tsx` | Access login interception and `/cdn-cgi/access/logout` |
| Sites local sign-in | local preview and API smoke tests | Explicit localhost-only development identity |
| Sites deployment instructions | `README.md` | Cloudflare account bootstrap, secrets, migration, and deploy runbook |
| Codex-specific file watching | `vite.config.ts` | Generic opt-in polling environment setting or normal Vite defaults |

The existing `cloudflare:workers` environment imports, `D1Database` APIs, Drizzle schema, SQL migrations, and owner-scoped queries are target-platform code and remain.

## Prerequisites and operator-owned values

Before implementation can perform a live deployment, the operator must have:

1. A Cloudflare account with Workers, D1, and Zero Trust enabled.
2. A chosen Worker name and, optionally, a custom hostname.
3. A Cloudflare Access team domain and an Access application audience tag.
4. An explicit allowlist of initial user email addresses.
5. The existing OpenAI API key, if AI mapping and categorization should be enabled.
6. For CI only, a narrowly scoped Cloudflare API token stored in the CI secret store.

Do not commit account tokens, API keys, `.dev.vars`, or real user email allowlists. The D1 database ID and Access audience tag are identifiers rather than secrets and may live in deployment configuration, but keep environment-specific values clearly separated.

## Implementation sequence

### 1. Establish a standalone deployment baseline

Run the current Vinext compatibility check and compare the project with the current Cloudflare-generated Vinext configuration. Do not blindly replace the application or accept initializer changes unrelated to deployment.

Then:

- Remove `@openai/sites-vite-plugin` and the `sites()` plugin registration.
- Remove the `.openai/hosting.json` import and Sites placeholder database construction from `vite.config.ts`.
- Remove `.openai/hosting.json` from the standalone project after the new deployment path is working locally. Removing the file does not delete the remote Site.
- Rename the package from the generic `sites-project` name to an application-specific name.
- Replace the `CODEX_SANDBOX` watcher condition with either normal Vite behavior or a generic opt-in such as `VITE_USE_POLLING=true`.
- Add the compatible Vinext Cloudflare deployment package/configuration selected by the current compatibility tooling.
- Add a versioned `wrangler.jsonc` defining the Worker entry point, current compatibility date, `nodejs_compat`, static assets if generated by Vinext, the `DB` binding, and non-secret variables.
- Generate Cloudflare environment typings from Wrangler configuration instead of maintaining hand-written deployment assumptions where possible.

Define stable package scripts with these responsibilities:

| Script | Responsibility |
| --- | --- |
| `dev` | Fast local Vinext development |
| `build` | Production Vinext build |
| `preview` | Build and run through local `workerd`/Wrangler |
| `cf:typegen` | Regenerate Cloudflare binding types |
| `db:migrate:local` | Apply all migrations to the local D1 database |
| `db:migrate:remote` | Apply pending migrations to the explicitly configured remote D1 database |
| `deploy` | Deploy the production Worker using the supported Vinext Cloudflare command |
| `verify` | Run non-live tests, type checking, lint, and production build |

The exact commands generated by the installed Vinext version are authoritative; document them in `README.md` and avoid scripts tied to a Codex-created `dist` layout when the adapter provides its own command.

Acceptance for this step:

- `npm ci`, local development, production build, and local preview work without `@openai/sites-vite-plugin` or `.openai/hosting.json`.
- A repository search finds no build or deploy dependency on `sites()`, `project_id`, or `CODEX_SANDBOX`.
- The deployment command is runnable from an ordinary terminal.

### 2. Provision and initialize a fresh D1 database

Create a new D1 database owned by the target Cloudflare account and bind it as `DB` in `wrangler.jsonc`. Configure `migrations_dir` as `drizzle` so Wrangler discovers the existing top-level SQL migration files.

- Do not edit the existing `0000` through latest migration files or Drizzle snapshots.
- Apply all migrations to a disposable local database first.
- Verify the resulting tables, indexes, foreign keys, check constraints, and the D1 migration ledger.
- Apply the same migration set to the new empty remote database before the first application deployment.
- Confirm the empty-state UI initializes default categories correctly for the first authenticated user.
- Record the database creation and migration commands in `README.md`; use an explicit database name or binding and `--local`/`--remote` so an operator cannot accidentally target the wrong database.

No export endpoint, legacy ID mapping, backfill, or data copy is part of this plan.

Acceptance for this step:

- A fresh local database reaches the latest schema using only committed migrations.
- A fresh remote database reports no pending migrations after initialization.
- The application can create its first account and import synthetic transactions without pre-seeded user data.

### 3. Replace ChatGPT authentication with Cloudflare Access

Replace `app/chatgpt-auth.ts` with a provider-neutral authentication boundary, for example `app/auth.ts`, while retaining the small `AuthUser` shape used by pages and APIs.

Production authentication must:

1. Read `Cf-Access-Jwt-Assertion` from the request headers.
2. Verify the RS256 signature against the Cloudflare Access team JWKS using a Workers-compatible JWT library such as `jose`.
3. Verify issuer, application audience, expiry/not-before, and token type.
4. Require nonempty `sub` and email claims; reject service tokens as interactive users.
5. Return `userId: cloudflare:<sub>`, a normalized email, and a safe display name.
6. Cache the remote JWKS resolver at module scope while continuing to honor key rotation.
7. Fail closed with 401 when configuration, claims, or verification are invalid.

Add typed environment values:

- `ACCESS_TEAM_DOMAIN`, including the expected `https://<team>.cloudflareaccess.com` issuer.
- `ACCESS_AUD`, containing the Access application audience tag.
- `APP_ENV`, set to `production` in the deployed environment.
- Existing `DB`, `OPENAI_API_KEY`, and optional `OPENAI_MODEL` values.

Cloudflare Access itself must protect the entire Worker, including its production URL, preview URLs if used with real data, custom hostname, static assets, and API routes. Use an exact-email allow policy initially. The application JWT check remains defense in depth and provides the trusted owner identity.

Update application integration:

- Rename `getChatGPTUser`/`requireChatGPTUser` to provider-neutral equivalents.
- Keep page-level redirects/protection and API-level 401 behavior.
- Preserve the existing same-origin and JSON-content checks for mutations.
- Replace the sign-out link with `/cdn-cgi/access/logout` and use top-level navigation.
- Remove `/signin-with-chatgpt`, `/signout-with-chatgpt`, and `/callback` assumptions.
- Update UI and documentation language from ChatGPT sign-in to secure account access.

For local development, provide a deliberately separate development identity path. It may activate only when all of the following are true:

- `APP_ENV=development`;
- an explicit local-auth flag is enabled in ignored local configuration;
- the request host is `localhost`, `127.0.0.1`, or `[::1]`;
- required local synthetic user values are present.

Production configuration must not define the local-auth values. Add tests proving that forged local headers/configuration cannot authenticate a production or non-loopback request. Do not add a remotely reachable auth-bypass endpoint.

Acceptance for this step:

- Valid Access JWTs authenticate and produce stable owner IDs.
- Missing, malformed, tampered, expired, wrong-issuer, wrong-audience, and service-token JWTs fail closed.
- A user cannot access another verified user's records.
- Local smoke tests remain runnable without deploying or contacting an identity provider.
- Sign-out clears the Access application session and returning to the app requires authentication.

### 4. Move runtime configuration and secrets

- Keep `OPENAI_API_KEY` only as a Cloudflare Worker secret. Never place it in `wrangler.jsonc`, committed `.env` files, build logs, or client bundles.
- Keep `OPENAI_MODEL` as a non-secret deployment variable, defaulting to the current model when absent.
- Add `.env.example` and `.dev.vars.example` files containing names and safe placeholders only.
- Document interactive secret setup and rotation with `wrangler secret put`.
- Confirm `/api/data` reports only AI readiness and never returns secret values.
- Verify the production bundle and static assets contain none of the configured secret material.

AI-disabled behavior remains supported: manual CSV mapping and manual categorization continue to work when `OPENAI_API_KEY` is absent.

### 5. Update automated verification

Add focused authentication tests around the production verifier and local-development guard. Use locally generated signing keys or an injected verifier/JWKS seam; tests must not call the live Access JWKS endpoint.

Update `tests/api-smoke.mjs` and local test setup so they no longer rely on Sites' built-in sign-in. Preserve the existing checks for:

- anonymous rejection;
- cross-origin mutation rejection;
- owner scoping;
- account, import, categorization, review, spread, and deletion workflows;
- idempotency and concurrency behavior.

Add fresh-database verification that applies the real migration chain to an empty D1 instance. Do not run the live AI evaluation as part of the default verification command.

Run:

1. Focused auth and configuration tests.
2. All deterministic Node test suites.
3. Updated API smoke tests against local preview.
4. Type checking and lint.
5. Vinext compatibility check.
6. Production build and `workerd` preview.

Acceptance for this step:

- Default verification requires no Sites service, ChatGPT session, Codex process, remote database, or live model call.
- A production-mode test proves that local authentication cannot be enabled accidentally.
- Existing accounting and privacy regression suites remain green.

### 6. Document the independent release runbook

Rewrite the runtime and deployment sections of `README.md` around an ordinary operator workflow:

1. Install Node and dependencies.
2. Authenticate Wrangler to the intended Cloudflare account.
3. Create or select the D1 database and update its binding.
4. Configure Access and copy the issuer/audience identifiers.
5. Apply remote migrations explicitly.
6. Set the OpenAI secret if AI features are desired.
7. Run `npm run verify`.
8. Run `npm run deploy`.
9. Complete the post-deploy checks.

Document recovery separately:

- A code rollback redeploys a known-good commit.
- D1 Time Travel or an export is the database recovery mechanism; never roll back by editing applied migration files.
- Access can be tightened or disabled from Cloudflare independently of a code rollback.
- Worker secrets persist independently and should be rotated rather than committed.

For CI, document the minimum required repository secrets and permissions, but do not make CI the only release route. If a workflow is added, it should run verification on pull requests and require an explicit protected production environment for deploys. Database migration and production deployment must not run on arbitrary pull requests.

### 7. Deploy and cut over

Live deployment is a separate execution step requiring the operator's Cloudflare account and authorization.

1. Provision the empty production D1 database and apply migrations.
2. Deploy the Worker to a temporary `workers.dev` URL.
3. Protect the Worker and all reachable production/preview hostnames with Access before entering any financial data.
4. Configure runtime variables and the OpenAI secret.
5. Test with synthetic data in an incognito browser:
   - unauthorized visitor is challenged or denied;
   - allowlisted user can sign in and sign out;
   - empty state, account creation, CSV import, filtering, categorization, review memory, expense spreading, and deletion work;
   - API requests without a valid Access token fail;
   - secrets never appear in HTML, JavaScript, JSON responses, or logs.
6. If desired, attach a custom domain and repeat the Access and origin checks on that hostname.
7. Declare the standalone URL authoritative only after all release criteria pass.

Because no data migration is required, there is no dual-write or data-freeze period. Keep the old Site restricted and unchanged during validation. After explicit approval, restrict or delete it separately; deletion is not implied by a successful Worker deployment.

## Release acceptance criteria

1. The repository contains no required OpenAI Sites plugin, manifest, project ID, ChatGPT auth route, or Codex-only deployment behavior.
2. A new machine can run the documented install, verification, database initialization, and deployment commands without opening Codex or ChatGPT.
3. The production Worker and every production hostname are protected by Cloudflare Access.
4. The application cryptographically verifies Access JWT signature, issuer, audience, time claims, token type, subject, and email before using identity.
5. All database reads and mutations remain scoped to the verified `cloudflare:<sub>` owner ID.
6. A fresh D1 database reaches the latest schema using only committed migrations and supports the complete synthetic workflow.
7. Local development works through an explicit loopback-only identity and that identity cannot activate in production.
8. OpenAI secrets remain server-side, AI-disabled behavior remains usable, and existing AI privacy controls (`store: false`, masking, bounded context) remain unchanged.
9. Deterministic tests, API smoke tests, type checking, lint, compatibility check, production build, and local production preview pass.
10. Deployment and rollback are documented CLI procedures; CI and Codex are optional conveniences.
11. The existing Site is not deleted or made public by this migration.

## Implementation handoff

Complete this migration as one infrastructure change rather than mixing it with product features. Record:

- created Cloudflare resource names and non-secret IDs;
- changed files and dependency versions;
- exact local and remote migration commands;
- exact verification commands and outcomes;
- the deployed URL and Access policy scope;
- whether live AI was tested with synthetic data;
- any remaining manual steps, especially custom domain setup or old-Site retirement.

Relevant current guidance:

- [OpenAI Sites documentation](https://learn.chatgpt.com/docs/sites?surface=app)
- [Cloudflare Vinext deployment guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare Access session/logout guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

