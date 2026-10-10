---
project: ib-timetable-planner
checked_at: 2026-10-10T10:27:18+02:00
health_status: needs-attention
context_type: brownfield
language_family: multi
stack_assessment_available: true
checks_run:
  - lockfile
  - dependency_audit
  - outdated_deps
  - test_runner
  - ci_cd
  - configuration
audit_findings:
  critical: 0
  high: 1
  moderate: 0
  low: 0
test_runner_detected: true
ci_provider: GitHub Actions
recommended_fixes: 10
---

# Health Check — IB Timetable Planner (user management & privileges)

> Checked against the user-management PRD (`context/foundation/prd.md`, 2026-10-10) and today's
> stack assessment (`context/foundation/stack-assessment.md`, 2026-10-10T10:17). Replaces the
> 2026-07-16 report (CP-SAT change, `healthy`). That report's three solver fixes have landed:
> `mypy --strict`, the CI `solver` job with `uv audit`, and the `CLAUDE.md` solver section.
>
> **Why the verdict moved from `healthy` to `needs-attention`.** The general operational health is
> as strong as in July: clean lockfiles, green suites and a five-job CI. The verdict reflects
> readiness for **this** change. Four gaps sit exactly where it lands:
> - no test can see RLS;
> - the e2e test account will lose access the moment the fail-closed migration lands;
> - local auth config does not match what invites and resets need;
> - one PRD requirement conflicts with how the auth platform works.
>
> All of them are addressable before agent work starts.

## Dependency Health

### Lockfile

```
Status: present — pnpm-lock.yaml (app), uv.lock (solver)
Package manager: pnpm 12.9.1 (app, pinned in packageManager); uv 0.12.3 (solver, pinned in mise.toml)
```

Both ecosystems are pinned and reproducible. Node is pinned by `.node-version` (24.15.0) and
Python by `services/solver/.python-version` (≥3.13). CI installs with `--frozen-lockfile` and
`uv sync --locked`.

### Security Audit

```
Tool: pnpm audit --json (app); uv audit --preview-features audit (solver)
Summary: 0 CRITICAL, 1 HIGH, 0 MODERATE, 0 LOW — app: 1,024 resolved packages; solver: 53 packages, 0 findings
Direct vs transitive: the one HIGH is transitive (dev-only, via steiger)
```

#### HIGH findings

- **braces** ≤3.0.3 — GHSA-vfj7-8cjw-p6xm: stack exhaustion on deeply nested brace patterns.
  **Already reviewed and ignored on purpose** in `pnpm-workspace.yaml` → `audit.ignore`, with a
  written rationale: no patched release exists; it arrives only through steiger, a dev-time lint
  over the repo's own paths, so no untrusted pattern reaches it. `pnpm audit` reports
  "1 ignored: 1 high", and CI's `--audit-level=high` stays green. Fix: none now. Revisit when
  braces or steiger ships a fix (see Fix 10).

The app tree also carries **19 security overrides** in `pnpm-workspace.yaml` (`brace-expansion`,
`undici`, `ws`, `postcss`, `sharp` and others). Each is a manual pin to remove once upstream
catches up. `.github/dependabot.yml` covers only the `github-actions` ecosystem, so nothing
re-checks these automatically.

### Outdated Dependencies

```
Packages with major version gaps: 7 (all one major behind; none two or more)
```

- **@astrojs/react**: 6.0.5 → 7.0.1 (runtime dependency)
- **vitest**: 4.1.11 → 5.0.3 (dev)
- **typescript**: 6.0.3 → 7.0.2 (dev, carried over from July)
- **jsdom**: 29.1.1 → 30.1.2 (dev)
- **@testing-library/jest-dom**: 6.9.1 → 7.0.1 (dev)
- **prettier-plugin-astro**: 0.14.1 → 1.1.0 (dev)
- **devalue**: 5.9.4 → 6.0.2 (dev; also pinned by an override)

35 more packages have minor or patch drift only. That includes everything this change relies on:
`@supabase/supabase-js` 2.116.0 → 2.117.3, `supabase` CLI 2.117.0 → 2.120.0, `astro` 7.3.2 →
7.3.8, `wrangler` 4.130.0 → 4.149.0 and `zod` 4.5.4 → 4.6.5. None blocks the change. See Fix 9 on
timing.

## Test Suite

```
Test runner: Vitest 4.1.11 + Playwright 1.61 (app); pytest (solver)
Tests found: 2,006 (app unit, 215 files) + 246 (solver, 2 of them the `baseline` marker) + 36 integration suites + 26 E2E specs
Test execution: passing — app unit and solver fast lane verified this run; integration and E2E not run here (CI runs both)
```

```
Configuration: vitest.config.ts (unit) + vitest.integration.config.ts, .analyze, .experiment,
  bench configs; playwright.config.ts (setup → chromium / chromium-guard projects, port 4321);
  services/solver/pyproject.toml [tool.pytest.ini_options]
Framework: Vitest 4.1.11 — 2,006 passed in 28.9 s; pytest — 244 passed, 2 deselected
  (`-m "not baseline"`) in 51.3 s; astro check — 0 errors over 841 files
```

**Strength.** Fast, green suites on both sides of the wire contract, pre-commit (eslint, steiger,
prettier) and pre-push (`pnpm check`) hooks via lefthook, and a CI that runs all of it.

**Gap that matters for this change.** The integration lane cannot observe RLS:

- **42 files** under `src/` reference the service-role key, and `src/test/load-test-env.ts`
  requires `SUPABASE_SERVICE_ROLE_KEY` in CI. The service-role client bypasses RLS.
- Only **one** suite signs in as an ordinary user: `src/test/solver-credential.integration.test.ts`,
  using `src/test/publishable-key.ts` + `signInWithPassword`. It signs in as the **machine** user.
  So the pattern for testing a role exists, but nothing applies it to a human role.

The PRD's guardrails ("no author loses access or edits", "a viewer reads everything and edits
nothing", "no role → no data") therefore have no test that can fail today (Fix 1).

**Test account that will break.** `scripts/provision-e2e-author.mjs` (`pretest:e2e`) creates the
e2e author with `auth.admin.createUser` and nothing else. In CI the stack is fresh: migrations
apply first, and the author is created afterwards, so the PRD's backfill-as-`author` migration
**never sees it**. Once access is fail-closed, `e2e/auth.setup.ts` signs in to the "no access yet"
page and every spec in the `chromium` project fails. That blocks `deploy`, which needs `e2e`
(Fix 2). The PRD names this as a constraint ("test accounts must keep working once access is
fail-closed"), but nothing in the repo implements it yet.

## CI/CD

```
Provider: GitHub Actions
Configuration: .github/workflows/ci.yml (+ composite actions .github/actions/setup, .github/actions/supabase-stack)
```

| Stage      | Status | Notes |
| ---------- | ------ | ----- |
| Lint       | ✓      | eslint (type-aware) + steiger `--fail-on-warnings` + shellcheck 0.11.0 (`verify`); ruff (`solver`) |
| Test       | ✓      | vitest (`verify`), integration with a live solver (`integration`), Playwright (`e2e`), pytest incl. baseline (`solver`) |
| Build      | ✓      | `pnpm build` (`verify`, `deploy`); container image built by `wrangler deploy` |
| Type check | ✓      | `astro sync` → `pnpm check` (`verify`); `uv run mypy` strict over src + tests (`solver`) |
| Security   | ✓      | `pnpm audit --audit-level=high` (`verify`), `uv audit` (`solver`), Dependabot (actions only), SHA-pinned actions, read-only `GITHUB_TOKEN` |

`deploy` runs on push to `main` after all four test jobs: `supabase db push` to hosted, then
`wrangler deploy` (Worker + container).

**Coverage boundaries this change will hit** (all confirmed in the workflow files):

- **No SQL lint.** No job runs `supabase db lint` (plpgsql_check), yet this change adds a role
  helper and rewrites 16 policies. Run locally today, it reports one **false positive**:
  `public.clone_plan` → `relation "pg_temp._teacher_map" does not exist`. The function creates
  that temp table at runtime (`20260711174905_clone_plan_include_board.sql:41`), which the static
  check can't see. It also reports one warning-level unused parameter in `unshelve_bundle`.
  That false positive has to be handled before the lint can gate CI (Fix 7).
- **The CI stack has no mail capture and no edge runtime.** `.github/actions/supabase-stack/action.yml:28`
  starts Supabase with `-x …,mailpit,…,edge-runtime,…`. An invite or reset test, or a test that
  calls the Edge Function, passes locally and fails in CI (Fix 6).
- **No function deploy.** `deploy` has `supabase db push` but no `supabase functions deploy`, and
  no job type-checks or lints Deno code (Fix 6).

## Configuration

### High severity

None. In the generic sense this project is fully configured: strict `tsconfig.json`, type-aware
`eslint.config.js`, `.prettierrc.json` + a documented `.prettierignore`, `.gitignore` (secrets
ignored: `.env*`, `.envs/`, `.dev.vars`), `.env.example`, `CLAUDE.md` + `AGENTS.md`, and lefthook.

### Medium severity

These are scoped to this change. All are in `supabase/config.toml`, which configures the local
stack that the integration and e2e lanes run against.

- **`site_url = "http://127.0.0.1:3000"` and `additional_redirect_urls =
  ["https://127.0.0.1:3000"]`** (`config.toml:154,156`). The app serves on port 4321
  (`pnpm dev`; Playwright's `baseURL` is `http://localhost:4321`), and the allowlist entry is
  even `https`. Invite and reset links are built from `site_url`, and a `redirectTo` that isn't
  allow-listed is silently replaced with it. Every invite or reset test would land on a dead port.
  Fix: Fix 4.
- **`minimum_password_length = 6`** (`config.toml:175`). The PRD guardrail is "passwords shorter
  than 15 characters are refused". Locally, a test of that guardrail cannot fail. Fix: Fix 4.
- **`otp_expiry = 3600`** (`config.toml:220`) is one setting for **every** email link. See Fix 5:
  it is the platform fact behind PRD Open Question 2.

### Low severity

- **`[inbucket]` section is deprecated.** Supabase CLI 2.117 warns on every command: "config
  section [inbucket] is deprecated. Please use [local_smtp] instead". That section is the local
  mail-capture config the invite and reset tests will depend on. Fix: Fix 4.
- **`.editorconfig` is still missing.** Carried over from July (that report's Fix 4, not
  applied). Prettier doesn't cover the solver's Python, TOML or YAML, or, soon, Deno. Fix: Fix 10.
- **No `db:types` script.** `src/shared/api/database.types.ts` is committed verbatim, but no
  script or doc says how to regenerate it. Fix: Fix 8.

## Stack Assessment Cross-Reference

```
Stack assessment: context/foundation/stack-assessment.md (2026-10-10T10:17)
Agent readiness (from stack-assess): ready-with-compensation
```

| Quality Gate Gap | Health-Check Finding | Status |
| --- | --- | --- |
| **Edge Function: training data ✗** (`@supabase/server`, 2026-03) | No `supabase/functions/` yet; no Deno toolchain in `mise.toml`; no `functions deploy` in CI; CI stack excludes `edge-runtime` | **Reinforced**, but the gap only bites once the Edge Function phase starts |
| Edge Function: convention ~ (second TS runtime) | Confirmed: `tsconfig.json` has `"include": ["**/*"]` with only `dist` excluded; `eslint.config.js` has no ignore for `supabase/functions/**` | **Reinforced** |
| Supabase: training data ~ (new keys, Auth hooks, `token_hash` flows) | Local auth config is wrong for these flows (`site_url` on :3000, `https` redirect, 6-character minimum); one OTP lifetime can't express the PRD's 72 h / 1 h | **Reinforced** |
| Supabase: convention note (`SECURITY DEFINER` rule only in migration comments) | No SQL lint in CI either; the new helper would get neither an instruction rule nor a machine check | **Reinforced** |
| Test harness: RLS invisible | Confirmed (42 service-role files; one machine-user sign-in suite). New: the e2e author breaks on fail-closed | **Reinforced, and one new breakage found** |
| Typed note: no type regen step | `pnpm check` clean today; still no script | Unchanged → Fix 8 |
| Instruction drift: `config.toml:272-273` "`supabase config push`"; README "no production data" | Both still present | **Compensation pending** → Fix 3 |
| Recommended `CLAUDE.md` additions (Database & auth, Edge Functions) | Not yet in `CLAUDE.md` (written today) | **Compensation pending** → Fix 3 |
| Vite 8 training ~, CP-SAT convention/docs ~ | `CLAUDE.md` post-cutoff + solver sections present; 244 solver tests green; `mypy --strict` in CI | **Mitigated** |

Taken together: every gap the stack assessment found for this change is confirmed here, and none
has been addressed yet. That is expected, since the assessment is an hour old. The one finding the
assessment could not see is the e2e author (Fix 2). It is operational, not a stack-choice issue,
and it would turn the first fail-closed PR red.

## Recommended Fixes

The project is past the point where the course's later lessons apply: CI/CD, automated deployment
and agent instruction files already exist. So every fix below is actionable now, ranked by impact
on agent work for this change.

> **Status (2026-10-10):** none of these fixes has been applied. They are tracked as tasks, grouped
> by the phase they should land in, in `context/changes/user-managment-research/change.md` →
> *Tasks gathered*. Only the documentation parts of Fix 3 are done:
> - README Rollback now says additive-only;
> - the `config.toml` hook comment is corrected;
> - `CLAUDE.md` has a "Database & auth (Supabase)" section containing only rules true today.
>
> The role, email-flow and Edge Function rules are tasks that land with the phases that build
> them. Fix 5's finding is recorded under PRD Open Question 2.

### Fix before agent work (Category A)

### 1. Give the integration lane a signed-in client per role

**Impact**: the RLS rewrite and the fail-closed rule are the riskiest part of this change, and
today no test can fail on them. An agent rewriting 16 policies gets green CI regardless of what
the policies say. This is the "agent cannot verify its own changes" problem, scoped to the exact
code being changed.
**Severity**: high
**Effort**: significant (> 1 hour)
**Fix**:

Build on the existing precedent: `src/test/publishable-key.ts` + `signInWithPassword` in
`src/test/solver-credential.integration.test.ts`. Add a factory under `src/test/factories/` that
does the following:

1. Creates a user with the service-role client.
2. Assigns a role (`admin` / `author` / `viewer` / none) once `user_roles` exists.
3. Returns a **publishable-key client signed in as that user**.
4. Is registered with `teardown`.

Then write a role-matrix suite that reads and writes one representative table per policy family
as each role. Include the guard in the other direction too: with no role row, the user reads
**nothing**. Confirm grant posture with `has_table_privilege(...)`, per `lessons.md`. Land the
harness **before** the policy migration, so the first red run proves the suite can fail.

### 2. Make test accounts role-aware in the same PR as the fail-closed migration

**Impact**: without this, the first PR that makes access fail-closed turns `e2e` red. `deploy`
needs `e2e`, so the change blocks itself. Locally, every authenticated Playwright spec lands on
"no access yet".
**Severity**: high
**Effort**: moderate (15–30 min)
**Fix**:

In `scripts/provision-e2e-author.mjs`, after `auth.admin.createUser` (and also on the
`email_exists` path, so it stays idempotent), upsert the author's row into `public.user_roles`
with the service-role client:

```js
await supabase.from("user_roles").upsert({ user_id, role: "author" }, { onConflict: "user_id" });
```

Look up `user_id` by email on the `email_exists` path. Add a viewer and an admin account the same
way when the viewer and Users-page specs arrive, and add their storage states as separate
Playwright projects next to `setup`. The solver machine user (`scripts/provision-solver-user.mjs`)
must stay role-less. That is the PRD's rule, and the integration lane's credential guard depends
on it.

### 3. Paste the stack-assessment compensation into `CLAUDE.md` and fix two drift points

**Impact**: agents writing Auth or RLS code get no steering on the `SECURITY DEFINER` exception,
live role checks, `token_hash` links, the no-`config push` rule or the Edge Function boundary. Two
repo texts actively point the wrong way.
**Severity**: high
**Effort**: quick (< 5 min)
**Fix**:

1. Copy the "Database & auth rules (Supabase)" and "Edge Functions" sections from
   `context/foundation/stack-assessment.md` → *Recommended Instruction File Additions* into
   `CLAUDE.md`.
2. `supabase/config.toml:272-273`: replace "so the hosted project needs a one-time
   `supabase config push`" with "the hosted hook is enabled by hand in the dashboard — see
   `docs/runbooks/solver-credential.md`; never `config push`".
3. README § Database → **Rollback**: replace "There is no production data to preserve yet … drop
   and re-push" with "Hosted holds real school data: migrations are additive only; never drop and
   re-push."

### 4. Align local auth config with what invites and resets need

**Impact**: invite, reset and password-policy work can't be tested correctly while the local stack
builds links to a dead port and accepts 6-character passwords. An agent will "fix" the symptom in
app code.
**Severity**: medium
**Effort**: quick (< 5 min)
**Fix** (in `supabase/config.toml`, then `pnpm exec supabase stop && pnpm exec supabase start`):

```toml
[auth]
site_url = "http://localhost:4321"
additional_redirect_urls = ["http://localhost:4321/**", "http://127.0.0.1:4321/**"]
minimum_password_length = 15
```

Rename the deprecated `[inbucket]` section to `[local_smtp]`, keeping its keys. Today only password
sign-in exists, so no current flow depends on `site_url`, and the change is safe now. The hosted
values are set by hand (Site URL, redirect allowlist, password length), following the runbook, never
by `config push`.

### 5. Resolve PRD Open Question 2: one lifetime governs every email link

**Impact**: the PRD's guardrail ("an invitation link stops working 72 hours after it is sent; a
password-reset link after 1 hour") **cannot be met with stock Supabase links**. Supabase's docs
are explicit: *"The Email OTP Expiration setting also governs the validity of Magic Links and other
email links, including confirmation, password recovery, email change, and invitation links."* Also,
*"an expiry duration of more than 86,400 seconds (one day) is strongly discouraged and can only be
set via the Management API."* An agent implementing both lifetimes literally will either break one
of them or invent a workaround nobody reviewed.
**Severity**: high (for planning; no code exists yet)
**Effort**: moderate (15–30 min — a PRD amendment, not code)
**Fix**: decide before `/10x-plan`, and record the answer in the PRD's Open Questions. Options:

- **(a)** One lifetime for all links, e.g. 24 h. Invites lean on FR-401's re-send, and the reset
  guardrail relaxes to 24 h.
- **(b)** Keep the platform at 1 h for resets and issue **app-level invite tokens** with their own
  72 h expiry. That is more code, and a new token table under RLS.
- **(c)** 72 h for all links via the Management API. The docs discourage this, and it weakens
  reset security.

(a) is the smallest change that keeps the PRD's intent.

### 6. Prepare the toolchain and CI for the Edge Function before its first file

**Impact**: the first `supabase/functions/**/index.ts` with an `npm:` import lands in `pnpm check`
and ESLint and breaks unrelated work. Its tests can't run in CI, and nothing deploys it. This is
the stack assessment's one failed check, made operational.
**Severity**: medium (it becomes high when the Edge Function phase starts)
**Effort**: moderate (15–30 min)
**Fix**:

- `tsconfig.json`: `"exclude": ["dist", "supabase/functions"]`.
- `eslint.config.js`: add `supabase/functions/**` to the global ignores.
- `mise.toml` `[tools]`: pin `deno`, then add a script under `scripts/` running `deno check` and
  `deno lint` over `supabase/functions/`, plus a one-line mise task. Wire it into CI `verify`.
- `.github/actions/supabase-stack/action.yml:28`: drop `mailpit` from `-x` when the first invite
  or reset suite lands, and `edge-runtime` when the first function test lands. The comment on
  line 23 explains the trimming rationale; extend it rather than delete it.
- `deploy` job: after `supabase db push`, add `pnpm exec supabase functions deploy <name>`. It
  reuses the existing `SUPABASE_ACCESS_TOKEN`. Fetch current docs (Context7 `/supabase/cli`) for
  flags before writing it.

### 7. Gate SQL functions with `supabase db lint`

**Impact**: the role helper and any new RPCs are PL/pgSQL or SQL that only runs once a request
hits it. Today a typo in a policy helper surfaces as a failing integration test at best, or a
production 500 at worst.
**Severity**: medium
**Effort**: moderate (15–30 min)
**Fix**: first deal with the `clone_plan` temp-table false positive. Either use plpgsql_check's
documented way to declare temp tables, or keep the gate scoped while the false positive stands.
Then, in the `integration` job after the stack boots:

```yaml
- run: pnpm exec supabase db lint --schema public --level error --fail-on error
```

Re-run locally with `pnpm exec supabase db lint --level warning` to see the current state.

### 8. Add a `db:types` script

**Impact**: this change adds `user_roles`, profile, attribution and "current plan" columns. An
agent that forgets to regenerate types will hand-edit `database.types.ts` or cast around it.
**Severity**: medium
**Effort**: quick (< 5 min)
**Fix**: in `package.json` `scripts`:

```json
"db:types": "supabase gen types typescript --local > src/shared/api/database.types.ts"
```

Then reference `pnpm db:types` in the `CLAUDE.md` rule from Fix 3.

### 9. Defer the one-major bumps until after this change

**Impact**: `@astrojs/react` 7 (runtime), `vitest` 5, `jsdom` 30 and `typescript` 7 each touch the
toolchain this change leans on. Mixing a bump into an RLS or auth PR makes a red build ambiguous.
**Severity**: low
**Effort**: moderate (15–30 min per bump, as its own PR)
**Fix**: none during this change. Afterwards, bump one at a time in separate PRs, reading each
changelog. Minor and patch drift (Supabase CLI 2.120, supabase-js 2.117.3, wrangler 4.149) is safe
to take any time, ideally before the Edge Function phase. Check the README's "do not merge while a
production solve is running" rule first, because every merge deploys.

### 10. Small hygiene: `.editorconfig`, the braces ignore, override upkeep

**Impact**: consistency across Python, TOML, YAML and Deno files, which Prettier does not format;
and a reminder loop for hand-pinned security fixes.
**Severity**: low
**Effort**: quick (< 5 min)
**Fix**:

```ini
# .editorconfig
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2

[*.py]
indent_size = 4
max_line_length = 110
```

When steiger or braces ships a fix, drop `GHSA-vfj7-8cjw-p6xm` from `audit.ignore` and prune any of
the 19 overrides that upstream versions now satisfy. Optionally, enable GitHub's Dependabot
**security** updates for `npm` and `uv`. The existing `dependabot.yml` covers only actions.

### Addressed in upcoming lessons (Category B)

None. CI/CD (five jobs, automated deploy on merge), deployment configuration (`wrangler.jsonc`,
hosted Supabase) and agent instruction files (`CLAUDE.md`, `AGENTS.md`, project skills) all exist
already.

## Summary

Health status: **needs-attention**

The operational base is strong and better than in July:

- pinned lockfiles in both ecosystems;
- no open audit findings, apart from one reviewed and documented dev-only HIGH;
- 2,006 app tests and 244 solver tests green this run, with a clean type check;
- a hardened five-job CI.

The verdict is about **this change**, not general hygiene. The parts of the stack it leans on are
not ready yet:

- no test can observe RLS;
- the e2e author will lose access the moment access becomes fail-closed;
- local auth config builds links to a dead port;
- the PRD asks for two link lifetimes that Supabase stores as one setting.

Every gap the stack assessment predicted is confirmed. None is a stack problem, and Fixes 3, 4 and
8 together take under 15 minutes.

Next step: decide PRD Open Question 2 (Fix 5), then carry the task list in
`context/changes/user-managment-research/change.md` into `/10x-roadmap` and `/10x-plan`. Fix 1 is
the change's first phase, and Fix 2 lands inside the fail-closed migration PR.
