# Signed-in Client per Role for the Integration Lane — Implementation Plan

## Overview

F-401 (#155) builds the integration lane's first **signed-in human client** and a **role-matrix
suite** that pins today's access posture in a typed expectation table. It carries the harness half of
health-check Fix 1. S-403 then adds `user_roles` and role assignment, and flips the table's
expectations: the suite goes red, and the policy migration turns it green. That flip is the proof
that the suite can fail, and it lands in a PR rather than on a red `main`.

No migration and no schema change: nothing in this change deploys to hosted.

## Current State Analysis

- **Every human-facing check runs as `service_role` (BYPASSRLS).** 36 integration suites build
  `createClient<Database>(SUPABASE_URL, SERVICE_KEY)` themselves. The only signed-in suite is
  `src/test/solver-credential.integration.test.ts`, and it signs in as the **machine** user
  (`:62-94`). No test can fail on a human role holding *too much* access, and making access
  fail-closed is exactly the removal of excess access (research §1, row 5).
- **Live posture, 2026-10-12** (catalog query against the local stack):
  - 16 `public` tables, all with RLS on.
  - Each table has one `"Authenticated users have full access"` policy (`ALL to authenticated`,
    `using (true)`). `generation_jobs` also has the solver's two policies.
  - `anon` holds TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on 15 tables, and nothing on
    `generation_jobs`.
  - `authenticated` holds all eight privileges everywhere.
  - All 13 RPCs are `SECURITY INVOKER`.
- **Before S-403 only three principals can be told apart:** `anon`, any signed-in human (any future
  role), and `solver_job_writer`. The solver is already covered by `solver-credential`.
- **What already exists for the harness:**
  - `readPublishableKey()` (`src/test/publishable-key.ts:16-17`), which works with either key
    format;
  - `connectPostgres`, `heldPrivileges` and `heldColumnPrivileges` (`src/test/postgres-client.ts`);
  - the create → sign in → delete pattern (`solver-credential…:67-91`);
  - a factory for each of the plan-rooted tables except `shelf_bundles`, `shelf_bundle_courses` and
    `generation_jobs`.
- **`teardown` knows only plans** (`src/test/factories/teardown.ts:7-24`). Auth users don't cascade
  from plans, so the precedent deletes its user outside `teardown` (`solver-credential…:91`).
- **The CI fail-loud gate is split.** `load-test-env.ts:28-36` requires only `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`. `solver-credential` carries its own `SUPABASE_KEY` gate
  (`:40-48`). The integration job already exports the key (`ci.yml:110-112`,
  `export-anon-key: "true"`).

## Desired End State

- **`createSignedInUser(admin)`** returns `{ id, email, client }`: a confirmed human Auth user and
  a publishable-key client signed in as that user. The user is registered with `teardown`, which
  deletes plans first and then users, always through the admin client.
- **`role-matrix.integration.test.ts`** runs every cell of `role-matrix-expectations.ts`, live:
  - a SELECT on all 16 tables;
  - INSERT, UPDATE and DELETE on the five representative tables (`placements` INSERT goes through
    `place_course`);
  - a call to `clone_plan`;
  - an exact catalog check of grants and RLS on every public table.

  Today it is green with `anon` denied everywhere and the role-less user **allowed** everywhere,
  and the test output names that as the hole S-403 closes.
- **Every outcome is established, not inferred from `error`:**
  - a read is judged from the role's own view (fixture rows visible, versus an empty table or
    42501);
  - a write is judged by reading back as service role;
  - any other error fails the test.
- **The suite has been shown to fail.** A recorded local drill (a scratch restrictive policy) turns
  every role-less cell red for the right reason, and green again once it is removed.
- **Docs point at the harness:** CLAUDE.md and `test-plan.md`.

Verify with `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test` and `pnpm test:integration`
against the local stack, plus the drill record in `change.md`.

### Key Discoveries:

- **Denials come in four shapes** (research §3):
  - a missing grant raises 42501;
  - RLS on INSERT raises 42501;
  - RLS on SELECT returns an empty result with no error;
  - RLS on UPDATE or DELETE affects 0 rows with no error.

  Only read-back can tell the last two apart from success (`solver-credential…:179-185`, "assert on
  the row, not on `error`").
- **`clone_plan` reports a hidden source in its own words.** It reads its source inside
  `insert … select … from public.plans` and raises `'clone_plan: source plan % not found'` (P0001)
  when no row comes back (`20260711174905_clone_plan_include_board.sql:27-35`). Under S-403's
  fail-closed policies, the role-less user's denial surfaces as that P0001, not 42501.
- **Table quirks:**
  - All five representatives have `id uuid default gen_random_uuid()`, so a probe can supply its
    own id.
  - All 15 tables under `plans` carry `plan_id`. Only `course_grouping_members` has no `id`
    (`database.types.ts:75-84`).
  - `generation_jobs_active_per_plan` allows one queued or running job per plan
    (`20260810200122_generation_jobs.sql:103-104`).
  - `courses_unique (plan_id, cohort, name, level, group_index)` makes `name` a collision-prone
    UPDATE target. `color` has no constraint.
- **The minimal fixture calls are mapped:**
  - `addCourse({ teacherIds })` writes `course_teachers` (`add-course.ts:39-44`).
  - `placeCourse` writes a `bundles` row and a `placements` row.
  - `computeGroupingsFor` needs only one course chosen by one student.
  - `shelveCourses` (`src/_pages/plan-detail/api/shelf.ts:100-110`) fills both shelf tables.
  - `generation_jobs` takes the `jobRow` shape from `solver-credential…:266-283`.
- **Rate limits:** password grants fall under GoTrue's `token_refresh` bucket, and 45 back-to-back
  grants returned no 429s. The remaining risk is CI's unpinned CLI (F-402), so sign in once per
  principal per file.
- **A test that has never been shown to fail is not yet a guard**
  (`docs/runbooks/solver-credential.md:188-208`). The drill follows that kill-switch precedent.

## What We're NOT Doing

- **Belongs to S-403:** the `user_roles` table, role assignment on the factory, admin/author/viewer
  principals, and the expectation flip.
- **Belongs elsewhere:**
  - e2e role accounts: HC Fix 2, which goes in S-403's fail-closed PR;
  - the `supabase db lint` gate: HC Fix 7;
  - Astro Action-level matrix rows: S-403/S-405, where `FORBIDDEN` first exists;
  - CI's key format and pinning the Supabase CLI: F-402. The harness reads the key format-agnostically.
- **Ruled out for F-401:**
  - pgTAP;
  - minting JWTs;
  - `it.fails` as the red-run proof;
  - running DDL inside a test, i.e. a permanent "calibration principal". Rejected in favour of the
    recorded drill.
- **Out of scope:**
  - a lane-wide loopback guard: the guard lives only in the factory;
  - moving `solver-credential` onto the new factory: it needs `app_metadata.machine_role`, which the
    factory must never set;
  - revoking `anon`'s TRUNCATE/REFERENCES/TRIGGER/MAINTAIN residue: no migration here. The matrix
    pins the residue as today's fact;
  - matrix rows for RPCs beyond `place_course` and `clone_plan`, such as `replace_course_teachers`
    and `apply_generated_placements`;
  - sweeping Auth users that a crashed run leaked;
  - editing `context/foundation/health-check.md`, a dated snapshot.

## Implementation Approach

The work splits into **two instruments and one data file**:

- **Rows** are proven through signed-in clients, by the probe.
- **Grants** are proven from the catalog, by `heldPrivileges` over `pg`.
- **The expectation table** is the specification both run against.

App roles will live in rows, not Postgres roles, so only the first instrument can ever tell admin,
author and viewer apart. That is why the probe's classification is the load-bearing part of this
change, and why it is a pure function with unit tests and a live drill.

The table is typed so that it stays complete:

- **A missing principal or table is a type error.** Cells are `Record<Principal, AccessOutcome>`,
  and table keys come from `keyof Database["public"]["Tables"]`. So S-403 adding a principal, or
  regenerating `database.types.ts` with `user_roles`, fails `pnpm check` until every cell is
  declared.
- **A new table without a declared posture fails at runtime.** The catalog check compares the
  **live** table set against the declared one.

## Critical Implementation Details

- **Writes never ask for rows back.** Don't chain `.select()` on a probe's INSERT, UPDATE or DELETE
  (PostgREST then uses `return=minimal`), and supply the INSERT's id from the client. A
  `return=representation` write adds a RETURNING clause, which Postgres checks against the
  **SELECT** policy (research `:243`), so a read denial would masquerade as a write denial once
  S-403 splits the two.
- **Register before attempting.** Call `registerPlan` for an INSERT into `plans` before the attempt.
  Register a `clone_plan` result as soon as it returns. The factory registers the user right after
  `createUser`, before signing in. An outcome that is allowed then still gets cleaned up, and a
  failed sign-in doesn't leak its user.
- **A non-access error is never "denied".** A malformed payload (23503, 23505, 22P02), a 401 or a
  Kong 502 must fail the test whatever the expectation. Otherwise every denied cell passes
  trivially. The expectations unit test enforces the other half: every write and RPC has at least
  one principal that is allowed, so the shared payload is shown to be valid.
- **Teardown is privileged.** It always runs on the admin client. With a role client, the plan
  delete would become a silent 0-row success under RLS, and `auth.admin.deleteUser` would refuse.
- **Timing.** The matrix's `beforeAll` creates and signs in the role-less user and builds a 16-table
  fixture. Give that hook an explicit timeout (about 30 s); Vitest's default is 10 s. Judge a red
  lane against the known ~1-in-5 transient-502 baseline (memory: integration lane flakes in
  parallel).

---

## Phase 1: Signed-in user factory and teardown registry

### Overview

The integration lane gets the ability to create a real human user, sign it in with the publishable
key and clean it up through `teardown`. CI fails loudly if the key it needs is missing.

### Changes Required:

#### 1. User registry in teardown

**File**: `src/test/factories/teardown.ts`

**Intent**: Track factory-created Auth users beside plans, and delete them in `teardown` after the
plans. Plans go first because S-403's `user_roles` cascades from `auth.users`, and S-407's
`created_by` will be set to null.

**Contract**:

- New export `registerUser(userId: string): void`, used by the factory. It is not re-exported from
  the barrel until a suite needs it.
- `teardown(supabase)` keeps its signature. It returns early only when **both** registries are
  empty. It attempts both deletes and throws one aggregated error listing every failure.
- A user who is already gone is not an error.
- The docblock states that the client must be the service-role client, and why.

#### 2. The signed-in user factory

**File**: `src/test/factories/create-signed-in-user.ts` (new), plus `src/test/factories/index.ts`

**Intent**: Create a confirmed human Auth user through the admin API, register it for teardown, sign
it in with the publishable key, and return the signed-in client. The factory refuses to run
against anything but a loopback stack, because the users it creates can sign in.

**Contract**:

- Signature: `export type SignedInUser = { id: string; email: string; client: SupabaseClient }` and
  `export async function createSignedInUser(admin: SupabaseClient): Promise<SignedInUser>`.
  Re-export both from the barrel.
- **Inputs:** reads `process.env.SUPABASE_URL` and `readPublishableKey()`, and throws (it does not
  skip) when either is missing.
- **Loopback guard:** the URL's hostname must be `127.0.0.1`, `localhost` or `::1`. Otherwise
  throw, naming the host.
- **Credentials:**
  - email `signed-in-<uuid>@example.test`;
  - password `` `${randomUUID()}Aa1!` ``: 40 characters, all four character classes, and no `#`,
    quotes or whitespace.
- **User creation:** `admin.auth.admin.createUser({ email, password, email_confirm: true })`.
  - Never `app_metadata`: the token hook trusts only `app_metadata.machine_role`.
  - Never `signUp`: it is disabled and rate-limited.
- **Client:** `persistSession: false` and `autoRefreshToken: false`.
- **Code layout:** private helpers sit below the export (newspaper order). The docblock names S-403's
  extension point: a `role` option, once `user_roles` exists.

#### 3. One CI fail-loud gate for the publishable key

**Files**: `src/test/load-test-env.ts`, `src/test/solver-credential.integration.test.ts`,
`.github/workflows/ci.yml`

**Intent**: In CI, a missing `SUPABASE_KEY` fails the whole run instead of letting the signed-in
suites `describe.skip` (the silent-zero-coverage trap).

**Contract**:

- `load-test-env.ts`: add `SUPABASE_KEY` to the CI-required list. Its error message names the
  `export-anon-key` input on the `supabase-stack` step. F-402 renames that input and owns updating
  the message.
- `solver-credential…`: remove the now-duplicated gate at `:40-48` and change nothing else.
- `ci.yml`: update the comment above `export-anon-key: "true"` (`:110-112`) to say that the role
  matrix signs in as well, and that `load-test-env.ts` fails the run when the key is missing.

#### 4. User lifecycle smoke

**File**: `src/test/factories/lifecycle.smoke.integration.test.ts`

**Intent**: Prove the factory and the registry end to end before any suite depends on them.

**Contract**: A new case, skipped when `readPublishableKey()` is undefined:

1. `createSignedInUser(admin)`;
2. the returned client's `auth.getUser()` yields the same id;
3. `teardown(admin)`;
4. `admin.auth.admin.getUserById(id)` no longer finds the user.

### Success Criteria:

#### Automated Verification:

- Types check: `pnpm check`
- Lint passes: `pnpm lint`
- FSD structure passes: `pnpm steiger`
- Unit lane passes: `pnpm test`
- Factory smoke and solver guard pass against the local stack: `pnpm test:integration src/test/factories/lifecycle.smoke.integration.test.ts src/test/solver-credential.integration.test.ts`
- Full integration lane passes locally: `pnpm test:integration`

#### Manual Verification:

- With `SUPABASE_URL` overridden to a non-loopback host, the lifecycle smoke's user case fails at
  the loopback guard, with the host in the message, before any request is sent.
- After a full `pnpm test:integration` run, `auth.users` holds no `signed-in-…@example.test`
  accounts (Studio, or a `select count(*) from auth.users where email like 'signed-in-%'`).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Access probe and the role matrix

### Overview

Add the probe that turns each access attempt into an established outcome, the expectation table that
S-403 will edit, and the suite that runs every cell live against today's posture.

### Changes Required:

#### 1. The access probe

**File**: `src/test/access-probe.ts` (new; test-lane helper beside `postgres-client.ts`)

**Intent**: Classify every attempt as `"allowed"` or `"denied"` from evidence: what the role sees
for a read, and a service-role read-back for a write. It refuses to guess on anything else, so a
harness fault can never pass as a denial.

**Contract**:

- `export type AccessOutcome = "allowed" | "denied"`.
- **Pure classifiers**, which the unit tests target:
  - `classifyRead({ error, seesFixtureRows, seesAnyRow })`:
    - 42501 → denied;
    - any other error → throw;
    - fixture rows visible → allowed;
    - nothing visible at all → denied;
    - other rows visible but none of the fixture's → throw "partial visibility". Under Model A
      that is neither outcome.
  - `classifyWrite({ error, effectObserved, deniedWhen? })`:
    - no error and an effect → allowed;
    - no error and no effect → denied (RLS's silent 0-row UPDATE or DELETE);
    - error 42501, or an error matching the call's `deniedWhen`, with no effect → denied;
    - an error **and** an effect → throw (a contradiction);
    - any other error → throw, with code and message.
- **Live probes**, kept thin so the logic stays in the classifiers:
  - **A read probe** issues two queries with the role client:
    - the table's rows for the fixture plan (`id` for `plans`, `plan_id` for the other 15);
    - `limit 1` over the whole table.
  - **A write probe** takes:
    - an attempt thunk, which returns `{ error }` and never chains `.select()`;
    - a read-back thunk, run on the admin client, which returns whether the effect landed;
    - an optional `deniedWhen`.
- **`deniedWhen`** is a per-call matcher for a denial an RPC reports in its own words. Today only
  `clone_plan` uses it, with its `source plan … not found` P0001 (`20260711174905:27-35`).

#### 2. Classifier unit tests

**File**: `src/test/access-probe.test.ts` (new; unit lane)

**Intent**: Pin every classification branch without a stack, so a wrong branch fails in `pnpm test`.

**Contract**: The cases:

- 42501 for both a grant denial ("permission denied for table …") and an RLS INSERT denial ("new row
  violates row-level security policy …") → denied;
- a silent 0-row UPDATE or DELETE → denied;
- an empty table → denied;
- fixture rows visible → allowed;
- partial visibility → throws;
- non-access errors (23503, 23505, a 401-style `PGRST301`, a network-shaped error with no code) →
  throw;
- an error plus an effect → throws;
- `deniedWhen` is honoured only for a matching message.

#### 3. The expectation table

**File**: `src/test/role-matrix-expectations.ts` (new)

**Intent**: The access spec as data, the file S-403's flip edits. Its diff is the review artifact.

**Contract** (typed with `satisfies` so that it stays complete):

- `Principal = "anon" | "noRole"`. S-403 adds `"admin" | "author" | "viewer"`.
- `PublicTable = keyof Database["public"]["Tables"]`.
- `READS: Record<PublicTable, Record<Principal, AccessOutcome>>`: all 16 tables, `anon` denied,
  `noRole` allowed.
- `WRITES: Record<RepresentativeTable, Record<"insert" | "update" | "delete", Record<Principal, AccessOutcome>>>`.
  The representative tables are `plans | courses | students | placements | generation_jobs`.
  `anon` is denied and `noRole` allowed.
- `RPCS: Record<"clone_plan", Record<Principal, AccessOutcome>>`.
- `GRANTS: Record<PublicTable, { anon: TablePrivilege[]; authenticated: TablePrivilege[] }>`:
  - `anon` = `["MAINTAIN","REFERENCES","TRIGGER","TRUNCATE"]` on 15 tables and `[]` on
    `generation_jobs`;
  - `authenticated` = all eight on all 16;
  - lists sorted as `heldPrivileges` returns them.
- `PRINCIPAL_NOTES: Record<Principal, string>`. The `noRole` note reads like "TODAY: a signed-in
  user without a role is allowed everywhere — the hole S-403 closes"; the suite puts it in its
  `describe` titles.
- The module docblock names each fact as **today's** posture, including `anon`'s auto-grant residue
  (which PostgREST can't reach).

#### 4. Expectation invariants

**File**: `src/test/role-matrix-expectations.test.ts` (new; unit lane)

**Intent**: Guard the table's shape, which is what makes a denied cell meaningful.

**Contract**:

- Every `WRITES` operation and every `RPCS` entry has at least one principal that is `"allowed"`.
  Without one, nothing proves the shared payload is valid.
- Every `GRANTS` list is sorted and free of duplicates.

#### 5. The role-matrix suite

**File**: `src/test/role-matrix.integration.test.ts` (new)

**Intent**: Run every expectation cell live and state each one in its title, so a red run reads as
an access diff.

**Contract**:

- **Env guard:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `readPublishableKey()`. Locally it
  falls back to `describe.skip`; in CI the Phase 1 gate makes a missing key a hard failure.
- **`beforeAll`** (explicit timeout, about 30 s):
  - **Clients:** the admin client; `pg` through `connectPostgres`; the `anon` principal (a
    publishable-key client with no session, never signed in); the `noRole` principal from
    `createSignedInUser(admin)`. Each principal is built once per file.
  - **A fixture plan with at least one row in all 16 tables:**
    - `createPlan`, `addTeacher`, `addAvailability`;
    - three `addCourse` calls in one cohort, one with `teacherIds`;
    - `addOverlap` and `addMerge`;
    - `addStudentWithChoices` choosing one course;
    - `computeGroupingsFor` for that cohort;
    - `placeCourse`;
    - `shelveCourses` on a course that isn't on the board;
    - one `generation_jobs` row in a **terminal** status, so it doesn't hold the plan's active-job
      slot.
- **`afterAll`:** `teardown(admin)` (plans, then the user), then `pg.end()`.
- **Fixture check:** the admin client sees at least one fixture row in each of the 16 tables, so a
  read cell can never fail on an empty fixture.
- **Sanity rows for `noRole`:**
  - the access token's `role` claim is `authenticated`;
  - `app_metadata.machine_role` is absent;
  - `sub` equals the user id.
- **Read cells:** one per (table × principal) from `READS`, through the read probe.
- **Write cells:** one per (table × operation × principal) from `WRITES`, each on its own fresh
  target so cells stay independent of order:
  - INSERT uses a client-supplied id;
  - UPDATE and DELETE act on a row the admin client creates for that cell;
  - every `generation_jobs` cell gets its own plan;
  - `placements` INSERT goes through the `place_course` RPC on a fresh course;
  - UPDATE sentinels: `plans.name`, `courses.color`, `students.full_name`,
    `placements.is_optional`, and `generation_jobs.error` on a terminal job.
- **RPC cells:** `clone_plan` from the fixture plan with `p_include_board: false`. The returned id
  is registered for teardown. The read-back checks that the new plan exists.
  `deniedWhen: /source plan .* not found/`.
- **Catalog check (`pg`):** one map, built from the live `public` base tables and compared with
  `toEqual` against `GRANTS` plus `rls: true`. Per table it holds `anon` privileges,
  `authenticated` privileges and `relrowsecurity`. An undeclared or vanished table shows up as a
  key difference.
- **Titles:** read like `noRole UPDATE students → allowed`. The `noRole` describe titles carry
  `PRINCIPAL_NOTES.noRole`.

### Success Criteria:

#### Automated Verification:

- Types check: `pnpm check`
- Lint passes: `pnpm lint`
- FSD structure passes: `pnpm steiger`
- Unit lane passes, including the classifier and expectation-invariant tests: `pnpm test`
- Role matrix passes against the local stack: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- Full integration lane passes locally: `pnpm test:integration`

#### Manual Verification:

- The role-matrix output lists:
  - 32 read cells;
  - 30 write cells;
  - 2 RPC cells;
  - the catalog check;
  - the fixture check;
  - the sanity rows.

  Every `noRole` title shows the "TODAY … S-403 closes" note.
- The matrix file runs in a reasonable time locally (a few seconds, not tens) and leaves no
  `signed-in-…` users and no `Factory Plan …` rows behind.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Prove the suite can fail, then point the docs at it

### Overview

Show, on the local stack, that the matrix catches RLS's silent denials for the right reason. Then
point CLAUDE.md and `test-plan.md` at the new harness.

### Changes Required:

#### 1. The deny drill

**Files**: `context/changes/give-integration-lane-a-signed-in-client-per-role/drill/deny-authenticated.sql`
and `…/drill/restore.sql` (new; change-folder artifacts, never under `supabase/`)

**Intent**: A scratch posture that denies `authenticated` everything at the RLS layer, leaves
grants alone, and doesn't touch `anon`, `service_role` or the solver. It produces exactly the
shapes S-403 will produce:

- SELECT reads empty;
- UPDATE and DELETE affect 0 rows;
- INSERT raises 42501;
- `clone_plan` raises its not-found error.

**Contract**:

- `deny-authenticated.sql` is a `do $$ … $$` block. Over every `public` base table it creates the
  policy `"f401 drill: deny authenticated"` as `as restrictive for all to authenticated using
  (false) with check (false)`.
- `restore.sql` drops that policy on every table where it exists.
- Run both with
  `docker exec -i supabase_db_ib-timetable-planner psql -U postgres -d postgres < <file>`.
- Expected while the drill policy is in place, when running `pnpm test:integration src/test/role-matrix.integration.test.ts`:
  - **Red, with "expected allowed, received denied":** all 32 `noRole` cells (16 reads, 15
    writes, `clone_plan`).
  - **Still green:** every `anon` cell, the catalog check (grants unchanged), the fixture check
    and the sanity rows.
- **Record the run in `change.md`:** date, red and green counts, any cell that went red for a
  different reason (that would be a probe bug to fix before proceeding), and the green re-run after
  `restore.sql`.

#### 2. CLAUDE.md pointer

**File**: `CLAUDE.md` (Database & auth section, the "Integration suites run as service-role" bullet,
`:51`)

**Intent**: Point the access-control rule at the harness instead of the machine-user precedent. This
follows lessons.md's rule that a doc citing a mechanism is coupled to it.

**Contract**: The bullet names `createSignedInUser` (`src/test/factories/`) and
`src/test/role-matrix.integration.test.ts` as the way to make an access-control claim. Keep the
`has_table_privilege` sentence.

#### 3. Test-plan bookkeeping

**File**: `context/foundation/test-plan.md`

**Intent**: Retire the stale cross-author/IDOR "Phase 2.5" deferral. The shared-workspace model
(Model A) has no per-author ownership, so the role matrix replaces it. Also teach the new pattern
in the integration cookbook.

**Contract**:

- **Rewrite** each "candidate Phase 2.5" or cross-author mention to say it is superseded by the role
  matrix (F-401, flipped by S-403). Those mentions are:
  - §2 Risk #5 (`:67`);
  - §3 notes (`:134-138`, `:150-151`);
  - the §5 gate row (`:234`);
  - §6.3 (`:348-349`);
  - §7 (`:467-473`).
- **Add** a §6.2 sub-entry, "Access-control claims — a signed-in client":
  - `createSignedInUser` plus the probe;
  - edit `role-matrix-expectations.ts` rather than writing a new suite;
  - sign in once per principal per file.
- **Bump** the "Last updated" line (`:9`).

### Success Criteria:

#### Automated Verification:

- Drill restored: `pg_policies` holds no `f401 drill` policy (`select count(*) from pg_policies where policyname like 'f401 drill%'` returns 0)
- Role matrix green again after restore: `pnpm test:integration src/test/role-matrix.integration.test.ts`
- Full local CI gate passes: `/verify`

#### Manual Verification:

- With the drill applied, exactly the 32 `noRole` cells are red, each with an "expected allowed,
  received denied" message. No cell is red from a thrown "unexpected error". The `anon`, catalog,
  fixture and sanity rows stay green.
- The drill result is recorded in `change.md`.
- CLAUDE.md and `test-plan.md` read correctly and no longer send readers to a cross-author phase.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- `access-probe.test.ts`: every classification branch, especially the silent-denial branches and the
  "a non-access error never counts as denied" rule.
- `role-matrix-expectations.test.ts`: every write and RPC has an allowed principal; grant lists are
  sorted.

### Integration Tests:

- `lifecycle.smoke.integration.test.ts`: create, sign in, tear down a user.
- `role-matrix.integration.test.ts`:
  - 32 reads, 30 writes and 2 RPC cells;
  - the 16-table catalog check;
  - fixture and token sanity.
- `solver-credential.integration.test.ts`: unchanged behaviour, now gated by `load-test-env.ts`.

### Manual Testing Steps:

1. Run the lifecycle smoke with `SUPABASE_URL=http://example.com:54321`. The loopback guard throws.
2. Apply `drill/deny-authenticated.sql` and run the role matrix. Exactly the `noRole` cells go red,
   for the right reason.
3. Apply `drill/restore.sql` and run the role matrix again. Everything is green.
4. After a full integration run, no `signed-in-%` users remain in `auth.users`.

## Performance Considerations

- **About 70 tests,** each costing two to four local HTTP round trips, plus one sign-in and one
  fixture per file. That is seconds locally.
- **CI caps the lane at `--maxWorkers=2`.** The suite adds one file to that queue, and no new
  parallel pressure on Kong.

## Migration Notes

None. No migration, no schema change, and nothing deploys to hosted. The drill touches only the
local stack, and `restore.sql` undoes it.

## References

- Research and decision: `context/changes/give-integration-lane-a-signed-in-client-per-role/research.md` (Option 1; follow-ups)
- Health-check Fix 1: `context/foundation/health-check.md:242-264`
- Roadmap: `context/foundation/roadmap.md` F-401 (`:106-117`), S-403 (`:169-173`); GitHub #155, #144
- Precedent: `src/test/solver-credential.integration.test.ts:62-94`, `:179-185`
- Grant probe: `src/test/postgres-client.ts:52-86`; posture precedent `src/test/generation-jobs.integration.test.ts:47-69`
- Drill precedent: `docs/runbooks/solver-credential.md:188-208`
- `clone_plan` not-found path: `supabase/migrations/20260711174905_clone_plan_include_board.sql:27-35`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Signed-in user factory and teardown registry

#### Automated

- [x] 1.1 Types check: `pnpm check` — 270b1c2
- [x] 1.2 Lint passes: `pnpm lint` — 270b1c2
- [x] 1.3 FSD structure passes: `pnpm steiger` — 270b1c2
- [x] 1.4 Unit lane passes: `pnpm test` — 270b1c2
- [x] 1.5 Factory smoke and solver guard pass against the local stack — 270b1c2
- [x] 1.6 Full integration lane passes locally: `pnpm test:integration` — 270b1c2

#### Manual

- [x] 1.7 Non-loopback `SUPABASE_URL` fails at the loopback guard before any request — 270b1c2
- [x] 1.8 No `signed-in-…@example.test` users remain after a full integration run — 270b1c2

### Phase 2: Access probe and the role matrix

#### Automated

- [x] 2.1 Types check: `pnpm check` — 968c4e4
- [x] 2.2 Lint passes: `pnpm lint` — 968c4e4
- [x] 2.3 FSD structure passes: `pnpm steiger` — 968c4e4
- [x] 2.4 Unit lane passes, including the classifier and expectation-invariant tests: `pnpm test` — 968c4e4
- [x] 2.5 Role matrix passes against the local stack — 968c4e4
- [x] 2.6 Full integration lane passes locally: `pnpm test:integration` — 968c4e4

#### Manual

- [x] 2.7 Matrix output lists every cell and the `noRole` titles carry the hole note — 968c4e4
- [x] 2.8 The matrix runs in seconds locally and leaves no users or plans behind — 968c4e4

### Phase 3: Prove the suite can fail, then point the docs at it

#### Automated

- [x] 3.1 Drill restored: no `f401 drill` policy in `pg_policies` — 1ab044e
- [x] 3.2 Role matrix green again after restore — 1ab044e
- [x] 3.3 Full local CI gate passes: `/verify` — 1ab044e

#### Manual

- [x] 3.4 With the drill applied, exactly the 32 `noRole` cells are red for the right reason — 1ab044e
- [x] 3.5 Drill result recorded in `change.md` — 1ab044e
- [x] 3.6 CLAUDE.md and `test-plan.md` point at the harness and drop the cross-author phase — 1ab044e
