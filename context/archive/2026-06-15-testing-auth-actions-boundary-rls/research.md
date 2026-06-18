---
date: 2026-06-17T16:21:50+02:00
researcher: Dobromir Kropielnicki
git_commit: 9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc
branch: main
repository: dobrek/ib-timetable-planner
topic: "First Playwright e2e pattern for the auth + Astro Actions boundary (+ RLS), local & CI"
tags: [research, codebase, testing, playwright, e2e, astro-actions, auth, supabase, ci, rollout-phase-2]
status: complete
last_updated: 2026-06-17
last_updated_by: Dobromir Kropielnicki
---

# Research: First Playwright e2e pattern for the auth + Astro Actions boundary (+ RLS)

**Date**: 2026-06-17T16:21:50+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

This is **rollout Phase 2** (`testing-auth-actions-boundary-rls`) of `context/foundation/test-plan.md` — "Auth + Astro Actions boundary + RLS / PII". It is **the first end-to-end test in the project**, to run **locally and on CI**. We want the **reusable Playwright pattern** for all further e2e development, knowing Playwright is the engine and `@playwright/cli` is already in the repo.

### Scope decisions locked with the user (2026-06-17)

| Question | Decision |
|---|---|
| e2e vs the plan's integration prescription | **Hybrid** — Playwright e2e owns the browser-observable boundary (sign-in → protected route → action happy/refused path); Vitest integration keeps cross-author RLS, `DomainError`→`ActionError` translation, and IDOR (cheaper, and a browser can't express "author B reads author A"). |
| CI test engine | **`@playwright/test`** added as the runner; **`@playwright/cli`** stays an authoring/healing aid. |
| RLS / cross-author scope | **Testable-today only** — unauthenticated rejection + auth happy path + error-translation now; defer cross-author/IDOR until an ownership column + real per-author RLS land. |

## Summary

The codebase is unusually **well-shaped for this test pattern**, and three facts make it clean:

1. **Every mutation Action is uniform.** All actions in the barrel are built through one factory, `defineDomainAction`, which always runs `requireSession → requireSupabase → runDomain(domainFn)` ([`define-domain-action.ts:13-25`](#code-references)). No handler hand-rolls the gate; **none skips `requireSession`**. So "no session ⇒ `UNAUTHORIZED`" and "`DomainError`⇒`ActionError`" are *contract-level* guarantees a test can assert against any action, not per-action behavior.
2. **The auth seam is a deny-by-default middleware with one deliberate hole.** `src/middleware.ts` 302-redirects unauthenticated *page* requests to `/auth/signin`, but **exempts `/_actions/*`** (it matches the `/_` prefix). So Actions are gated *per-handler*, not by the redirect. This is exactly the boundary the phase must prove, and it cleanly separates the two e2e assertions: **pages → redirect**, **actions → `ActionError(UNAUTHORIZED)`**.
3. **Sessions are `@supabase/ssr` cookies** → `storageState` is the correct Playwright auth-reuse mechanism, and "no cookies" is the unauthenticated case.

The work is **greenfield on the tooling side**: only `@playwright/cli@^0.1.14` exists (an agent browser tool, *not* the test runner). There is **no `@playwright/test`, no `playwright.config.*`, no `e2e/` dir**. The Vitest harness, by contrast, is mature and **directly reusable** (plan-rooted factories + teardown + CI integration lane).

**The reusable pattern (proposed):** a top-level `e2e/` dir (outside steiger's `src/` scope), a root `playwright.config.ts` with a `setup` project that logs in once via the UI and saves `storageState`, an authenticated `chromium` project and a no-storageState `chromium-guard` project, a `webServer` that **builds then previews on real workerd**, an **idempotent author-provisioning script** (`auth.admin.createUser`), and a **new CI `e2e` job** that mirrors the existing `integration` job (it already keeps gotrue in its trimmed Supabase stack). The integration complement reuses the factory harness to cover error-translation + unauth at the cheaper `.handler` layer.

**Note on the test-plan:** the plan currently slots e2e into Phase 3 ("at most one e2e") and Phase 2 as integration-only. Introducing the e2e *harness* in Phase 2 is a deliberate, user-approved divergence — the hybrid keeps the plan's cost×signal intent (RLS/translation stay at integration) while standing up the reusable e2e pattern now. **Action item: amend `test-plan.md` §3/§6.3 to record that the e2e harness was introduced in Phase 2.**

## Detailed Findings

### A. The boundary under test — what the tests must assert

**Deny-by-default middleware** ([`src/middleware.ts`](#code-references)). Allowlist: exact `["/auth/signin"]`; prefixes `["/api/auth/", "/_"]`; static-asset extension regex (`middleware.ts:7-21`). Every request still populates `context.locals.user` via network-validated `supabase.auth.getUser()` (`middleware.ts:30,35`). Unauthenticated outcomes:
- **Protected page** (e.g. `/dashboard`) → `context.redirect("/auth/signin")` = 302 (`middleware.ts:40-42`).
- **Action** (`/_actions/*`) → **not** redirected (matches `/_`, `middleware.ts:10`); reaches the handler, which throws `ActionError(UNAUTHORIZED)`. The `astro:actions` client receives `{ error }` with `error.code === "UNAUTHORIZED"`, **not** a 302.

**The uniform action wrapper** ([`src/shared/lib/actions/`](#code-references)):
- `requireSession(context)` throws `ActionError({ code: "UNAUTHORIZED", message: "You must be signed in." })` when `!context.locals.user` (`require-session.ts:8-12`).
- `requireSupabase(context)` builds the cookie-bound client; throws `INTERNAL_SERVER_ERROR` "Supabase is not configured." if env missing (`require-supabase.ts:4-10`).
- `runDomain(op)` catches `DomainError` and re-throws `ActionError({ code: error.code, message: error.message })` — **1:1 code passthrough, message verbatim** (`run-domain.ts:8-17`).
- `defineDomainAction({ input, run })` composes them: `requireSession → requireSupabase → runDomain(() => run(supabase, input))` (`define-domain-action.ts:13-25`). Every action is built this way.

**The error contract a test asserts** (three distinct channels):
| Failure | What the client sees | Source |
|---|---|---|
| No session | `error.code === "UNAUTHORIZED"`, msg "You must be signed in." | `require-session.ts:10` |
| Domain failure | `error.code ∈ {BAD_REQUEST, NOT_FOUND, CONFLICT, UNPROCESSABLE_CONTENT, INTERNAL_SERVER_ERROR}` + domain msg | `run-domain.ts:12-15`, `domain-error.ts:9-14` |
| Bad input (Zod) | `isInputError(error)` true, field errors | runs **before** the handler body (so before `requireSession`) |

> **Test-ordering nuance:** Zod `input` validation fires before the handler, so an unauthenticated request with a *malformed* body surfaces an **input error, not `UNAUTHORIZED`**. A clean `UNAUTHORIZED` assertion must send a **valid input shape with no session**.

**The action surface** ([`src/actions/index.ts:1-15`](#code-references)) — barrel spreads 7 slice maps: courses (8 actions incl. overlaps/merges), teachers + availability (7), students (3), placements (`createPlacement`/`deletePlacement`), slot bundles (`bundleSlot`/`unbundleSlot`), groupings (`computeGroupings`), plans (`createPlan`/`clonePlan`/`renamePlan`/`deletePlan`). **`createPlan` is the simplest happy-path action**: input `{ name, slotGridPreset }` (`plans-list/model/schemas.ts:9-12`) → inserts into `plans` → returns the Row (`create-plan.ts:7-11`).

**Sign-in flow & stable selectors** ([sign-in slice](#code-references)) — confirmed against both source and the captured `.playwright-cli` ARIA snapshots:
- Form: `<form method="POST" action="/api/auth/signin" noValidate>` (`SignInForm.tsx:43`). Fields are labeled `<Label htmlFor>` (`FormField.tsx:35`), `id`/`name` = `email` / `password`.
- Endpoint `signin.ts`: `signInWithPassword` → success **302 → `/dashboard`** (`signin.ts:19`); failure **302 → `/auth/signin?error=<msg>`** (`signin.ts:15-17`). Sign-out: `POST /api/auth/signout` → `/`.
- **Recommended locators** (no `data-testid` exists): `page.getByLabel('Email')`, `page.getByLabel('Password')`, `page.getByRole('button', { name: /sign in/i })`. Post-login signal: heading `Welcome back` or text `Signed in as <email>` (`DashboardPage.astro:9-12`). Authenticated probe / logout: `page.getByRole('button', { name: 'Sign out' })` (`SidebarLayout.astro:112-121`). Bad-creds signal: visible text `Invalid login credentials` (`ServerError.tsx`).

**Supabase session cookies** ([`src/shared/api/supabase.ts`](#code-references)) — `createServerClient` with no `cookieOptions.name`, so the default storage key applies: **`sb-<project-ref>-auth-token`**, chunked into `.0`, `.1`, … for large sessions. Local (`127.0.0.1:54321`) → `sb-127-auth-token*`. **For `storageState`: capture all `sb-*-auth-token*` cookies including chunks** or the session won't rehydrate. No cookies = unauthenticated.

**Protected landing pages**: `/` → 302 `/dashboard`; `/dashboard` is the post-login landing; `/plans`, `/plans/[id]` (planner board — Phase 3 drag-drop surface), catalog pages.

### B. The chosen layering (hybrid) — what goes where, and why

| Risk (test-plan §2) | e2e (Playwright) | Integration (Vitest + local Supabase) |
|---|---|---|
| **#5 unauth rejection** | ✅ page → redirect; action → `UNAUTHORIZED` (browser-observable, sets the pattern) | ✅ `.handler` with no-session fake context (cheap mirror) |
| **#5 cross-author / IDOR** | ❌ a browser can't be two authors; **deferred** (needs ownership + RLS) | ✅ *when RLS lands* — two authenticated non-service-role clients |
| **#3 Action boundary / `DomainError`→`ActionError`** | ⚠️ happy path + refused path through the real `/_actions/*` round-trip | ✅ translation matrix at `.handler` / wrapper layer |
| **#3 rejects malformed input** | — | ✅ `isInputError` at `.handler` |

**Why this split (cost×signal, test-plan §1):** the *browser-observable* truths — "an unauthenticated visitor is bounced", "a signed-in author can complete an action", "an action with no session is refused" — are exactly what only e2e proves and what sets the reusable pattern. Everything matrix-shaped (every error code, every cross-author pair) is cheaper and more exhaustive at the Vitest layer the project already runs. This honors the plan's "do not promote to e2e because it feels safer."

### C. The Playwright e2e pattern (the reusable template)

**Engine:** add `@playwright/test` (latest `1.61.x`, June 2026). `playwright install` ships with it, **not** with `@playwright/cli`. `@playwright/cli` stays the authoring/healing aid.

**Spec location — top-level `e2e/`, outside `src/`.** `pnpm steiger` is scoped to `src` only (`package.json:12`, `steiger.config.ts`), and Vitest globs are `src/**/*.test.ts` — so `e2e/` is invisible to both. Matches the repo habit of harness-outside-slices (`test/stubs/`, `src/test/factories/`).

```
playwright.config.ts          # root (picked up by `playwright test` with no flags)
e2e/
  auth.setup.ts               # logs in once → writes storageState
  .auth/user.json             # gitignored auth artifact
  specs/
    auth.spec.ts              # authenticated dashboard loads
    auth-guard.spec.ts        # NEGATIVE: no storageState → redirect to /auth/signin
    action-create-plan.spec.ts        # action happy path (createPlan round-trips 200)
    action-unauth.spec.ts             # action refused → UNAUTHORIZED
```

**`webServer` — build then preview on real workerd.** The app is workerd-only (adapter `@astrojs/cloudflare`, `output:"server"`; `astro.config.mjs`). `astro preview` runs `wrangler dev ./dist` under the hood = **true workerd against the shipped bundle**, on port **4321**. Use `command: "pnpm build && pnpm preview"`, `timeout: 180_000` (build + boot is slow), `reuseExistingServer: !CI`. (`astro dev` is faster but Vite-emulated, not prod-fidelity; optional local fast-toggle only.)

```ts
// playwright.config.ts (root)
import { defineConfig, devices } from '@playwright/test';
const PORT = 4321; const baseURL = `http://localhost:${PORT}`;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: { baseURL, headless: true, trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'chromium', testIgnore: /.*(guard|unauth)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'] },
    { name: 'chromium-guard', testMatch: /.*(guard|unauth)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: { cookies: [], origins: [] } } },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: baseURL, reuseExistingServer: !process.env.CI, timeout: 180_000,
    env: { SUPABASE_URL: process.env.SUPABASE_URL!, SUPABASE_KEY: process.env.SUPABASE_KEY! },
  },
});
```

```ts
// e2e/auth.setup.ts
import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
const authFile = path.join(import.meta.dirname, '.auth/user.json');
setup('authenticate', async ({ page }) => {
  await page.goto('/auth/signin');
  await page.getByLabel('Email').fill(process.env.E2E_AUTHOR_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_AUTHOR_PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/dashboard');
  await page.context().storageState({ path: authFile });
});
```

**Asserting the action boundary from the browser** — drive the UI control, then assert (a) the rendered result and/or (b) the real round-trip:
```ts
const [resp] = await Promise.all([
  page.waitForResponse(r => r.url().includes('/_actions/createPlan') && r.request().method() === 'POST'),
  page.getByRole('button', { name: /create/i }).click(),
]);
expect(resp.status()).toBe(200);
```
For the **refused path**, run in `chromium-guard` (no storageState) so the **real server-side `requireSession`** rejects it — a true boundary test, not `page.route` mocking. (Reserve `page.route` for hard-to-provoke 500s; `request-mocking.md`.)

**`@playwright/cli` as the authoring/healing aid** (`.claude/skills/playwright-cli/`): `snapshot` + `fill`/`click` emit paste-ready `getByRole`/`getByLabel` locators (`test-generation.md`, `spec-driven-testing.md`); `generate-locator e5 --raw` for stable locators; `state-save`/`cookie-list` to eyeball what `@supabase/ssr` actually sets before committing the setup spec (`storage-state.md`); `attach` + `snapshot`/`console`/`requests` to heal selector drift (`playwright-tests.md`). Rule from the skill: **no sleeps, no `networkidle`**.

**Drag-drop is Phase 3, not now.** The grid uses `@dnd-kit/react`, whose pointer sensor needs ≥2 `mousemove`s — `locator.dragTo()` alone often won't fire `dragover`. Keep this phase to auth + action happy/refused.

### D. Test-author provisioning (hard dependency)

There is **no self-service signup** (app has no route; `config.toml` `enable_signup = false`); `docs/runbooks/author-provisioning.md` documents **manual** Studio/dashboard creation only. The seed does **not** touch `auth.users`. Locally `enable_confirmations = false`, so a created user is immediately sign-in-ready.

**Recommended: an idempotent Node script** matching `scripts/*.mjs` conventions (ESM, shebang, reads `process.env`, diagnostics → stderr) — `scripts/provision-e2e-author.mjs`, using `@supabase/supabase-js` (already a dep) `auth.admin.createUser({ email, password, email_confirm: true })` with the **service-role key** (admin API bypasses `enable_signup=false`). Tolerate "already registered" on re-run. Invoke before Playwright both locally (`pretest:e2e`) and in CI. Scripts run in Node on the runner — **workerd constraints do not apply**.

### E. CI lane — mirror the existing `integration` job

The `integration` job (`.github/workflows/ci.yml:34-77`) is the template, and crucially it **already keeps gotrue (auth) in its trimmed Supabase stack** ("cheap; future RLS/e2e", `ci.yml:56-57`) — so sign-in works with **no change to the `-x` exclusion list**. Mirror its setup triplet (`checkout@v6`, `pnpm/action-setup@v6`, `setup-node@v6` + `supabase/setup-cli@v2`), seed-regen (`node scripts/gen-seed.mjs > supabase/seed.sql`), trimmed `supabase start`, and env-export (`supabase status -o env … >> $GITHUB_ENV` with the quote-stripping `sed`). Then: `playwright install --with-deps chromium` → `node scripts/provision-e2e-author.mjs` → `pnpm test:e2e`. Add `e2e` to `deploy`'s `needs: [ci, integration, e2e]` so a red e2e blocks deploy.

**CI gotchas (load-bearing):**
1. **Anon-key mismatch.** The webServer/worker reads `SUPABASE_URL`/`SUPABASE_KEY` via `astro:env/server` from **`.dev.vars`** on workerd. `pnpm env:local` copies `.envs/local.vars`, whose key is a *fixed* local publishable key that **won't match the CI stack's minted keys**. In CI you must write `.dev.vars` (or pass env) from the CI stack's `SUPABASE_URL` + `SUPABASE_ANON_KEY` (→ `SUPABASE_KEY`). If `createClient` is `null`, sign-in silently fails with "Supabase is not configured."
2. **Env-to-worker path needs verification.** Whether `webServer.env` reaches the workerd preview, or whether a written `.dev.vars` is required, should be confirmed empirically during implementation (see Open Questions).
3. **Grant fragility.** No migration contains an explicit `GRANT`; table reachability for `authenticated` relies on Supabase's auto-grant for new `public` tables (README flags the platform is moving to opt-in). Works today locally/CI; if it flips, the e2e author hits "permission denied for table plans" even though RLS `using(true)` allows it. Optional mitigation: pin a `GRANT … TO authenticated` migration.
4. **No DB reset between runs** (like integration) — use unique plan names per run (the factory already does, `create-plan.ts`).
5. **gitignore additions:** `.auth/` and Playwright outputs (`test-results/`, `playwright-report/`, `.playwright/`) are **not** currently ignored (only `.playwright-cli`/`.playwright-mcp` are; `.env.test.local` is covered by `.env*`). Add them — storageState holds live auth cookies.

### F. The integration complement — reuse + the real gaps

**Reusable as-is:** the full factory harness (`createPlan`/`seedPlanCatalog`/`teardown`/`registerPlan`, plan-rooted isolation, `src/test/factories/index.ts`); the `.env.test.local` + `load-test-env.ts` env-gate (local skip / CI fail-loud); the `(hasEnv ? describe : describe.skip)` idiom; the `astro:actions` stub (`ActionError`, `ActionErrorCode` incl. `UNAUTHORIZED`, `defineAction` passthrough, `ActionAPIContext`) already used by `define-domain-action.test.ts` to unit-test the wrapper (no-session → `UNAUTHORIZED`; `DomainError`→`ActionError`).

**Gaps for the auth/actions boundary at integration level:**
1. `astro:actions` is aliased in `vitest.config.ts` (unit) **but not** `vitest.integration.config.ts`. To exercise an action through the wrapper in the integration lane, add the same alias — **or** keep the unit pattern (import the action, invoke `.handler(input, fakeContext)`).
2. **No "Action over real HTTP" harness** (no `app.render()` / `experimental_AstroContainer` / fetch-to-`/_actions/*`). The over-HTTP truth is what **e2e now covers** (`page` driving `/_actions/*`); integration stays at `.handler`.
3. **No authenticated, non-service-role client / session helper** — everything uses the RLS-bypassing service-role key. This is exactly what cross-author/IDOR needs and is **deferred with the RLS prerequisite**.
4. **No "simulate no session" integration utility** — unit fakes it via `makeContext(undefined)`; reuse that pattern.

**Net for testable-today:** e2e covers the HTTP round-trip (happy + refused); integration adds (or extends) `.handler`-level coverage of the `DomainError`→`ActionError` translation matrix and the unauth path — no new HTTP harness required.

### G. RLS reality + the deferred half

RLS is enabled on all domain tables with **permissive `for all to authenticated using(true) with check(true)`** policies (`supabase/migrations/20260602185012_minimal_domain_schema.sql:150-174`, and later table migrations). **There is no owner column.** Integration suites use the **service-role key, which bypasses RLS** ("authenticated = full access"). A normal authenticated e2e author (anon key + cookie session) runs as `authenticated` and **can** read/write `plans` under today's policies + auto-grants — so the **happy path works**. The **cross-author/IDOR half is not meaningfully testable** until an ownership column + real per-author policies land; per the locked scope it is **deferred to a future change** (candidate Phase 2.5 / prerequisite for the full Risk #5 closure).

## Code References

GitHub permalinks at commit `9e9d6ba`:

- Middleware (deny-by-default, `/_` exemption, redirect): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/middleware.ts#L7-L43
- `defineDomainAction` (uniform `requireSession→requireSupabase→runDomain`): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/shared/lib/actions/define-domain-action.ts#L13-L25
- `requireSession` (UNAUTHORIZED): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/shared/lib/actions/require-session.ts#L8-L12
- `runDomain` (DomainError→ActionError, 1:1): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/shared/lib/actions/run-domain.ts#L8-L17
- `DomainError` codes: https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/shared/lib/errors/domain-error.ts#L9-L24
- Actions barrel (all action names): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/actions/index.ts#L1-L15
- `createPlan` domain fn (happy-path target): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/_pages/plans-list/api/create-plan.ts#L7-L11
- Sign-in form (selectors): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/_pages/sign-in/ui/SignInForm.tsx#L43-L84
- Sign-in endpoint (302 → /dashboard | ?error=): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/pages/api/auth/signin.ts#L4-L19
- Supabase SSR server client (cookie session): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/shared/api/supabase.ts#L6-L25
- Dashboard "Signed in as" (logged-in assertion): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/_pages/dashboard/ui/DashboardPage.astro#L9-L12
- CI workflow (integration job = the template): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/.github/workflows/ci.yml#L34-L77
- Factory harness barrel: https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/test/factories/index.ts#L4-L12
- Env gate / CI fail-loud: https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/test/load-test-env.ts#L7-L35
- Reference integration suite (domain fn vs local Supabase): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/src/_pages/plans-list/api/plan-actions.integration.test.ts#L22-L74
- Permissive RLS policies (`using(true)`): https://github.com/dobrek/ib-timetable-planner/blob/9e9d6ba7ad686600d9c5ceee82c0ef9232ba67bc/supabase/migrations/20260602185012_minimal_domain_schema.sql#L150-L174

Local-only (not committed): `.playwright-cli/page-2026-06-15T*.yml` — captured ARIA snapshots of `/auth/signin`, bad-creds error, and `/dashboard` confirming the selectors above.

## Architecture Insights

- **Uniformity is the test's best friend.** Because *one* factory builds every action, the auth/translation contract is provable once and holds for all actions — the e2e need only pick one representative action (`createPlan`), and the integration matrix tests the wrapper, not N handlers.
- **Two-layer auth by design:** middleware protects *navigation* (pages → redirect); handlers protect *mutation* (`/_actions/*` → `requireSession`). The phase exists precisely because the second layer is per-handler and the `/_` exemption is easy to misread as "actions are unprotected." The two e2e assertions map 1:1 onto these two layers.
- **Plan-rooted isolation** (everything FK-cascades from `plans.id`; one delete tears down the graph) makes both the integration lane and any e2e-created data safe to run in parallel and against a shared DB — reuse it for e2e cleanup too.
- **Fidelity choice matters here:** the boundary being tested (`/_actions/*` + `astro:env/server` secrets + cookie SSR) only behaves correctly on real workerd, so the e2e *must* run build+preview, not `astro dev`.
- **Test pyramid for this project:** unit (independent oracle, wrapper logic) → integration (domain + wrapper `.handler` + RLS-when-it-lands) → **e2e (browser-observable auth + one action round-trip)**. e2e is the thin top, introduced here as the reusable harness.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md` §3 — Phase 2 is *this* change; Phase 0 (`data-for-e2e-and-integration-tests`, complete 2026-06-15) stood up the factory harness + CI integration lane this research reuses; §4 names Playwright as the candidate runner and §3 notes the RLS prerequisite (`using(true)` + service-role bypass).
- `context/changes/data-for-e2e-and-integration-tests/` — the integration harness + CI lane this e2e job mirrors (gotrue deliberately retained in the trimmed stack for "future RLS/e2e").
- `context/changes/test-plan-refresh-2026-06-15/` — the post-FSD refresh that re-anchored the boundaries and re-sequenced the rollout.
- `context/foundation/lessons.md` — "Astro Actions are the single transport for app-data mutations and compute" (the rule that makes the boundary uniform); guard against re-testing already-covered domain logic.
- `docs/runbooks/author-provisioning.md` — manual-only today; this change proposes the first programmatic provisioning path.

## Related Research

None prior for e2e/Playwright (this is the first). Companion artifacts live under `context/changes/data-for-e2e-and-integration-tests/` (the integration-harness predecessor).

## Open Questions

1. **Env-to-worker mechanism (verify empirically):** does `webServer.env` reach the workerd preview, or must CI write `.dev.vars` (SUPABASE_URL + anon key) before starting the server? Confirm during implementation; the anon-key-mismatch trap (§E.1) makes this the highest-risk wiring detail.
   - **Resolved (CI run #37, `e4ac4c2`):** the e2e job writes `.dev.vars` from the CI stack's minted keys and the suite went green — the `setup` spec signed in against the workerd preview (no "Supabase is not configured.") and provisioned `e2e-author@example.test` authenticated end-to-end. This **confirms the `.dev.vars` path works in CI** with minted keys (which differ from the fixed local publishable key, so this is a real test of the wiring, not a coincidence). It does **not** prove `.dev.vars` is strictly *required*: the config also forwards `webServer.env`, and in CI that block carries the same minted `SUPABASE_URL`/`SUPABASE_KEY` from `$GITHUB_ENV`, so both sources agree. We therefore **write `.dev.vars` deterministically rather than rely on `webServer.env`** (the robust choice the plan committed to). Fully isolating which source workerd binds would need a negative experiment (omit `.dev.vars`, or poison one source) — out of scope; the deterministic write makes it moot.
2. **CI author credentials:** generate the E2E author at runtime via the provisioning script with fixed creds (recommended — no secret to rotate), or store `E2E_AUTHOR_EMAIL/PASSWORD` as CI secrets? Local stack only, so fixed creds are low-risk.
3. **Where does the unauth-*action* assertion live** — e2e (`chromium-guard` driving `/_actions/createPlan` with no cookies) or integration (`.handler` with no-session context), or both? Both is cheap and covers HTTP + logic; recommend both.
4. **Defensive `GRANT` migration** now (pin reachability) vs. rely on auto-grant and revisit if it breaks?
5. **Single-browser vs cross-browser:** chromium-only for the first pattern (recommended); add firefox/webkit only if regressions appear.
6. **Flake/retry policy:** `retries: 1` + `trace: on-first-retry` in CI as the starting default; revisit after the lane has history.
7. **Amend `test-plan.md`** §3 (Phase 2 test types) + §6.3 (e2e cookbook) to record that the e2e harness was introduced in Phase 2 (hybrid), not deferred wholesale to Phase 3.
