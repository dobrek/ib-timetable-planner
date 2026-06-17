# Auth + Astro Actions Boundary (+ RLS/PII) Tests — Implementation Plan

## Overview

Stand up the project's **first Playwright e2e harness** as the reusable pattern for all future browser-level tests, and use it to prove the auth + Astro Actions boundary that rollout **Phase 2** of `context/foundation/test-plan.md` targets (Risks #5 and #3). The work is a **hybrid** per the locked research scope: Playwright e2e owns the browser-observable truths (sign-in → protected route → **action refused** path), while a Vitest integration complement owns the matrix-shaped truths (`DomainError`→`ActionError` translation, malformed-input rejection, unauth at the `.handler` layer, **and `createPlan` persistence**). The first e2e is deliberately scoped to **prove authentication and the reusable auth-reuse mechanism** — driving a mutation through the UI (the `createPlan` happy-path round-trip) is deferred to a later browser test once the pattern is established. Cross-author / IDOR is **deferred** with the RLS prerequisite.

## Current State Analysis

- **The boundary is uniform.** Every mutation Action is built through one factory — `defineDomainAction` runs `requireSession → requireSupabase → runDomain(domainFn)` (`src/shared/lib/actions/define-domain-action.ts:13-25`). No handler hand-rolls the gate; none skips `requireSession`. So "no session ⇒ `UNAUTHORIZED`" and "`DomainError`⇒`ActionError` (1:1 code passthrough, message verbatim, `run-domain.ts:8-17`)" are **contract-level** guarantees provable against one representative action.
- **Two-layer auth seam.** `src/middleware.ts` 302-redirects unauthenticated *page* requests to `/auth/signin` but **exempts `/_actions/*`** (matches the `/_` prefix, `middleware.ts:10`). So Actions are gated *per-handler*; the two e2e assertions map 1:1 onto these layers (**pages → redirect**, **actions → `ActionError(UNAUTHORIZED)`**).
- **A real UI happy path exists.** `PlansHub.tsx` "New plan" button → `PlanFormDialog.tsx` (react-hook-form, `createPlanInput` resolver) → `createPlan` action → "Create plan" submit (`PlanFormDialog.tsx:143`). `createPlan` input is `{ name, slotGridPreset }` (`plans-list/model/schemas.ts`), the simplest happy-path action.
- **Tooling is greenfield.** Only `@playwright/cli@^0.1.14` (agent authoring/healing aid, **not** the runner) is installed. No `@playwright/test`, no `playwright.config.*`, no `e2e/` dir, no `test:e2e` script.
- **Sessions are `@supabase/ssr` cookies** (`src/shared/api/supabase.ts`) → default storage key `sb-<project-ref>-auth-token`, chunked `.0`/`.1`/…; local → `sb-127-auth-token*`. `storageState` is the correct auth-reuse mechanism; "no cookies" = unauthenticated.
- **The CI integration job is the template** (`.github/workflows/ci.yml:34-77`) and already keeps **gotrue** in its trimmed `supabase start -x …` stack ("cheap; future RLS/e2e", `ci.yml:56-61`) — so sign-in works with **no change to the `-x` exclusion list**. `deploy` currently `needs: [ci, integration]` (`ci.yml:80`).
- **Confirmed gaps:** `vitest.integration.config.ts` aliases `astro:env/server` but **not** `astro:actions` (the unit `vitest.config.ts` aliases both, and `test/stubs/astro-actions.ts` already provides `ActionError`/`ActionErrorCode`/`defineAction`). `.gitignore` ignores only `.playwright-cli`/`.playwright-mcp` — `.auth/`, `test-results/`, `playwright-report/`, `.playwright/` are **not** ignored. `.env*` already covers `.env.test.local`/`.dev.vars`.
- **No self-service signup** (`config.toml enable_signup = false`; no route); `docs/runbooks/author-provisioning.md` documents manual Studio creation only. Seed does not touch `auth.users`. Locally `enable_confirmations = false`, so a created user is immediately sign-in-ready.

## Desired End State

`pnpm test:e2e` runs locally and in CI against a **real workerd preview** of the shipped bundle, proving: (1) a signed-in author reuses the persisted session (`storageState`) and lands on the protected dashboard; (2) an unauthenticated visitor hitting a protected page is redirected to `/auth/signin`; (3) an action invoked with **no session** is refused with `UNAUTHORIZED` over real HTTP. A Vitest integration complement (`pnpm test:integration`) proves the full `DomainError`→`ActionError` translation matrix, the unauth `.handler` path, malformed-input rejection, and `createPlan` persistence against real local Supabase. A GRANT migration pins `authenticated` table reachability. A new CI `e2e` job mirrors the `integration` job and **gates deploy**. `test-plan.md` records the Phase-2 e2e-harness divergence.

Verify the end state: `pnpm test:e2e` green across `chromium` + `chromium-guard` projects locally; `pnpm test:integration` green; a PR shows the `e2e` CI job passing and `deploy` blocked on it.

### Key Discoveries:

- Uniform action factory makes the contract provable once: `src/shared/lib/actions/define-domain-action.ts:13-25`.
- `/_actions/*` is exempt from the redirect (`src/middleware.ts:10`) — the per-handler gate is the whole point of the phase.
- `astro:actions` alias gap in the integration config: `vitest.integration.config.ts:15-17` (unit config has it at `vitest.config.ts:14-17`; stub at `test/stubs/astro-actions.ts`).
- Factory harness + plan-rooted teardown is directly reusable: `src/test/factories/index.ts`, `src/test/factories/teardown.ts`; CI fail-loud env gate at `src/test/load-test-env.ts:28-36`.
- **Zod `input` validation fires before the handler** — an unauthenticated request with a *malformed* body surfaces an input error, not `UNAUTHORIZED`. A clean `UNAUTHORIZED` assertion must send a **valid input shape with no session** (`research.md` §A test-ordering nuance).

## What We're NOT Doing

- **Cross-author / IDOR (Risk #5 second half)** — not meaningfully testable until an ownership column + real per-author RLS land; RLS is permissive `using(true)` today and integration uses the RLS-bypassing service-role key. Deferred to a future change (candidate Phase 2.5). The integration harness for two authenticated non-service-role clients is **not** built here.
- **An ownership column or non-permissive RLS migration** — out of scope (the deferred prerequisite owns it).
- **The `createPlan` happy-path e2e** (UI-driven mutation + `/_actions/createPlan` round-trip) — **deferred**. This first e2e proves authentication + the reusable harness; `createPlan` persistence is covered at the integration `.handler` layer and the over-HTTP boundary by the unauth-refusal spec. A UI-driven mutation e2e comes once the pattern is established (Phase 3 territory, alongside drag-drop).
- **Drag-drop / planner-board e2e** — `@dnd-kit/react` pointer-sensor needs ≥2 `mousemove`s; Phase 3 territory, not now.
- **Cross-browser (Firefox/WebKit)** — chromium-only for the first pattern.
- **An "Action over real HTTP" Vitest harness** (`app.render()` / `experimental_AstroContainer`) — the over-HTTP truth is now covered by e2e; integration stays at `.handler`.
- **Mocking the domain function inside the boundary test**, or re-testing already-covered domain logic (`lessons.md` guard).

## Implementation Approach

Build bottom-up and de-risk early. **Phase 1** stands up the harness, pins table reachability with a GRANT migration, and resolves the single highest-risk unknown — the env-to-worker wiring — by proving sign-in works against the real workerd preview and writing `storageState`. **Phase 2** layers the three assertion specs on that proven foundation. **Phase 3** adds the cheaper integration complement at the `.handler` layer. **Phase 4** mirrors the harness into CI and makes it a deploy gate. **Phase 5** reconciles the foundation docs.

The e2e harness lives in a top-level `e2e/` dir, invisible to `pnpm steiger` (scoped to `src`) and Vitest (globs `src/**`), matching the repo's harness-outside-slices habit (`test/stubs/`, `src/test/factories/`).

## Critical Implementation Details

- **Env-to-worker is the load-bearing unknown.** The webServer runs `astro preview` = `wrangler dev ./dist` on real workerd, which reads `SUPABASE_URL`/`SUPABASE_KEY` via `astro:env/server` from **`.dev.vars`**, not necessarily from `webServer.env`. Locally `pnpm env:local` already writes `.dev.vars` with the well-known local keys (which *do* match `supabase start`). In CI the stack **mints its own keys** that won't match the fixed local publishable key — CI must write `.dev.vars` from the CI stack's `SUPABASE_URL` + anon key before starting the server, or `createClient` is `null` and sign-in fails silently with "Supabase is not configured." **Caveat:** because `pnpm env:local` writes `.dev.vars` *and* the config also passes `webServer.env`, a green Phase-1 setup spec proves only that workerd picks up **some** env source — not which one. The mechanism is genuinely disambiguated only in CI (minted keys ≠ local key), so CI **always writes `.dev.vars`** and does not rely on `webServer.env` (Phase 4); Phase 4 Manual 4.6 records the confirmed mechanism.
- **`storageState` must capture the chunked cookies.** Playwright's `context.storageState()` captures all context cookies (including `sb-…-auth-token.0/.1`), so this is automatic — but the setup spec must `waitForURL('**/dashboard')` *before* saving, or it persists a pre-auth state.
- **`UNAUTHORIZED` assertion needs a valid input body.** Send a schema-valid `{ name, slotGridPreset }` with no cookies so Zod passes and the handler's `requireSession` is what rejects — otherwise the client sees an input error, not `UNAUTHORIZED`.
- **No e2e writes to a domain table.** With the `createPlan` happy-path spec deferred, the e2e suite never inserts (auth-load reads `/dashboard`; guard/unauth are rejected before Supabase). Reachability is guaranteed by the GRANT migration (below), not by exercising a write — so there is no per-run plan-name collision concern and no test residue.

---

## Phase 1: E2e harness scaffold + author provisioning + reachability pin

### Overview

Install the runner, author the root config and `e2e/` skeleton, build the idempotent provisioning script, pin `authenticated` table reachability with a GRANT migration, wire the scripts and `.gitignore`, and prove the whole chain works locally via the login setup spec — resolving the env-to-worker wiring before any assertion spec is written.

### Changes Required:

#### 1. Add the test runner

**File**: `package.json`

**Intent**: Add `@playwright/test` (latest 1.61.x) as a devDependency — the actual runner; `@playwright/cli` stays the authoring/healing aid. After install, run `pnpm exec playwright install chromium` (chromium only).

**Contract**: New devDependency `@playwright/test`. New scripts: `"test:e2e": "playwright test"` and `"pretest:e2e": "node scripts/provision-e2e-author.mjs"` (provisioning runs before every e2e run, locally and in CI).

#### 2. Root Playwright config

**File**: `playwright.config.ts` (repo root)

**Intent**: Define the reusable project topology — a `setup` project that logs in once and writes `storageState`; an authenticated `chromium` project that depends on it; a no-storageState `chromium-guard` project for the negative/unauth specs — and a `webServer` that builds then previews on real workerd.

**Contract**: `testDir: './e2e'`, port 4321, `baseURL: http://localhost:4321`. Three projects: `setup` (`testMatch: /.*\.setup\.ts/`); `chromium` (`testIgnore` guard/unauth specs, `storageState: 'e2e/.auth/user.json'`, `dependencies: ['setup']`); `chromium-guard` (`testMatch` guard/unauth specs, `storageState: { cookies: [], origins: [] }`). `webServer`: `command: 'pnpm build && pnpm preview'`, `url: baseURL`, `reuseExistingServer: !process.env.CI`, `timeout: 180_000`. CI knobs: `forbidOnly`, `retries: 1`, `workers: 1`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`. Use the config shape in `research.md` §C verbatim as the starting point.

#### 3. Login setup spec

**File**: `e2e/auth.setup.ts`

**Intent**: Sign in once through the real UI and persist the session so authenticated specs reuse it. This spec is also the **empirical probe** for the env-to-worker wiring — if it goes green against `pnpm preview`, the local `.dev.vars` path is confirmed.

**Contract**: Navigates `/auth/signin`; fills `getByLabel('Email')` / `getByLabel('Password')` from the **shared `e2e/author-credentials.mjs` source** (env override → fixed local default — the SAME source the provisioning script reads, so the signed-in account always matches the provisioned one; never read `process.env.E2E_AUTHOR_*` directly with a `!` assertion, which silently signs in as `undefined` when the vars are unset); clicks `getByRole('button', { name: /sign in/i })`; `waitForURL('**/dashboard')`; `context().storageState({ path: 'e2e/.auth/user.json' })`. No sleeps, no `networkidle` (playwright-cli skill rule).

#### 4. Idempotent author provisioning script

**File**: `scripts/provision-e2e-author.mjs`

**Intent**: Create the e2e author programmatically (the first programmatic provisioning path), tolerating re-runs, using the admin API which bypasses `enable_signup=false`. Matches `scripts/*.mjs` conventions (ESM, shebang, reads `process.env`, diagnostics → stderr).

**Contract**: Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (for zero-config local DX, fall back to parsing `.env.test.local` for the service-role key, mirroring `src/test/load-test-env.ts`), and the **author credentials from the shared `e2e/author-credentials.mjs` module** (env `E2E_AUTHOR_EMAIL`/`E2E_AUTHOR_PASSWORD` → fixed local default) — the same module the setup spec imports, so the provisioned account and the sign-in resolve identical creds. Calls `createClient(url, serviceRoleKey).auth.admin.createUser({ email, password, email_confirm: true })`. Treats "already registered" as success (idempotent). Exits non-zero with a clear stderr message if URL/service-role key are absent. Runs in Node on the host — workerd constraints do not apply.

> **Shared creds module** (new, `e2e/author-credentials.mjs`): a ~3-line `export const authorEmail = process.env.E2E_AUTHOR_EMAIL ?? "e2e-author@example.test"` (+ password), the single source both the provisioning script and the setup spec import. A plain `.mjs` so the Node script and the Playwright/TS spec can each import it.

#### 5. Ignore Playwright + auth artifacts

**File**: `.gitignore`

**Intent**: Keep live auth cookies and Playwright outputs out of git.

**Contract**: Append `e2e/.auth/` (or `.auth/`), `test-results/`, `playwright-report/`, `.playwright/` under the existing `# playwright` block.

#### 6. Pin `authenticated` table reachability (GRANT migration)

**File**: `supabase/migrations/<timestamp>_grant_authenticated_table_access.sql` (new — `pnpm exec supabase migration new grant_authenticated_table_access`)

**Intent**: Stop depending on Supabase's auto-grant for `authenticated` reachability. With the `createPlan` happy-path e2e deferred, nothing else exercises an authenticated domain-table access, so a future flip to opt-in grants would ship silently and surface as `permission denied for table plans` in prod. Pin it at the schema level instead of relying on a test to notice. (Land this migration first — it's an independent prerequisite, not coupled to the harness.)

**Contract**: Grant the role the signed-in app runs as — `authenticated` — table DML on the `public` schema, current and future tables:

```sql
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
```

`anon` is intentionally excluded — every domain-table access is gated to `authenticated` by `middleware.ts` / `requireSession` (least privilege). Additive, no `DROP`. Apply locally via `pnpm exec supabase db reset`; CI's `supabase start` and deploy's `supabase db push` pick it up with **no workflow change**. Mirrors the README's documented mitigation.

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass: `pnpm lint`
- Build stays clean (workerd): `pnpm build`
- GRANT migration applies cleanly and reachability is pinned: `pnpm exec supabase db reset` succeeds and `has_table_privilege('authenticated', 'public.plans', 'INSERT')` returns `true` (psql one-liner against the local stack)
- Provisioning script is idempotent: `node scripts/provision-e2e-author.mjs` succeeds on a fresh local stack and again on a second run (no error on existing user)
- Setup project runs green and writes the artifact: `pnpm exec playwright test --project=setup` → `e2e/.auth/user.json` exists and contains `sb-…-auth-token` cookie(s)

#### Manual Verification:

- The env-to-worker path is confirmed: with `pnpm env:local` applied, `pnpm preview` serves a working sign-in (no "Supabase is not configured."), and the setup spec logs in against it
- `git status` shows `e2e/.auth/user.json` is untracked/ignored (no live cookies staged)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the env-to-worker wiring and ignored-artifact checks held before proceeding.

---

## Phase 2: E2e assertion specs

### Overview

Write the three browser-observable assertions on the proven harness: authenticated page load (the `storageState` reuse proof), guard redirect, action unauth refusal.

### Changes Required:

#### 1. Authenticated dashboard loads

**File**: `e2e/specs/auth.spec.ts`

**Intent**: Prove a signed-in author lands on the protected dashboard (positive control for the `chromium` project + `storageState`).

**Contract**: `chromium` project. `goto('/dashboard')`; assert the logged-in signal — heading `Welcome back` or text `Signed in as <email>` (`DashboardPage.astro:9-12`). Optionally assert the `Sign out` control is present (`SidebarLayout.astro`).

#### 2. Guard redirect (page layer)

**File**: `e2e/specs/auth-guard.spec.ts`

**Intent**: Prove the middleware bounces an unauthenticated visitor from a protected page — the first auth layer.

**Contract**: `chromium-guard` project (no storageState). `goto('/dashboard')`; `expect(page).toHaveURL(/\/auth\/signin/)` (302 → `/auth/signin`, `middleware.ts:40-42`).

#### 3. Action unauth refusal (handler layer, over HTTP)

**File**: `e2e/specs/action-unauth.spec.ts`

**Intent**: Prove an Action invoked with **no session** is refused by the per-handler `requireSession` — the second auth layer, and the exact truth the `/_` redirect-exemption makes non-obvious. A true boundary test (real server-side rejection), not `page.route` mocking.

**Contract**: `chromium-guard` project. Use the no-cookie `request` fixture to `POST /_actions/createPlan` with a **schema-valid** body `{ name, slotGridPreset }` (valid input dodges Zod input-error precedence). Assert the response encodes `UNAUTHORIZED` (HTTP 401 + action-error body with `code === "UNAUTHORIZED"`). Confirm the exact status/body shape empirically with `@playwright/cli` (`requests`/`snapshot`) during authoring.

### Success Criteria:

#### Automated Verification:

- Full e2e suite green across both projects: `pnpm test:e2e`
- Guard + unauth specs run only under `chromium-guard` and the positive specs only under `chromium` (project routing correct — no storageState leak into guard specs)

#### Manual Verification:

- Trace/screenshot on a deliberately broken selector confirms the healing workflow (`@playwright/cli attach` + `snapshot`) works for future authors
- The authenticated dashboard spec proves session reuse — `e2e/.auth/user.json` rehydrates without a fresh sign-in (inspect the trace: no `/auth/signin` redirect)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Vitest integration complement

### Overview

Cover the matrix-shaped Risk #3 truths at the cheaper `.handler` layer against real local Supabase, reusing the factory harness. With the UI-driven `createPlan` happy path deferred from e2e, this lane is also where `createPlan` **persistence** is anchored — the existing `plan-actions.integration.test.ts` already covers the domain create→persist path, and the translation matrix below exercises a real insert to provoke `CONFLICT`.

### Changes Required:

#### 1. Unblock action imports in the integration lane

**File**: `vitest.integration.config.ts`

**Intent**: Let integration suites import actions through the wrapper by stubbing the `astro:actions` virtual module — the same alias the unit config already has.

**Contract**: Add `"astro:actions": fileURLToPath(new URL("./test/stubs/astro-actions.ts", import.meta.url))` to the existing `alias` map (currently only `astro:env/server`, `vitest.integration.config.ts:15-17`). Reuses the existing stub at `test/stubs/astro-actions.ts`.

#### 2. Boundary integration suite

**File**: `src/_pages/plans-list/api/*.integration.test.ts` (extend an existing suite or add a co-located `action-boundary.integration.test.ts`)

**Intent**: Exercise the action wrapper against real Supabase to prove the two handler-layer truths the e2e doesn't cover exhaustively: the `DomainError`→`ActionError` translation matrix and malformed-input rejection. Do **not** mock the domain function. (The no-session path is **not** re-covered here — it's already unit-tested via `makeContext(undefined)` at `define-domain-action.test.ts:130-137`, and the e2e `chromium-guard` spec owns the real-HTTP unauth proof; an integration mirror would never reach Supabase, so it adds no real-DB signal.)

**Contract**: Reuse the factory harness (`createPlan`/`seedPlanCatalog`/`registerPlan`/`teardown`, `src/test/factories/index.ts`) and the env gate (`load-test-env.ts`, `(hasEnv ? describe : describe.skip)`). Two groups: (a) **translation matrix (in-scope codes only)** — provoke the codes plans-list domain fns genuinely surface and assert the `ActionError` carries the same code 1:1 + verbatim message: **`CONFLICT`** (unique-name violation, via an action that maps a `conflict` message — `to-domain-error.ts:16`; note `create-plan.ts` maps only `failure`, so use `renamePlan`/`clonePlan` for the duplicate-name case) and **`NOT_FOUND`** (`.single()` matches no row on `renamePlan`/`clonePlan` with a missing id — `to-domain-error.ts:17`). The exhaustive 1:1 mapping for all five codes (incl. `BAD_REQUEST`/`UNPROCESSABLE_CONTENT`/`INTERNAL_SERVER_ERROR`, which create/clone/rename/delete don't naturally throw) stays **unit-covered** by `run-domain.test` + the `to-domain-error`/`unwrap-*` tests — don't manufacture unreachable codes through real Supabase. (b) **malformed input** — assert `isInputError` true for a body that fails the Zod `input` (validated before the handler body). Clean up via `teardown`.

### Success Criteria:

#### Automated Verification:

- Integration suite green against local Supabase: `pnpm test:integration`
- Unit + steiger unaffected: `pnpm test` and `pnpm steiger` pass
- No reliance on the service-role bypass for the *contract* assertions (translation/input are key-agnostic); cross-author remains absent (correctly deferred)

#### Manual Verification:

- Suite leaves no residual rows (teardown verified via Studio or a follow-up count)
- The translation-matrix assertions read the real `DomainError` codes, not a hardcoded mirror

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: CI e2e lane + deploy gate

### Overview

Add a new `e2e` job that mirrors the `integration` job, handles the CI anon-key mismatch, installs chromium, provisions the author, runs the suite, and gates deploy.

### Changes Required:

#### 1. New `e2e` CI job

**File**: `.github/workflows/ci.yml`

**Intent**: Run `pnpm test:e2e` on the same trimmed Supabase stack the integration job uses (gotrue already retained), writing the CI stack's minted keys to `.dev.vars` so the workerd preview authenticates correctly.

**Contract**: Mirror the `integration` job's setup triplet (`checkout@v6`, `pnpm/action-setup@v6`, `setup-node@v6`), `supabase/setup-cli@v2`, seed-regen (`node scripts/gen-seed.mjs > supabase/seed.sql`), trimmed `supabase start -x …` (unchanged exclusion list), and env-export via `supabase status -o env … | sed 's/"//g' >> "$GITHUB_ENV"` — exporting `api.url=SUPABASE_URL`, `auth.anon_key=SUPABASE_KEY`, and `auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY`. Then, **before** the server boots, write `.dev.vars` from `SUPABASE_URL` + `SUPABASE_KEY` (the anon-key-mismatch fix — workerd reads `.dev.vars`, not the fixed local key; CI does **not** rely on `webServer.env`). Then: `pnpm exec playwright install --with-deps chromium` → `pnpm test:e2e`. The `pretest:e2e` hook runs `provision-e2e-author.mjs` automatically before the suite (uses URL + service-role from `$GITHUB_ENV`), so there is **no separate provision step** — and `test:e2e`'s `webServer` runs `pnpm build && pnpm preview`. Upload `playwright-report/` on failure (`actions/upload-artifact`, `if: failure()`).

> **Env isolation guard (e2e ↔ deploy).** The `e2e` job's `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` come **only** from its own ephemeral local stack (`supabase status`). The job must **never** reference `${{ secrets.SUPABASE_* }}` — those are the *hosted/production* project, used solely by `deploy`. Writing a production key into `.dev.vars` (or a production-keyed build) would point the workerd preview, and a real `signInWithPassword`, at **production**. Keep these vars **job-scoped** (written to `$GITHUB_ENV` inside the `e2e` job only); never promote `SUPABASE_*` to a workflow-level `env:` block, which would apply across every job. GitHub already isolates jobs (fresh runner each, `$GITHUB_ENV` is per-job), so there is no leak today — this is defense-in-depth plus a signpost for the next editor, who could otherwise copy a `secrets.SUPABASE_*` line over from `ci`/`deploy` and silently aim the e2e preview at prod.

#### 2. Gate deploy on e2e

**File**: `.github/workflows/ci.yml`

**Intent**: A red e2e must block shipping a broken auth/action boundary.

**Contract**: Change `deploy.needs` from `[ci, integration]` to `[ci, integration, e2e]` (`ci.yml:80`).

### Success Criteria:

#### Automated Verification:

- On a PR, the `e2e` job runs and passes (full chain: stack up → `.dev.vars` written → provision → build+preview → specs green)
- `deploy` is observably gated on `e2e` (does not start until `e2e` succeeds)
- No `-x` exclusion change was needed (gotrue already in the stack); existing `ci` + `integration` jobs unaffected
- Env isolation holds: the `e2e` job references **no** `secrets.SUPABASE_*` and the workflow defines **no** workflow-level `SUPABASE_*` `env:` (grep `ci.yml`); the job's Supabase vars come solely from its own `supabase status`

#### Manual Verification:

- A deliberately broken assertion (temporary) turns the `e2e` job red and blocks `deploy`, then reverts cleanly
- On failure, the uploaded `playwright-report/` artifact is present and diagnostic
- Confirm whether `webServer.env` alone suffices or `.dev.vars` is required in CI (resolves `research.md` Open Question 1) and record the answer

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 5: Docs + close-out

### Overview

Reconcile the foundation docs with the divergence this change makes, and stamp the change record.

### Changes Required:

#### 1. Amend the test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Record that the reusable e2e harness was introduced in **Phase 2** (hybrid), not deferred wholesale to Phase 3, so the doc stays truthful for the next reader (`research.md` Open Question 7).

**Contract**: Update §3 (Phase 2 test types: add e2e alongside integration, with the hybrid rationale) and §6.3 (e2e cookbook: point to `playwright.config.ts` + `e2e/` as the reusable pattern). Note cross-author/IDOR remains deferred to the RLS prerequisite.

#### 2. Document programmatic provisioning

**File**: `docs/runbooks/author-provisioning.md`

**Intent**: Add the programmatic path next to the manual Studio instructions, so the e2e author provisioning is discoverable.

**Contract**: New short section referencing `scripts/provision-e2e-author.mjs`, the env vars it reads, and the fixed-creds local default.

#### 3. Stamp + reconcile the change record

**File**: `context/changes/testing-auth-actions-boundary-rls/change.md` (+ sibling `plan-brief.md`)

**Intent**: Reflect completion state **and** make the change record match what actually shipped after the re-scope (UI happy-path e2e deferred; GRANT migration pinned) — so the closed change doesn't claim coverage it doesn't have.

**Contract**: In `change.md`: set `status: implemented` (or per the project's close-out convention) and `updated:` to the completion date once Phases 1–4 land; reconcile the §2 risk notes — mark **#5 cross-author/IDOR deferred** (candidate Phase 2.5 prerequisite, not covered here), and note **#3 persistence is proven at the integration `.handler` layer**, not over HTTP (the UI happy-path e2e is deferred). In `plan-brief.md`: flip the **Key Decisions** row "Table reachability" from "rely on auto-grant, document trap" to "**pin `GRANT … TO authenticated` migration**", and mark the Desired-End-State / Phases-at-a-Glance entries that still list the `createPlan` happy-path round-trip as in-scope e2e → **deferred**.

### Success Criteria:

#### Automated Verification:

- Markdown/prettier clean on the edited docs: `pnpm format` (no diff after) or `pnpm lint` where applicable

#### Manual Verification:

- `test-plan.md` §3/§6.3 read correctly and match what shipped (e2e in Phase 2, cross-author deferred)
- The runbook's programmatic path is accurate against the final script flags

**Implementation Note**: Final phase — confirm the docs match the shipped harness before closing the change.

---

## Testing Strategy

### Unit Tests:

- No new unit tests required — the wrapper is already unit-tested (`src/shared/lib/actions/define-domain-action.test.ts`: no-session → `UNAUTHORIZED`, `DomainError`→`ActionError`). Do not duplicate.

### Integration Tests (Phase 3):

- `DomainError`→`ActionError` translation matrix (each in-scope code, 1:1 + verbatim message) against real local Supabase, via the action `.handler` and the factory harness.
- Malformed-input rejection (`isInputError`, validated before the handler body).
- _Not re-covered:_ the no-session path — already unit-tested (`makeContext(undefined)`) and proven over HTTP by the e2e unauth spec.

### E2e Tests (Phases 1–2):

- Setup: UI sign-in → `storageState` (Phase 1).
- Authenticated dashboard loads — the `storageState` reuse proof (`chromium`).
- Guard redirect for a protected page (`chromium-guard`).
- `createPlan` unauth refusal over HTTP → `UNAUTHORIZED` (`chromium-guard`, valid input shape).
- _Deferred:_ `createPlan` happy path via the "New plan" dialog + `/_actions/createPlan` round-trip — a later UI-driven mutation e2e; persistence is covered at integration for now.

### Manual Testing Steps:

1. `pnpm env:local`, `supabase start`, `node scripts/provision-e2e-author.mjs`, `pnpm test:e2e` → all green locally.
2. Break a selector, run `@playwright/cli attach` + `snapshot` to confirm the healing workflow.
3. Open a PR; confirm the `e2e` job passes and `deploy` is gated on it.

## Performance Considerations

- e2e `webServer` is `pnpm build && pnpm preview` (~3 min build+boot); `timeout: 180_000` accommodates it. Chromium-only + `workers: 1` in CI keeps the lane lean and flake surface small. `retries: 1` + `trace: on-first-retry` is the starting flake policy — revisit after the lane has history.
- The e2e suite is read-only against domain tables (no inserts), so it leaves no residue and has no per-run collision concern; the GRANT migration (not a write probe) guarantees `authenticated` reachability.

## Migration Notes

- **One additive schema migration: the `authenticated` GRANT pin** (Phase 1 §6). It grants `authenticated` SELECT/INSERT/UPDATE/DELETE on `public` tables (current + future via `ALTER DEFAULT PRIVILEGES`), so a future Supabase flip to opt-in grants cannot silently break table reachability. No `DROP`, no data change. Deploy applies it via `supabase db push` **before** the Worker ships (additive-first convention); a code rollback does not undo it, which is safe (the grant is strictly permissive). `anon` is deliberately not granted — least privilege, since all domain-table access is gated to `authenticated`.

## References

- Research: `context/changes/testing-auth-actions-boundary-rls/research.md`
- Change identity: `context/changes/testing-auth-actions-boundary-rls/change.md`
- Test plan (to amend): `context/foundation/test-plan.md` §3, §6.3
- Predecessor harness + CI lane (mirror target): `context/changes/data-for-e2e-and-integration-tests/`
- Action wrapper: `src/shared/lib/actions/define-domain-action.ts:13-25`, `run-domain.ts:8-17`, `require-session.ts:8-12`
- Middleware seam: `src/middleware.ts:7-43`
- CI integration template: `.github/workflows/ci.yml:34-77`
- Factory harness + env gate: `src/test/factories/index.ts`, `src/test/load-test-env.ts:28-36`
- Happy-path UI: `src/_pages/plans-list/ui/PlansHub.tsx`, `PlanFormDialog.tsx`; domain fn `src/_pages/plans-list/api/create-plan.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: E2e harness scaffold + author provisioning + reachability pin

#### Automated

- [x] 1.1 Type checking + lint pass (`pnpm lint`)
- [x] 1.2 Build stays clean on workerd (`pnpm build`)
- [x] 1.3 GRANT migration applies on `supabase db reset`; `has_table_privilege('authenticated','public.plans','INSERT')` = true
- [x] 1.4 Provisioning script is idempotent across two runs (`node scripts/provision-e2e-author.mjs`)
- [x] 1.5 Setup project runs green and writes `e2e/.auth/user.json` with `sb-…-auth-token` cookie(s)

#### Manual

- [x] 1.6 Env-to-worker path confirmed: `pnpm preview` serves working sign-in, setup spec logs in
- [x] 1.7 `git status` confirms `e2e/.auth/user.json` is ignored (no live cookies staged)

### Phase 2: E2e assertion specs

#### Automated

- [ ] 2.1 Full e2e suite green across both projects (`pnpm test:e2e`)
- [ ] 2.2 Project routing correct — no storageState leak into guard specs

#### Manual

- [ ] 2.3 Healing workflow verified via `@playwright/cli attach` + `snapshot` on a broken selector
- [ ] 2.4 Session reuse proven — `e2e/.auth/user.json` rehydrates without a fresh sign-in (trace shows no `/auth/signin` redirect)

### Phase 3: Vitest integration complement

#### Automated

- [ ] 3.1 Integration suite green against local Supabase (`pnpm test:integration`)
- [ ] 3.2 Unit + steiger unaffected (`pnpm test`, `pnpm steiger`)
- [ ] 3.3 Contract assertions are key-agnostic; cross-author correctly absent

#### Manual

- [ ] 3.4 Suite leaves no residual rows (teardown verified)
- [ ] 3.5 Translation-matrix assertions read real `DomainError` codes, not a hardcoded mirror

### Phase 4: CI e2e lane + deploy gate

#### Automated

- [ ] 4.1 `e2e` job runs and passes on a PR (full chain)
- [ ] 4.2 `deploy` is observably gated on `e2e`
- [ ] 4.3 No `-x` exclusion change needed; `ci` + `integration` jobs unaffected
- [ ] 4.4 Env isolation holds: e2e job references no `secrets.SUPABASE_*`; no workflow-level `SUPABASE_*` env (grep `ci.yml`)

#### Manual

- [ ] 4.5 A deliberately broken assertion turns `e2e` red and blocks `deploy`, then reverts cleanly
- [ ] 4.6 Uploaded `playwright-report/` artifact present and diagnostic on failure
- [ ] 4.7 Env-to-worker mechanism in CI confirmed and recorded (resolves research Open Q1)

### Phase 5: Docs + close-out

#### Automated

- [ ] 5.1 Markdown/prettier clean on edited docs (`pnpm format` no-diff)

#### Manual

- [ ] 5.2 `test-plan.md` §3/§6.3 match what shipped (e2e in Phase 2, cross-author deferred)
- [ ] 5.3 Runbook programmatic-provisioning path accurate against final script flags
