---
project: ib-timetable-planner
assessed_at: 2026-10-10T10:17:07+02:00
agent_readiness: ready-with-compensation
context_type: brownfield
stack_components:
  language: TypeScript 6.0.3 (app) + Python ≥3.13 (solver) + Deno TypeScript (Edge Function, new)
  framework: Astro 7.3.2 + React 19.2.7 islands; Supabase Postgres + Auth; Supabase Edge Functions via @supabase/server (new); or-tools CP-SAT + FastAPI (solver)
  build_tool: Astro / Vite 8 (Rolldown); uv + hatchling (solver); Supabase CLI bundler (functions, new)
  test_runner: Vitest 4.1.11 + Playwright 1.61 (app); pytest (solver)
  package_manager: pnpm 12.9.1 (app); uv (solver)
  ci_provider: GitHub Actions
  deployment_target: Cloudflare Workers + Cloudflare Containers; hosted Supabase (+ Edge Functions, new); Resend SMTP (new)
gates_passed: 20
gates_failed: 1
---

# Stack Assessment — IB Timetable Planner (user management & privileges)

> Assessed against the user-management PRD (`context/foundation/prd.md`, 2026-10-10,
> `context_type: brownfield`) and the decisions recorded in
> `context/changes/user-managment-research/research.md` (§ Answers). Replaces the 2026-07-16
> assessment (CP-SAT change, verdict `ready-with-compensation`, last committed in `9d184e0`).
>
> **What changed since then.** Every compensation that assessment asked for has landed: `mypy
> --strict` over solver `src/` + `tests/` in the CI `solver` job (`services/solver/pyproject.toml`
> `[tool.mypy]`), a solver section in `CLAUDE.md`, the post-cutoff platform rules, and the
> "Astro 6" → "Astro 7" fix. Its one failed check (solver typing) now passes.
>
> **What this change adds.** The wire contract and solver are untouched (PRD § Constraints). The
> change leans on stack surfaces the repo has never used: a **Supabase Edge Function** (a second
> TypeScript runtime, Deno) holding the secret key for account lifecycle; **Resend** as custom
> SMTP; four Auth flows (`inviteUserByEmail`, `verifyOtp` with `token_hash`,
> `resetPasswordForEmail`, `updateUser`); and a rewrite of 16 RLS policies around a role helper.

## Stack Components

**Language (app): TypeScript 6.0.3, strict.** `tsconfig.json` extends `astro/tsconfigs/strict`.
ESLint runs `tseslint.configs.strictTypeChecked` + `stylisticTypeChecked` with `projectService`
(`eslint.config.js:15-21`) and enforces `type` over `interface`
(`consistent-type-definitions`). Zod 4.5.4 at runtime boundaries. `pnpm check` and `pnpm lint`
are CI gates.

**Framework (app): Astro 7.3.2 + React 19.2.7 islands.** Server output on
`@astrojs/cloudflare` 14.3.1. The React Compiler (`babel-plugin-react-compiler` 1.0.0) is
lint-backed by `eslint-plugin-react-compiler`. Feature-Sliced Design sits on top and is
machine-enforced: `steiger src --fail-on-warnings` is a CI gate. File routing in `src/pages/`,
Astro Actions in `src/actions/index.ts`, deny-by-default middleware in `src/middleware.ts`
(45 lines, `getUser()` per request).

**Data + auth platform: Supabase.** `@supabase/supabase-js` 2.116.0, `@supabase/ssr` 0.12.7,
Supabase CLI 2.117.0. 59 migrations in `supabase/migrations/`. Generated types are committed
verbatim at `src/shared/api/database.types.ts` (1,082 lines, prettier-ignored so a regen diff
shows only the schema change). The Custom Access Token Hook is enabled for the solver machine user
(`supabase/config.toml:277-279`). Hosted signs with ES256, and every env file on the developer
machine already uses `sb_publishable_…` / `sb_secret_…` keys (research § Answers, Q5).

**Edge Function: Deno + `@supabase/server` (new, decided 2026-10-10).** Not yet in the repo:
there is no `supabase/functions/`. `[edge_runtime] enabled = true` in `config.toml:367`, but the CI
stack starts with `edge-runtime` and `mailpit` excluded
(`.github/actions/supabase-stack/action.yml:28`), and the `deploy` job has no
`supabase functions deploy` step.

**Email: Resend (new).** eu-west-1 sending domain, shared with S-310 (research Q6). It is
configured, not coded: hosted SMTP and templates change through the dashboard or Management API.
`[auth.email.smtp]` is commented out in `config.toml:223`.

**Build tool: Astro over Vite 8 (Rolldown).** Near-zero config. The one deliberate exception is
the `ssrPrebundleDeps()` workaround in `astro.config.mjs`, which is already documented in
`CLAUDE.md`.

**Test runners.** Vitest 4.1.11 with five configs (unit, integration, analyze, experiment, bench).
2,006 unit tests in 215 files and 36 `*.integration.test.ts` suites are co-located per FSD segment, plus 26
Playwright specs under `e2e/`. Solver: pytest with a `baseline` marker.

**Solver (not touched by this change).** Python ≥3.13, uv, ruff, `mypy --strict`, or-tools
9.15, FastAPI. Assessed only for completeness.

**CI/CD.** GitHub Actions has five jobs (`verify`, `integration`, `e2e`, `solver`, `deploy`).
Remote actions are SHA-pinned and `GITHUB_TOKEN` is read-only. `deploy` applies migrations to hosted
on every merge to `main`.

**Instruction files.** `CLAUDE.md` (65 lines: hard rules, post-cutoff rules, solver section),
`AGENTS.md` (an `@CLAUDE.md` include), five project skills under `.claude/skills/` (including
`supabase` and `supabase-postgres-best-practices`), `context/foundation/ui-conventions.md`
(276 lines), `context/foundation/lessons.md` (87 lines) and four runbooks in `docs/runbooks/`.

## Quality Gate Assessment

| Component | Typed | Convention | Training data | Documented | Verdict |
|---|---|---|---|---|---|
| TypeScript 6 (app) | ✓ | — | — | — | pass |
| Astro 7 + React 19 islands | — | ✓ | ✓ | ✓ | pass |
| Vite 8 (via Astro) | — | ✓ | ~ | ✓ | pass (already compensated) |
| Vitest 4 + Playwright | — | — | ✓ | ✓ | pass, with a harness gap |
| Supabase Postgres + Auth | ✓ | ✓ | ~ | ✓ | pass, with a note |
| **Edge Function: Deno + `@supabase/server` (new)** | ✓ | ~ | **✗** | ✓ | **fail on training data** |
| Resend SMTP + Auth email templates (new) | — | — | ✓ | ✓ | pass |
| Python ≥3.13 (solver, not touched) | ✓ | — | — | — | pass |
| or-tools CP-SAT + FastAPI (solver, not touched) | — | ~ | ✓ | ~ | partial (carried over) |
| pytest + uv (solver, not touched) | — | ✓ | ✓ | ✓ | pass |

Legend: ✓ = pass, ✗ = fail, ~ = partial, — = not applicable.
20 checks pass, 1 fails and 5 are partial. Partials are compensated, not failed.

### Gate Details

**Type safety: TypeScript app passes.** Evidence: `tsconfig.json` → `astro/tsconfigs/strict`;
type-aware ESLint (`strictTypeChecked`); `pnpm check` in CI `verify`. Nothing to add.

**Type safety: Supabase data layer passes.** Evidence: `createServerClient<Database>` in
`src/shared/api/supabase.ts:25` against the committed `database.types.ts`. Gap: no script,
README line or instruction rule says how to regenerate it. The comment in `.prettierignore` is
the only place `supabase gen types typescript` appears. This change adds roles, profiles,
attribution and "current plan" columns, so the file will drift unless the step is written down.

**Type safety: Edge Function passes.** Deno type-checks TypeScript natively, and
`@supabase/server/core` exposes `createContextClient<Database>()` / `createAdminClient<Database>()`
(Context7 `/supabase/server`, `docs/typescript-generics.md`). Typing itself is not the risk. The
risk is that the repo's TypeScript gates cannot see the function's code at all (see the
convention check below).

**Type safety: solver passes.** Evidence: `[tool.mypy] strict = true`, `files = ["src", "tests"]`;
`uv run mypy` in the CI `solver` job.

**Conventions: app passes.** Evidence: Astro file routing plus FSD under `steiger
--fail-on-warnings` (`package.json` `steiger` script, `steiger.config.ts`). Layer violations are
caught by CI, not review.

**Conventions: Supabase passes.** Evidence: CLI-owned layout (`supabase/migrations/`,
`config.toml`, `seed.sql`), and README § Database documents migration practice and the
grant/RLS split. Note: the "no `SECURITY DEFINER`" posture is a real house rule, but it lives
**only in migration comments** (`20260810200934_custom_access_token_hook.sql:12` calls it "this
schema's hard rule"; three RPC migrations repeat "Do NOT add SECURITY DEFINER"). `CLAUDE.md` never
states it. This change needs a scoped exception to it (research §5: `private.app_role()`, a
`security definer` helper in a non-exposed schema), so an agent has to know both the rule and the
exception.

**Conventions: Edge Function is partial.** Supabase prescribes the layout
(`supabase/functions/<name>/index.ts`, a per-function `deno.json` used as the import map, per
the CLI's `deploy.ts`). The repo has no conventions for a second runtime yet, and the defaults
will collide:

- Root `tsconfig.json` has `"include": ["**/*"]` with only `dist` excluded. A Deno file with
  `npm:@supabase/server` specifiers lands in `pnpm check` and in ESLint's `projectService`, which
  either breaks both gates or pushes an agent toward `// @ts-ignore`.
- `@/*` path aliases and FSD imports from `src/` do not exist in the function's runtime.
- Neither Deno nor a `deno check` / `deno lint` step is pinned in `mise.toml` (`[tools]` is
  `uv` and `shellcheck` only) or run in CI.

**Training data: app passes.** Astro, React, Vitest, Playwright and pnpm are mainstream JS.
Vite 8's Rolldown/Environment API is partial, but `CLAUDE.md`'s post-cutoff rules already
compensate.

**Training data: Supabase is partial.** Supabase core is mainstream in the JS/Postgres family.
The surfaces this change depends on are newer than most training data, and agents reliably emit
the older idiom:

- the new `sb_publishable_` / `sb_secret_` keys and asymmetric (ES256) JWT signing, where agents
  default to `anon` / `service_role` / HS256;
- Auth Hooks, still labelled Beta;
- invite and recovery via `token_hash` + `verifyOtp` on an `/auth/confirm` route. PKCE does not
  cover invites (research § email flows), but agents habitually reach for
  `exchangeCodeForSession`.

Separately, one repo comment actively misleads. `supabase/config.toml:272-273` says the hosted
hook "needs a one-time `supabase config push`", but the PRD (§ Constraints: "never `config push`")
and `docs/runbooks/solver-credential.md` prescribe the dashboard toggle.

**Training data: Edge Function fails (the one failed check).** Edge Functions on Deno are
well-trodden, but `@supabase/server` was first published in **2026-03** (research §6: "after the
knowledge cutoff, so verify it"). Within its own family it is a brand-new package. An agent will
not have internalized `withSupabase({ auth: 'user' })`, the `ctx.supabase` / `ctx.supabaseAdmin`
split, or the requirement to set `verify_jwt = false` for the function in `config.toml` because the
library verifies against the project JWKS itself (Context7 `/supabase/server`,
`docs/mcp.md`). Agents will fall back to the older hand-rolled `createClient(…,
SUPABASE_SERVICE_ROLE_KEY)` pattern. That pattern works, but it defeats the reason this mechanism
was chosen.

**Training data: Resend passes.** It is a mainstream transactional-email provider with a
documented Supabase SMTP integration.

**Documentation: app, Supabase, Resend pass.** docs.astro.build, react.dev, vitest.dev,
playwright.dev, supabase.com/docs and resend.com/docs are versioned and current.

**Documentation: Edge Function passes.** `@supabase/server` has official docs in its repository,
646 indexed snippets (Context7 `/supabase/server`, source reputation High) and a bundled
`skills/supabase-server/SKILL.md`. The docs are good. What's missing is training data.

**Test runners: pass, with a harness gap that matters here.** Vitest and Playwright pass both of
their checks. But all 36 integration suites build their client with the **service-role key, which
bypasses RLS** (`src/test/load-test-env.ts:28-35`, research §1). The repo has no helper that signs
in as an ordinary user. The riskiest part of this change, the 16-policy rewrite and the fail-closed
"no role → no data" rule, currently has **no machine signal**: every existing suite stays green
whatever the policies say. The CI stack also excludes `mailpit` and `edge-runtime`, so an invite
or Edge Function test that passes locally fails in CI with a connection error.

## Gaps & Compensation

None of these is a reason to change the stack. Each one has a concrete patch, and most land inside
phases this PRD already scopes (research's P0 hygiene, P5 Edge Function).

### 1. `@supabase/server` is not in training data (failed check)

**Why it matters.** This function is the only place the secret key exists outside a human shell.
It is the mechanism chosen to keep `deploy-plan.md:141` ("Secret key NOT pushed") intact. An
agent writing it from memory will produce a service-role client with a hand-rolled JWT check. That
is plausible code with exactly the failure modes the decision exists to prevent: trusting a
`role` claim, accepting `app_metadata` from the request body, or forgetting the live admin
lookup.

**Compensation.**
- Doc-first rule (below).
- A named, minimal surface: one function, a fixed allowlist of operations, input validated with
  Zod at the top.
- A test that calls it as a non-admin and asserts a refusal.

### 2. Second TypeScript runtime has no repo conventions (partial convention)

**Why it matters.** Without exclusions, the first function file breaks `pnpm check` and
`pnpm lint` on unrelated work. The obvious agent "fix" is an ignore comment rather than a
boundary.

**Compensation.** Exclude the functions tree from the Node toolchain and give it its own checks.

`tsconfig.json`:

```jsonc
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "supabase/functions"],
  // …compilerOptions unchanged
}
```

`eslint.config.js`: add `supabase/functions/**` to the global ignores. Then pin Deno in
`mise.toml` `[tools]` and run `deno check` + `deno lint` over `supabase/functions/` in CI
`verify`. The exact task name and script location are a planning decision. Follow the repo's
mise-as-catalog pattern: a script under `scripts/` and a one-line `run`.

### 3. Supabase Auth surfaces newer than training data, plus a misleading comment (partial training data)

**Why it matters.** Invites, resets and role checks are the entire user-facing surface of this
change. If an agent defaults to old idioms, the result is links consumed by mail scanners, a
`redirectTo` silently replaced by the Site URL, or role checks read from a JWT claim that stays
stale for up to an hour (research probe 2). The `config push` comment invites an agent to
overwrite hosted auth config from the local file.

**Compensation.** Rules below. Fix `supabase/config.toml:272-273` to point at the dashboard
toggle and the runbook instead of `supabase config push`. It is a config comment, not an applied
migration, so editing it is safe.

### 4. `SECURITY DEFINER` rule is invisible to the instruction file (convention note)

**Why it matters.** This change needs exactly one exception to a rule the agent cannot see. The
likely outcomes: an agent either reinvents the role check as INVOKER and recurses through RLS, or
learns from the exception that DEFINER is acceptable and spreads it.

**Compensation.** State the rule and its single scoped exception in `CLAUDE.md` (below).

### 5. No test runs as a real role (test-harness gap)

**Why it matters.** "No author loses access or edits" and "a viewer sees everything read-only"
are PRD guardrails. Today the integration suites cannot fail on either, because service-role
bypasses RLS. `lessons.md` already records one case where reading the migration text gave the
wrong answer about the real grant posture ("confirm with `has_table_privilege`").

**Compensation.**
- A rule that RLS and role changes are proven by suites signing in as each role.
- Re-include `mailpit` (and `edge-runtime` once the function lands) in the CI stack's `-x` list.
  The harness itself is planning work; `/10x-health-check` should rank it.

### 6. Generated DB types have no documented regen step (typed note)

**Compensation.** One rule (below). Optionally add a `db:types` pnpm script, which is JS-side
canon and allowed by the solver-section rule.

### 7. Stale README line an agent could act on (instruction drift)

README § Database → Rollback says "There is no production data to preserve yet … drop and
re-push". The PRD (§ Data migration) records that hosted now holds real school data. An agent
reading the README could treat drop-and-re-push as an allowed recovery. Replace the paragraph
with the additive-only rule.

### Recommended Instruction File Additions

Paste into `CLAUDE.md` (`AGENTS.md` includes it automatically):

```markdown
## Database & auth rules (Supabase)

- **Hosted holds real school data. Migrations are additive only**, never `DROP`, never
  drop-and-re-push. CI applies every pending migration to hosted on merge, so each one must be
  safe against live data on its own.
- **No `SECURITY DEFINER` in exposed schemas.** RPCs stay INVOKER so RLS governs them. The single
  sanctioned exception is the role helper in the non-exposed `private` schema: `security definer`,
  `set search_path = ''`, execute revoked from `anon` and `public`, and it reads only the
  caller's own role row by `auth.uid()`. Do not add a second one without recording why.
- **Human roles live in `public.user_roles` (one row per user, `user_id` primary key) and are
  read live** through the `private` helper, both in RLS and in the app. Never authorize a human
  from a JWT claim: claims stay stale until the next token refresh (up to 1 h), and the PRD
  requires a role change to apply on the user's next action. `app_metadata.machine_role` is
  reserved for machine users. An admin-controlled value must never reach `claims.role`.
- **No role means no data (fail-closed).** Every read policy requires a role row. Machine users
  have no row, and user-management code refuses to list or touch any account with
  `app_metadata.machine_role` set.
- **Prove RLS and role changes with a real signed-in user per role** (admin, author, viewer,
  no role) in an integration suite, never with the service-role client, which bypasses RLS. Confirm
  grant posture with `has_table_privilege(...)`, not by reading the migration
  (see `context/foundation/lessons.md`).
- After any migration that changes a table or column, regenerate types:
  `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts`.
  The file is committed verbatim and prettier-ignored; never hand-edit it.
- **Hosted auth config (SMTP, Site URL, redirect allowlist, email templates, hooks) changes by
  hand** in the dashboard or via the Management API, following the runbook. Never run
  `supabase config push`. `supabase/config.toml` configures the local stack only.
- Supabase uses the new key types (`sb_publishable_…` in the Worker, `sb_secret_…` only in
  Node tooling and the Edge Function) and ES256 JWT signing. Do not write `anon` or `service_role`
  JWT idioms or HS256 assumptions. Before writing Auth code, fetch current docs (Context7
  `/supabase/supabase`, `/supabase/ssr`).
- **Invite and password-recovery links use `token_hash` + `verifyOtp`** on a confirm page that
  needs a deliberate button click, so a mail scanner opening the link does not consume it. PKCE
  `exchangeCodeForSession` does not cover invites. `redirectTo` must be on the redirect
  allowlist or Auth silently replaces it with the Site URL.
- **Public routes:** `src/middleware.ts` stays deny-by-default. The only planned additions are
  invitation acceptance and password reset, each with a one-line reason comment like the
  existing entries.
- Role checks never enter the pure validation core in `src/entities/timetable/`. They gate UI
  affordances (read once per render) and server writes (RLS), so drag-drop validation keeps its
  <200 ms budget.

## Edge Functions (`supabase/functions/`, Deno)

- **Account lifecycle (invite, create, ban, delete, email change) runs only in the Supabase Edge
  Function**, which holds the secret key. The app Worker never holds a secret key
  (`context/deployment/deploy-plan.md:141`). Do not "simplify" by moving the call into an Astro
  Action.
- **`@supabase/server` was first published 2026-03, after most models' training data. Never
  write it from memory:** fetch Context7 `/supabase/server` first. Use
  `withSupabase({ auth: 'user' })`, and set `verify_jwt = false` for the function in
  `supabase/config.toml` because the library verifies the caller against the project JWKS itself.
- Inside the function, check that the caller is an admin **live** (query `user_roles` through
  `ctx.supabase`, under the caller's RLS) before touching `ctx.supabaseAdmin`. Accept a fixed set
  of operations, validate input with Zod, and **never accept `app_metadata`, `role` or a user id
  for a machine user from the request**. Never log or return a key.
- Functions are a separate runtime: each has its own `deno.json`, shared code goes in
  `supabase/functions/_shared/`, and nothing imports from `src/` or uses the `@/` alias. They are
  excluded from the root `tsconfig.json` and ESLint and checked with `deno check` / `deno lint`.
- The CI Supabase stack (`.github/actions/supabase-stack/action.yml`) excludes `edge-runtime`
  and `mailpit` to save boot time. A suite that needs either must re-include it there, or it
  will pass locally and fail in CI.
```

And two one-off fixes outside `CLAUDE.md`:

- `supabase/config.toml:272-273`: replace "the hosted project needs a one-time
  `supabase config push`" with "the hosted hook is enabled by hand in the dashboard — see
  `docs/runbooks/solver-credential.md`; never `config push`".
- README § Database → Rollback: replace "There is no production data to preserve yet … drop and
  re-push" with the additive-only rule.

## Summary

**Overall: ready-with-compensation.** The core stack is agent-ready as it stands:

- strict TypeScript with type-aware lint;
- FSD under steiger;
- a mainstream, well-documented Astro/React/Supabase stack;
- a solver whose one gap from the last assessment (unenforced types) is now closed by
  `mypy --strict` in CI.

The compensation burden sits on what this change adds. Only one check fails outright: an Edge
Function built on `@supabase/server`, a package newer than most training data, guarding the only
deployed copy of the secret key. Two partial gaps add to that burden: Auth idioms that agents tend
to write in their outdated form, and a test harness that cannot observe RLS at all.

**Key strengths.** The fail-closed culture is already explicit in the code (hook allowlist,
launcher guards, deny-by-default middleware). The PRD's role model extends that culture rather than
fighting it. CI already gates type, lint, structure and four test lanes, and SHA-pinned actions keep
the gate trustworthy.

**Key gaps.**
1. `@supabase/server` must be written doc-first.
2. The repo needs boundaries for a second TS runtime before the first function file lands.
3. Integration suites must sign in as real roles before the RLS rewrite, or that rewrite has no
   safety net.
4. Three pieces of instruction drift could mislead an agent: the `config push` comment, the
   "no production data" README line, and a `SECURITY DEFINER` rule that exists only in migration
   comments.

Config hygiene the PRD already names goes to `/10x-health-check` for ranking:
`minimum_password_length = 6` (PRD: 15), `site_url` still `:3000`, and `[auth.email.smtp]`
unconfigured.

Recommended next step: `/10x-health-check`. It reads this assessment and focuses on the gaps
above.
