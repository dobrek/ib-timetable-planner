---
date: 2026-10-12T09:54:42+02:00
researcher: Claude (Opus 5.5)
git_commit: 3c64d40a2f045b1d3f1b5973ff7a4955e8f280f4
branch: main
repository: ib-timetable-planner
topic: "Health-check Fix 1 (a signed-in client per role in the integration lane): claim check, feasibility, options"
tags: [research, codebase, testing, integration, rls, grants, supabase-auth, test-factories, teardown, role-matrix, give-integration-lane-a-signed-in-client-per-role]
status: complete
last_updated: 2026-10-12
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Added follow-up research on why CI exports the legacy anon key as SUPABASE_KEY"
---

# Research: A signed-in client per role for the integration lane (health-check Fix 1)

**Date**: 2026-10-12T09:54:42+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: [`3c64d40`](https://github.com/dobrek/ib-timetable-planner/tree/3c64d40a2f045b1d3f1b5973ff7a4955e8f280f4)
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

> Check `context/foundation/health-check.md` and confirm its claim for Fix 1. Check the
> feasibility and suggest options.

Fix 1 ("Give the integration lane a signed-in client per role", `health-check.md:242-264`) asks for
a factory under `src/test/factories/` that does four things:

1. creates a user with the service-role client;
2. assigns a role (`admin` / `author` / `viewer` / none) once `user_roles` exists;
3. returns a publishable-key client signed in as that user;
4. is registered with `teardown`.

On top of the factory, it asks for a role-matrix suite with these properties:

- it reads and writes one representative table per policy family, as each role;
- it includes "no role reads nothing";
- it confirms grant posture with `has_table_privilege`;
- it lands before the policy migration, so that its first red run proves it can fail.

Its supporting evidence is in the Test Suite section (`health-check.md:115-124`):

- 42 files reference the service-role key;
- `load-test-env.ts` requires that key in CI;
- only one suite signs in, and it signs in as the machine user.

## Summary

**The substance of the claim holds.** No test can fail when a human role has *too much* access.
Making access fail-closed is precisely the removal of excess access. So an agent rewriting the 16
policies would get a green integration lane whatever the policies say about viewer, no-role and
anon rows.

**Four details are wrong or overstated:**

- The file count is 37, not 42.
- "No test can see RLS" is too strong. Three tests already observe RLS or grants. The e2e lane would
  catch an author *losing* access on the paths it drives, which is the premise of Fix 2.
- `teardown` only knows plans, so a user registry has to be built; it isn't "registering" with
  something that exists.
- The roadmap's "17 `using (true)` policies" is off by one. Health-check's 16 is right.

**One structural premise fails if this change stands alone.** Step 2 ("assign a role") needs
`public.user_roles`, which belongs to S-403. Before S-403, every human role is one Postgres role
(`authenticated`) under a `using (true)` policy. So admin, author, viewer and no-role behave
identically, and a four-role matrix today would be four copies of one assertion. Also, "the first
red run" cannot be a merged red `main`: the PRD requires every CI lane to stay green
(`prd.md:307-308`), and `deploy` needs `integration`.

**Feasibility is high: most of the work is assembling parts that already exist.**

Already in place:

- the create → sign in → delete pattern (`solver-credential.integration.test.ts:62-94`);
- the publishable-key reader (`src/test/publishable-key.ts`);
- client options that are safe to run concurrently;
- a `pg` grant probe (`src/test/postgres-client.ts`), with `SUPABASE_DB_URL` exported in CI;
- the CI integration job, which already exports a client key as `SUPABASE_KEY`.

Still to build:

- a user registry and its cleanup;
- a password generator that is policy-proof;
- an access probe that normalises RLS's silent denials;
- the expectation matrix.

Rate limits are not a blocker.

**Recommendation: Option 1.** Ship the harness now with a characterization matrix that is green
today, and pin the current posture, including the hole ("no role reads everything"). Leave role
assignment to S-403, where flipping the matrix's expectations *is* the red run, before the policy
migration turns it green. That keeps this change free of schema and of risk to hosted, lets it land
while S-403 waits on S-401, and turns S-403's access spec into a reviewable diff. It needs a roadmap
amendment, because the roadmap explicitly placed the harness inside S-403 (see
[Options](#options)).

## Detailed Findings

### 1. Claim-by-claim verification

| # | Claim (health-check) | Verdict | Evidence |
|---|---|---|---|
| 1 | "**42 files** under `src/` reference the service-role key" | **Count is off** | 37 files reference `SUPABASE_SERVICE_ROLE_KEY`: the 36 `*.integration.test.ts` suites plus [`load-test-env.ts`](https://github.com/dobrek/ib-timetable-planner/blob/3c64d40a2f045b1d3f1b5973ff7a4955e8f280f4/src/test/load-test-env.ts#L28-L36). 41 mention "service role" at all; 4 of those only in comments (`publishable-key.ts:7`, `load-plan-analysis.ts:26`, `generation-delivery.ts:344`, `solver-container-env.ts:8`). No grep reproduces 42. No runtime source uses the key, consistent with CLAUDE.md. |
| 2 | "`src/test/load-test-env.ts` requires `SUPABASE_SERVICE_ROLE_KEY` in CI" | **Confirmed** | `load-test-env.ts:28-36` throws on a missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` when `CI=true`. It does **not** gate `SUPABASE_KEY` or `SUPABASE_DB_URL`; the solver-credential suite carries its own gate ([`:43-48`](https://github.com/dobrek/ib-timetable-planner/blob/3c64d40a2f045b1d3f1b5973ff7a4955e8f280f4/src/test/solver-credential.integration.test.ts#L43-L48)). |
| 3 | "The service-role client bypasses RLS" | **Confirmed** | Every suite builds its own client, `createClient<Database>(SUPABASE_URL, SERVICE_KEY)`; there is no shared helper. Live catalog: `service_role` has `BYPASSRLS`. Even the action-boundary suite injects the service-role client behind a faked `locals.user = { id: "e2e-author" }` (`action-boundary.integration.test.ts:27-31,43`), so it proves the wrapper, not authorization. |
| 4 | "Only **one** suite signs in…: `solver-credential.integration.test.ts`… as the **machine** user" | **Confirmed** | The only `signInWithPassword` in `src/` and `e2e/` outside the app's own endpoint is [`solver-credential.integration.test.ts:82`](https://github.com/dobrek/ib-timetable-planner/blob/3c64d40a2f045b1d3f1b5973ff7a4955e8f280f4/src/test/solver-credential.integration.test.ts#L82), with `app_metadata.machine_role` at `:74`. `e2e/auth.setup.ts` signs a human in through the UI, not through a JS client. |
| 5 | "No test can see RLS"; "an agent rewriting 16 policies gets green CI regardless of what the policies say" | **Overstated; true where it matters** | Already observed: **(a)** `solver-credential` checks RLS for the solver role: WITH CHECK 42501 (`:176-177`), the USING window as a 0-row update (`:181-185`), policy predicates pinned from `pg_policies` (`:152-171`). **(b)** [`generation-jobs.integration.test.ts:47-69`](https://github.com/dobrek/ib-timetable-planner/blob/3c64d40a2f045b1d3f1b5973ff7a4955e8f280f4/src/test/generation-jobs.integration.test.ts#L47-L69) checks grant posture (anon holds nothing; RLS is on). **(c)** e2e runs as `authenticated` through `createServerClient(URL, SUPABASE_KEY, { cookies })` (`src/shared/api/supabase.ts:25`), so it **would** go red if an author lost access on the paths its specs drive. That is Fix 2's own premise. **True:** nothing observes *over*-permission for any human: no-role, viewer, anon at row level, or an author writing where they shouldn't. Fail-closed is the removal of excess access, so the gap is real exactly where S-403 operates. |
| 6 | "Build on the precedent: `publishable-key.ts` + `signInWithPassword`" | **Confirmed** | `readPublishableKey()` reads `SUPABASE_KEY`, then `.dev.vars`, then `.env.local` (`publishable-key.ts:16-31`). The client is built with `{ auth: { persistSession: false, autoRefreshToken: false } }` (`:79-81`). |
| 7 | Factory step 2: "assigns a role… once `user_roles` exists" | **Cannot be built standalone** | `user_roles`, `private.*` helpers, `app_role` and `is_admin` have zero hits in `supabase/`, `src/` and `scripts/`. The table is S-403's (research `:258-264`). |
| 8 | Factory step 4: "registered with `teardown`" | **Needs new code** | [`teardown.ts:7-24`](https://github.com/dobrek/ib-timetable-planner/blob/3c64d40a2f045b1d3f1b5973ff7a4955e8f280f4/src/test/factories/teardown.ts#L7-L24) is a per-file `Set` of plan ids that it cascade-deletes from `plans`. Auth users don't cascade from plans. The precedent deletes its user *outside* teardown (`solver-credential…:91`). |
| 9 | "Confirm grant posture with `has_table_privilege(...)`" | **Feasible already, but limited** | `src/test/postgres-client.ts` exports `connectPostgres`, `heldPrivileges` and `heldColumnPrivileges`. `pg ^8.23` is a devDependency, and CI exports `SUPABASE_DB_URL` (`action.yml:61`). **Limit:** grants see Postgres roles only. Admin, author and viewer are all `authenticated`, so grant checks can pin `anon`, `authenticated`, `solver_job_writer` and the future `user_roles` lockdown, but can never separate app roles. Only RLS through signed-in clients can. |
| 10 | "Land the harness before the policy migration, so the first red run proves the suite can fail" | **Feasible only in a specific form** | A red `main` is not allowed (`prd.md:307-308`; `deploy` needs `integration`). The red run has to be an expectation flip inside S-403's PR (red commit, then green commit), an `it.fails` marker, or a recorded drill (the precedent is the solver-credential kill-switch drill, `docs/runbooks/solver-credential.md:188-208`). |
| 11 | "rewrites **16** policies" | **Confirmed; the roadmap is the outlier** | Live `pg_policies`: 18 policies, 17 with `qual = 'true'`, **16** of them `for all to authenticated using (true) with check (true)`. The 17th `using (true)` is the solver's "reads any job row, five columns of it" (`20260820075348:30-31`, `to solver_job_writer`), which must **not** be rewritten. `roadmap.md:79` ("17… for `authenticated`") and `:144` ("17… human-facing") are wrong. |
| 12 | "The PRD's guardrails ('a viewer reads everything and edits nothing', 'no role → no data')" | **Cosmetic** | These paraphrase FR-409, FR-410 and the access table (`prd.md:206,210,344-357`), not the Guardrails list (`prd.md:108-115`). |

### 2. What each lane can fail on today

| Lane | Runs as | Can fail on | Blind to |
|---|---|---|---|
| Integration (34 of 36 suites) | `service_role` (BYPASSRLS) | behaviour: RPCs, cascades, delivery | every policy and every grant |
| `solver-credential` | machine user via the publishable key | solver role's RLS, grants and token hook | every human role |
| `generation-jobs` (posture block) | catalog via `pg` | anon and authenticated grants on `generation_jobs`, `relrowsecurity` | rows; other tables |
| e2e (`chromium`) | the e2e author, real session | the author **losing** access on driven paths | over-permission; other roles |
| e2e (`chromium-guard`) | unauthenticated | redirect (`auth-guard.spec.ts:7-11`); action 401 (`action-unauth.spec.ts:14-23`) | rows |
| Unit | mocks | `requireSession` (`define-domain-action.test.ts:46-60`) | the database |

Nothing tests `src/middleware.ts` directly.

### 3. The RLS surface the matrix has to cover

The local stack is fully migrated: 59 migrations, latest `20260930081740`.

**Tables and policies.** There are 16 `public` tables, all with RLS enabled, none with FORCE RLS.
Each has one `"Authenticated users have full access"` policy: `ALL to authenticated using (true)
with check (true)`. Ten were created at `20260602185012_minimal_domain_schema.sql:164-174`; the
other six at `teacher_availability:33`, `course_teachers:33`, `bundles:41`, `shelf_bundles:51,55`
and `generation_jobs:117`. `generation_jobs` also carries the solver's SELECT policy and its
non-trivial UPDATE policy (`20260810200931:96-99`).

**Grants**, from live `has_table_privilege`:

- **`anon`**: no DML on any table, and nothing at all on `generation_jobs`. It **still holds
  TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on the other 15 tables**, and `pg_default_acl` gives
  anon those four on every future table. So a new `user_roles` table would start with them, and
  with full DML for `authenticated`, unless its migration revokes all eight from anon, as
  `generation_jobs` does (`20260810200122:128-129`). This is the `lessons.md:47-52` trap again, and
  it binds S-403.
- **`authenticated`**: all eight privileges. RLS is the only lock.
- **`solver_job_writer`**: column grants on `generation_jobs` only.

**Policy families and their representative tables.** Every human policy has the same shape today,
so the families are grouped by write path and sensitivity:

| Family | Representative | Why |
|---|---|---|
| Plan root | `plans` | cascade root; direct DML; `clone_plan … returning id` (the RETURNING-vs-SELECT trap, research `:243`) |
| Catalog | `courses` | direct DML (`update-course.ts`) plus the `replace_course_teachers` RPC |
| Student data | `students` | real names on hosted, so "no role reads nothing" matters most here |
| Board state, via RPC | `placements` through `place_course` | the drag-drop hot path; INVOKER RPC; the <200 ms budget |
| Generation jobs | `generation_jobs` | the only non-trivial policies; delivery writes under the visitor's session (PRD Q1) |
| Roles (S-403) | `user_roles` | self-read; admin-only write; no self-promotion |

**RPCs.** All 13 are plpgsql, `SECURITY INVOKER`, `search_path = ''`. The 12 app RPCs have a NULL
ACL, so PUBLIC (anon included) may EXECUTE them; they then fail on table grants. "Anon calls
`clone_plan` → 42501" is a cheap matrix row.

**What a denial looks like.** This drives how the probe has to be written:

| Denial | Surfaces as |
|---|---|
| Missing grant | error `42501`, "permission denied for table" |
| RLS on INSERT | error `42501`, "new row violates row-level security policy" |
| RLS on SELECT | empty result, **no error** |
| RLS on UPDATE / DELETE | **0 rows affected, no error** |

So the probe has to establish the outcome by reading back with the service-role client, never from
`error` alone. `solver-credential…:179-185` already records this: "assert on the row, not on
`error`."

**The token hook** (`20260810200934:37-51`) reads only
`claims.app_metadata.machine_role`. It touches no table and returns human events untouched, so a
human signs in as `authenticated`. The factory must never set `machine_role`. A cheap sanity row:
decode the token and assert `role = authenticated`. Per the docs, a hook error fails **every**
sign-in, so the matrix doubles as a tripwire if S-403 ever makes the hook read `user_roles`.

### 4. The factory's parts: what exists and what has to be built

| Part | State | Notes |
|---|---|---|
| Create user | exists (inline) | `admin.auth.admin.createUser({ email, password, email_confirm: true })`, never `signUp` (`2026-06-15-data-for-e2e-and-integration-tests/plan.md:128-138`). It bypasses `enable_signup = false` and is **not** rate limited (`/admin/*` has no limiter, per `/supabase/auth` docs). |
| Signed-in client | exists (inline) | `persistSession: false` gives each GoTrueClient its own in-memory storage, so several in one process don't collide. The "Multiple GoTrueClient instances" warning fires only in the browser (`auth-js` `GoTrueClient.js:173`), and the lane runs in `environment: "node"`. Keep `autoRefreshToken: false`; `jwt_expiry = 3600` outlives the lane. |
| Publishable key | exists | `readPublishableKey()`, format-agnostic. |
| Grant probe | exists | `heldPrivileges` and `heldColumnPrivileges`. No migration or test-only SQL function is needed, which sidesteps the additive-only and no-DEFINER rules. |
| User registry and cleanup | **to build** | Add user ids beside `ownedPlanIds`, and delete with `auth.admin.deleteUser`, **plans first, then users**. Must use the admin client: given a role client, RLS turns the delete into a silent 0-row success and leaks rows. No `public` FK to `auth.users` exists yet. `user_roles` will cascade, and S-407's `created_by` will be set null. |
| Password generator | **to build** | `randomUUID()` (36 characters, lowercase and digits only) passes a 15-character minimum but fails any future uppercase or symbol requirement. Use something like `` `${randomUUID()}Aa1!` ``: 40 characters, all four classes, no `#`, quotes or whitespace (the README's dotenv rule). Password policy is enforced on create and update, so a stricter policy would break user *creation*, not existing sign-ins. |
| Access probe | **to build** | Per table and operation, returns `"allowed"` or `"denied"` by reading back as service role. This normalises the four denial shapes above. |
| Expectation matrix | **to build** | Data-driven role × table × operation → outcome (see Option 1). |
| Role assignment | **blocked** | Needs `user_roles` and regenerated `database.types.ts` (S-403). |
| CI fail-loud gate | **to build** | Widen `load-test-env.ts`'s CI gate to `SUPABASE_KEY`, or copy `solver-credential…:43-48`; otherwise the matrix silently `describe.skip`s in CI. |

**Rate limits are not a blocker.** `config.toml:190` reads `sign_in_sign_ups = 30` with the comment
"sign up and sign-in requests". Per the Supabase docs (`_partials/auth_rate_limits.mdx`) and GoTrue's
`apilimiter.go`, though, `/auth/v1/token?grant_type=password` is governed by the `token_refresh`
bucket (150 per 5 minutes, burst 30). On top of that, GoTrue applies the per-IP limiter only when a
forwarded-for or rate-limit header is configured, and the local container sets neither. An
empirical probe of 45 back-to-back password grants returned zero 429s. The residual risk is CI's
**unpinned** Supabase CLI (`action.yml:15`, no `version:`) starting to set the header. Mitigate by
signing each role in once per file in `beforeAll`, never per test.

**Vitest.** Defaults are `testTimeout` 5 s and `hookTimeout` 10 s. Create and sign in the roles with
`Promise.all`, or raise `hookTimeout` for the matrix file. `test.fails` exists, but there is no
`describe.fails`. Files run in parallel workers; CI uses `--maxWorkers=2` (`ci.yml:179`), and the
lane is already about 1-in-5 red from transient Kong/PostgREST 502s
(`2026-09-01-stop-and-keep/plan.md:523`). Judge new failures against that baseline.

**Key-format drift in CI.** The integration job sets `export-anon-key: "true"` (`ci.yml:110-112`).
That makes `action.yml:57` export `auth.anon_key` as `SUPABASE_KEY`, which is the **legacy anon
JWT** (`eyJ…`). Locally, `.dev.vars` holds `sb_publishable_…`. Both resolve to the `anon` Postgres
role plus the user's JWT, so RLS results are identical; this is a fidelity gap against CLAUDE.md
("the Worker holds only `sb_publishable_…`"), not a correctness bug. The fix is
`--override-name auth.publishable_key=SUPABASE_KEY`, which works on CLI 2.117 locally but is
unconfirmed on CI's unpinned CLI. The same variable feeds the e2e lane's `.dev.vars`
(`ci.yml:261-264`).

### 5. Structural tensions in Fix 1 as written

1. **Roles don't exist yet.** Before S-403 the only distinguishable principals are `anon`,
   `authenticated` (any human, any future role) and `solver_job_writer`. A matrix written today can
   only pin those three.
2. **"First red run" against "all lanes green".** The red run must live inside S-403's PR history
   or a drill, never on `main`.
3. **Roadmap placement.** `roadmap.md:94-103` (Foundations: "None in this milestone… the role-matrix
   test harness → first phase of S-403… A foundation was considered for each and rejected"),
   `:144` and `:270` (S-403's handoff "Carries HC Fix 1") all put the harness inside S-403. So does
   `user-managment-research/change.md:48-58`. This change has no S-ID or F-ID, so archiving it
   would flip nothing on the roadmap (`roadmap.md:304`).

## Options

### Option 1: Harness plus a characterization matrix now; roles in S-403 (recommended)

Scope of this change, with no migration and no schema:

- `createSignedInUser(admin)` in `src/test/factories/` (one concept file, re-exported from the
  barrel). It creates the user, signs in with the publishable key and returns `{ id, email, client }`.
- A user registry inside `teardown`, so suites keep a single `afterAll(() => teardown(admin))`. It
  deletes plans first, then users.
- A policy-proof password generator.
- An access probe helper in `src/test/`.
- `role-matrix.integration.test.ts`, driven by an expectation table that pins **today's** posture:
  - **anon** is denied on every representative table, at the grant layer, and gets 42501 on
    `clone_plan`;
  - **authenticated with no role** is allowed everywhere. Name the rows honestly, e.g. "TODAY: a
    user without a role reads students; S-403 flips this";
  - **sanity rows**: the token role is `authenticated`, and sign-in works;
  - the solver principal is covered by `solver-credential` already, so don't duplicate it.
- Widen the CI fail-loud gate to `SUPABASE_KEY`.
- Optionally, refuse any `SUPABASE_URL` that isn't loopback (the research probe precedent,
  `user-managment-research/research.md:517`).

How S-403 then uses it:

- **Phase 1:** add `user_roles` and a `role` parameter on the factory. Add admin, author and viewer
  columns to the expectation table and flip no-role to denied. CI goes **red**, which proves the
  harness can fail.
- **Phase 2:** the policy migration turns it **green**.

The diff to the expectation table *is* the access spec, readable in review.

- **Pros:**
  - Lands now. S-403 is blocked on S-401 and this isn't.
  - No hosted risk, no schema decisions made early.
  - Puts the current hole on record.
  - Keeps S-403's PR focused on the policy diff.
  - The red/green proof happens in S-403's history, not on `main`.
- **Cons:**
  - Until S-403, the matrix proves little that is new: only anon at the row level and "no role reads
    everything".
  - Needs a roadmap amendment: add F-401 as the M-01 precedent (F-301/F-302) did, make S-403 depend
    on it, rewrite S-403's handoff note and issue #144, and fix 17 → 16 while editing.

### Option 2: Harness plus a schema-only `user_roles` migration now

Create `public.user_roles` here:

- `user_id` as primary key, referencing `auth.users` with `on delete cascade`;
- the role as an enum;
- all eight privileges revoked from anon;
- authenticated limited to SELECT;
- RLS restricting reads to the user's own row.

This change would rewrite no policies, so the factory could assign all four roles today. Target-state
rows would be `it.fails` until S-403.

- **Pros:** the factory is complete in one go.
- **Cons:**
  - An additive migration that **auto-deploys to hosted** ahead of its slice (the roadmap's "no
    layer ahead of a capability").
  - It decides S-403's schema (enum values, the `profiles` split, backfill timing) before S-403 is
    planned.
  - Before S-403 the four roles still behave identically, so the extra capability proves nothing
    yet.
  - `it.fails` passes on *any* throw, including sign-in errors and the lane's 502 flakes, so it can
    hide a broken harness.

**Not recommended.**

### Option 3: Fold back into S-403 as its phase 1

Delete this change. S-403 phase 1 writes the factory against the real `user_roles`, phase 2 is the
red flip and phase 3 the migration. That matches every existing document (roadmap, the research's
change.md, health-check `:470-471`).

- **Pros:** zero document drift; role assignment is written once, against the real table.
- **Cons:**
  - The harness waits for S-401 to finish, because S-403 depends on it.
  - S-403 becomes the milestone's largest PR (the research sizes P2 as L, `research.md:369`).
  - Harness review and policy review get tangled.

Choose this if you would rather have fewer moving parts than parallelism.

### Option 4: pgTAP via `supabase test db` (a complement, not an alternative)

SQL tests under `supabase/tests/` that use `set local role authenticated` plus forged
`request.jwt.claims`:

- each file runs in its own transaction and is rolled back, so there's no teardown, it takes
  milliseconds, and nothing deploys to hosted;
- `pgtap` 1.3.3 is available locally but not installed;
- `supabase test db` runs `pg_prove` in Docker, which costs CI an extra image pull;
- the basejump helpers fetch from `database.dev` at test time, so vendor a `000-setup.sql` instead.

It **proves** GRANTs, RLS predicates and the future `private.*` helper. It does **not** prove:

- GoTrue sign-in or the token hook, because claims are forged;
- Kong, the publishable key, PostgREST semantics (RETURNING against the SELECT policy, `select=*`
  against column grants) or the Action layer.

Trap: forgetting `set local role` runs the test as a superuser with BYPASSRLS, which is a false
green.

CLAUDE.md already rules that an access-control claim needs a client signed in with the publishable
key. So pgTAP is at most a later add-on for unit-testing S-403's helper function.

### Rejected

- **Minting JWTs in tests.** Tokens are ES256 and the signing key stays inside GoTrue. F-301's spike
  used a hand-minted HS256 token, which no longer applies (`2026-08-10-solver-contract-and-jobs-schema/research.md:375`).
  It would also skip the hook.
- **`SET ROLE` through supabase-js.** Not possible; PostgREST sets the role from the JWT.
- **`it.fails` as the only red-run proof.** It can't tell a policy denial from a harness crash. If
  used at all, pair it with plain-`it` sanity rows.

## Code References

- `context/foundation/health-check.md:115-124,242-264`: the Fix 1 claims under review.
- `src/test/solver-credential.integration.test.ts:43-48`: CI fail-loud gate for the publishable key.
- `src/test/solver-credential.integration.test.ts:62-94`: create, sign in, delete; the template for
  the factory.
- `src/test/solver-credential.integration.test.ts:179-185`: "assert on the row, not on `error`".
- `src/test/publishable-key.ts:16-31`: `readPublishableKey()`.
- `src/test/postgres-client.ts:20-86`: `connectPostgres`, `TABLE_PRIVILEGES`, `heldPrivileges`,
  `heldColumnPrivileges`.
- `src/test/generation-jobs.integration.test.ts:47-69`: precedent for grant-posture assertions.
- `src/test/factories/teardown.ts:7-24`: the plan-only registry.
- `src/test/factories/index.ts`: the barrel, one concept file per export.
- `src/test/load-test-env.ts:28-36`: the CI gate (service-role key and URL only).
- `src/_pages/plans-list/api/action-boundary.integration.test.ts:27-31,43`: a seam where a role
  client could be injected for Action-level tests later.
- `vitest.integration.config.ts`: node environment, `setupFiles`, no `globalSetup` or timeouts.
- `.github/actions/supabase-stack/action.yml:15,28,57-62`: unpinned CLI, trimmed stack, key exports.
- `.github/workflows/ci.yml:110-112,179`: `export-anon-key`, `--maxWorkers=2`.
- `supabase/config.toml:175,178,180-194,277-279`: password policy, rate limits, hook enablement.
- `supabase/migrations/20260810200934_custom_access_token_hook.sql:37-51`: the hook passes humans
  through.
- `supabase/migrations/20260820075348_solver_progress_select_grants.sql:30-31`: the 17th
  `using (true)` (solver).
- `supabase/migrations/20260810200122_generation_jobs.sql:128-129`: the all-eight anon revoke, the
  model for `user_roles`.

## Architecture Insights

- **Two locks, two instruments.** Grants are proven from the catalog (`pg` and `heldPrivileges`);
  rows are proven through signed-in clients. App roles live in rows, not Postgres roles, so only the
  second instrument can tell admin, author and viewer apart. The matrix needs both, and neither
  substitutes for the other.
- **RLS denies silently.** Three of the four denial shapes return no error. Any harness that asserts
  on `error` will report a denied UPDATE as green. The probe's read-back is the design's
  load-bearing part.
- **Teardown must stay privileged.** Cleanup through a role client turns into a silent no-op, so the
  registry always deletes through the admin client.
- **An expectation table as the specification.** Pinning today's posture in data and flipping it in
  S-403 turns "the first red run proves it can fail" into a reviewable artifact, instead of relying
  on `it.fails` or an unrecorded local run.
- **The repo's conventions already fit.** One concept-named file per factory behind a pure barrel
  (memory: barrel-plus-concept-file), `type` over `interface`, the exported function first, tests
  building their own rows rather than reading seed rows (CLAUDE.md, Testing).

## Historical Context (from prior changes)

- `context/archive/2026-06-15-data-for-e2e-and-integration-tests/plan-brief.md:43`: auth-user
  factories (`createAuthedUser` / `signInAs`) were **deferred** to "the e2e/RLS follow-up".
  `plan.md:128-138` records the constraints: `createUser({ email_confirm: true })`, never `signUp`,
  and explicit `deleteUser`.
- `context/archive/2026-06-15-testing-auth-actions-boundary-rls/change.md:34-40`: only the
  unauthenticated half was tested. "The two-authenticated-clients harness was **not** built here."
  `has_table_privilege` was checked by a psql one-liner (`plan.md:128,379`), not by a test. That is
  where the anon-auto-grant lesson came from.
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/`: introduced `publishable-key.ts`,
  `postgres-client.ts` and the solver-credential guard. `plan.md:258` accepted a dev-only `pg`
  client. `impl-review.md:82-98` added `heldColumnPrivileges` after a table-level check passed while
  the grant was too wide.
- `docs/runbooks/solver-credential.md:188-208`: "A guard test that has never been shown to fail is
  not yet a guard". The kill-switch drill is the repo's precedent for proving a guard can go red.
- `context/changes/user-managment-research/research.md:213-216,258-264,268-281,354-359`: no human
  session test exists; the `user_roles` shape; live-lookup enforcement through `private.*` DEFINER
  helpers; "RLS-denied UPDATE/DELETE affect 0 rows silently; only INSERT raises 42501"; the harness
  template.
- `context/changes/user-managment-research/change.md:48-58`: the harness task, grouped as the
  "First phase, before any policy changes" together with the SQL lint gate (HC Fix 7, `:59-61`).
- `context/foundation/test-plan.md:118,134-138,467-473`: cross-author/IDOR deferred as "candidate
  Phase 2.5". The shared-workspace model (Model A) removes per-author ownership, so the role matrix
  replaces that phase. The test plan is stale: last updated 2026-06-23, and §6.2 still counts 10
  suites.

## Related Research

- `context/changes/user-managment-research/research.md`: user management and the privilege system
  (P0–P6 scope, enforcement A2).
- `context/foundation/stack-assessment.md:190-196,262-272,308-311`: Gap 5, "No test runs as a real
  role", and the proposed CLAUDE.md rule.
- `context/archive/2026-06-15-testing-auth-actions-boundary-rls/research.md`: the auth-boundary
  test plan, phase 2.

## Open Questions

1. **Placement.** Option 1 (a standalone change, F-401) or Option 3 (fold into S-403)? Option 1
   needs the roadmap edits listed above. Option 3 means deleting this change folder.
2. **CI key fidelity.** Switch the stack action to export `auth.publishable_key`, so CI matches
   production's `sb_publishable_…`? It touches the e2e lane too, so it may deserve its own small
   change. It also needs a check on CI's unpinned CLI, and perhaps pinning the CLI version.
3. **Ride-alongs.** HC Fix 7 (the `supabase db lint` gate) shares the "first phase" group in the
   research's change.md, but it is independent and needs the `clone_plan` false positive handled
   first. Keep it out of this change unless you want it bundled.
4. **Action-level rows.** Should the matrix also drive one Astro Action through the
   `action-boundary` seam with a role client? It would exercise S-403's future `FORBIDDEN` path.
   Probably belongs to S-403 or S-405, not here.
5. **Test-plan bookkeeping.** Replace the stale "Phase 2.5 cross-author/IDOR" with this harness, and
   add a signed-in-client entry to the §6.2 integration cookbook?
6. **Health-check corrections.** Amend the report: 42 → 37, and narrow "no test can see RLS" to "no
   test can fail on over-permission for a human role"? Or leave it as a dated snapshot?

## Follow-up 2026-10-12: Decision

**The author chose Option 1:** ship the harness with a characterization matrix now, and leave role
assignment to S-403.

What that fixes for `/10x-plan`:

- **In scope:**
  - `createSignedInUser(admin)` as a factory concept file behind the barrel;
  - a user registry inside `teardown` (plans first, then users, always through the admin client);
  - a policy-proof password generator;
  - the read-back access probe;
  - `role-matrix.integration.test.ts`, driven by an expectation table that pins today's posture
    (anon denied; no-role allowed, named as the hole; sanity rows on sign-in and the token role);
  - a CI fail-loud gate for `SUPABASE_KEY`.
- **Out of scope:** the `user_roles` table, role assignment and the expectation flip (S-403); e2e
  role accounts (HC Fix 2, which goes in the same PR as the fail-closed migration); the SQL lint
  gate (HC Fix 7); pgTAP.
- **Still open for the plan:** Open Questions 4 (Action-level rows) and 5 (test-plan
  bookkeeping), plus the optional loopback-URL guard. Open Question 2 (CI key format) is settled:
  it is roadmap item F-402 (see the follow-up below).

Roadmap amended the same day (`context/foundation/roadmap.md`):

- this change is now **F-401**, status `ready`;
- S-403 lists F-401 as a prerequisite, and its Risk text and handoff note describe the flip instead
  of building the harness;
- Stream B starts at F-401;
- the 17 → 16 policy count is corrected in Baseline and in S-403.

GitHub was updated the same day: F-401 is #155 and F-402 is #156. #144 (S-403) now depends on #155
and describes only the flip; #150 (S-409) depends on #156; tracker #153 lists both foundations.

## Follow-up 2026-10-12: Why CI exports the legacy anon key as `SUPABASE_KEY`

**Question (author):** Open Question 2 asks whether CI should switch `SUPABASE_KEY` to the
`sb_publishable_` key. Was there a reason for the current wiring?

**Answer: no technical reason was ever recorded.** The choice is inherited terminology. The
reasons that *were* recorded concern where the value comes from (the CI stack's own output, written
into `.dev.vars`), and they hold just as well for the publishable key.

### How the wiring arrived

| Commit | Change | What it says about the key |
|---|---|---|
| `8b1fd3b` 2026-06-17 (`testing-auth-actions-boundary-rls` p4) | e2e job adds `--override-name auth.anon_key=SUPABASE_KEY` and writes `.dev.vars` | "the CI stack mints its own anon key that won't match the fixed local publishable key, so we must write `.dev.vars` from the minted keys". The reason concerns the **source** (`.envs/` is gitignored, so CI has no `local.vars`), not the format. Research §E.1 and plan-brief `:60` frame it as the "anon-key mismatch" trap. |
| `3ef2cc5` 2026-06-18 (`ci-piepline-cleanup` p1) | moves the export into the composite action as input `export-anon-key` | a pure refactor; the name carried over |
| `7d0fc65` 2026-08-10 (F-301 p4) | the integration job sets `export-anon-key: "true"` | the comment says the guard "signs in … with the **PUBLISHABLE** key … so it needs the stack's **anon key** exported". The two terms are used as synonyms. |
| `6eb1569` 2026-10-09 (`security-workflow-issues`) | routes the input through `env:` | unchanged otherwise |

The repo has always treated "anon" and "publishable" as one thing:

- README `:144` (at `8b1fd3b`): "Publishable (anon) key";
- `docs/runbooks/solver-credential.md:18`: "The **publishable** (anon) key";
- `context/deployment/deploy-plan.md:69,140`: "`anon` / Publishable key".

The CLI never forced the legacy key either:

- At the time of `8b1fd3b` the repo pinned CLI `^2.101.0`, and the README already told developers to
  copy the **Publishable** key from `supabase start`.
- `--override-name auth.publishable_key=SUPABASE_KEY` works on today's 2.117.0: it exports
  `sb_publishable_…`, verified 2026-10-12.
- Locally, `.envs/local.vars`'s `SUPABASE_KEY` equals the stack's `PUBLISHABLE_KEY` byte for byte.

### What the key feeds in CI

The legacy key is exported to `$GITHUB_ENV`, so it reaches every later step of its job:

1. **e2e lane:** written into `.dev.vars` (`ci.yml:261-264`). The workerd preview's
   `createServerClient` runs with the legacy key.
2. **Integration lane, solver service:** uvicorn inherits `SUPABASE_KEY`. Its password grant and
   PostgREST calls send that key as `apikey` (`services/solver/src/cpsat_service/supabase.py:137,264`).
3. **Integration lane, `solver-credential` suite:** through `readPublishableKey()`. F-401's matrix
   would become the fourth consumer.

Everywhere else the key is `sb_publishable_…`: local dev and preview, local e2e and integration runs
(through `.dev.vars`), the native solver (`local.vars`), and production (the Worker secret,
forwarded to the container). **CI is the only environment on the legacy key.** No code checks the
key's prefix (`git log -S'sb_publishable'` touches only docs), and `astro.config.mjs:77-78`
declares `SUPABASE_KEY` as a plain string.

### Does the format change any result?

**Not for anything that exists today.** Both keys resolve to the `anon` Postgres role, and a
signed-in request carries the user's JWT on `Authorization` whichever key sits on `apikey`. The
current suites and F-401's matrix (including its anon rows) get identical outcomes.

**It will matter later, and in one known place.** Per the current Supabase docs
(`guides/getting-started/api-keys.mdx`, `guides/functions/auth-headers.mdx`), new keys "aren't
JWTs" and go on the `apikey` header, while legacy keys are sent as `Authorization: Bearer <key>`.
That changes the header shape an Edge Function sees:

- with a legacy key, an unauthenticated call carries an `Authorization` header holding the anon JWT;
- with a publishable key, it carries no `Authorization` header.

`verify_jwt` accepts both "for migration compatibility", and the docs say functions must authorize
API keys in code. S-409's secret-holding component performs exactly such a live admin check. A CI
lane on the legacy key would test a header shape production never sends.

Separately, the legacy keys are on a deprecation path: a Management API toggle already disables
them on hosted (F-301 research `:254`: "legacy deprecated end-2026"). And CI installs the **latest**
CLI, as described next.

### A related drift: CI's CLI is unpinned and newer than the repo's

- `supabase/setup-cli` runs with an empty `version` input (`action.yml:15`; CI log of run
  `38041285341`: `INPUT_VERSION:` empty), so it installs the latest CLI.
- That run pulled GoTrue **v2.197.0**, against **v2.189.0** locally on the lockfile's CLI 2.117.0.
- The CLI's develop-branch docs already describe a new `--override-name EXPORTED_VARIABLE=NAME`
  syntax that "rejects unknown variables". So the `auth.anon_key=` path form, or any replacement,
  rides on whatever version the runner fetches.

The same applies to the earlier rate-limit finding, which rests on the local container's
configuration.

The service-role export has the same shape. `SUPABASE_SERVICE_ROLE_KEY` is the legacy
`service_role` JWT in CI, while CLAUDE.md says "`sb_secret_…` appears only in Node tooling and
tests". Switching it touches all 36 suites, the provisioning scripts and `bench/`, so it is a larger
step than the publishable switch.

### Recommendation

**Keep the switch out of F-401 and make it a small CI change of its own**, landing before S-409
(the first slice where the format changes behaviour) and preferably before or alongside F-401.

- **Why not in F-401:**
  - The switch changes the env of all three CI consumers (the e2e preview, the solver service and
    the solver-credential suite), so a red build would be ambiguous between harness and wiring.
  - F-401's harness reads the key through `readPublishableKey()` and is format-agnostic, so
    switching later costs it nothing.
- **Scope of the CI change:**
  1. `action.yml`: `--override-name auth.publishable_key=SUPABASE_KEY`, and rename the input
     `export-anon-key` to `export-publishable-key`, updating both callers and the comments that
     call it the anon key.
  2. Pin the CLI the stack runs, so the override syntax and the auth container stop drifting:
     either `setup-cli`'s `version:` kept in step with `package.json`'s `supabase` (as the
     `wranglerVersion` and uv pins already are), or `pnpm exec supabase` from the lockfile.
  3. Optionally, `auth.secret_key` for the service-role variable, after confirming locally that the
     suites and `scripts/provision-*.mjs` work with `sb_secret_…`. The variable's name would stay or
     change with that decision.
- **Verification:** all four lanes green on the PR. The e2e log shows the preview signing in. The
  solver's startup line shows `credential_configured=True` and the role check passing. Add a
  one-line CI assertion that `SUPABASE_KEY` starts with `sb_publishable_`, so a future CLI change
  that quietly exports something else fails loudly.

**Decision (author, 2026-10-12):** this became its own roadmap item, **F-402**
(`ci-publishable-key-and-pinned-cli`). It has no prerequisites, runs in parallel with F-401, and is
a prerequisite of S-409. The secret-key switch and the pin mechanism are recorded as its Unknowns.
