# Test-Data, Isolation & CI Infrastructure for Integration Tests — Implementation Plan

## Overview

Stand up the database-test infrastructure the `test-plan.md` rollout assumes but
that doesn't exist yet. Four things: (1) run a trimmed Supabase stack in **CI** so
integration tests actually execute (today they silently skip); (2) make every test
**isolated** by owning its own `plans` row (cascade-delete teardown) instead of
sharing the mutable dev seed; (3) seed **advanced input + computed output** through
typed **scenario factories** so no test reads `"Seed Plan A/B"` by name; (4)
**unit-test the Astro action wrapper** (the one untested boundary in test-plan Risk #3).

Playwright e2e is explicitly a **follow-up change**, not this one.

## Current State Analysis

- **Integration tests skip in CI.** All 8 `*.integration.test.ts` suites gate on
  `(hasEnv ? describe : describe.skip)` where `hasEnv = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)`.
  CI (`.github/workflows/ci.yml`) runs `pnpm test` (unit only) — no Supabase, no
  `test:integration` — so every suite skips silently. `deploy` depends only on `ci`.
- **Isolation is convention, not mechanism.** Suites coordinate by hand: `endpoint`
  mutates `"Seed Plan A"` (no cleanup); `clone-plan`/`plan-actions` snapshot-clone
  `"Seed Plan A"` first to dodge the race; `students-crud` deliberately uses
  `"Seed Plan B"`; the bare-plan suites (`slot-bundles`, `teacher-availability`,
  `load` suite 2) own a fresh plan and are the only fully-resilient ones.
- **The seed is input-only.** `scripts/gen-seed.mjs` emits 7 catalog tables (`plans`,
  `teachers`, `courses`, `course_overlaps`, `course_merges`, `students`,
  `student_choices`) for two identical plans (`PLAN_NAMES`, line 434). It emits **zero**
  `placements`, `slot_bundles`, `teacher_availability`, `course_groupings`.
- **The action wrapper is a single chokepoint.** `defineDomainAction`
  (`src/shared/lib/actions/define-domain-action.ts`) wraps every action:
  `requireSession` → `requireSupabase` → `runDomain`. Its guard + `DomainError`→
  `ActionError` translation are DB-independent and currently untested.
- **A stub precedent exists.** `test/stubs/astro-env-server.ts` stubs `astro:env/server`,
  aliased in `vitest.config.ts`. `src/test/load-test-env.ts` hand-loads `.env.test.local`
  and respects pre-set `process.env` (`if (!(key in process.env))`).

### Key Discoveries:

- `defineDomainAction` is the only place the auth-guard + error-translation wiring
  lives — one unit test of it covers Risk #3's wiring contract for **all** actions
  (`src/shared/lib/actions/define-domain-action.ts:13`).
- `adapter-parity` and `load-1` assert against an oracle loaded from the **real CSVs**:
  `adapter-parity` compares `loadCohortCourses(plan,"dp2")` to `loadFixtureCourses("data/dp2")`
  (`adapter-parity.integration.test.ts:49`); `load-1` relies on the seed inserting a
  teacher with `full_name = null` (`load.integration.test.ts:68`). So a factory that
  invents its own catalog would break their oracle — **the factory must seed the same
  CSV-derived catalog**, which means extracting `gen-seed.mjs`'s transcode into a
  shared module both the script and the factory call.
- Everything cascades from `plans.id`; teardown is one `DELETE FROM plans WHERE id = …`.
- The `load` suite 2, `slot-bundles`, `teacher-availability` suites already implement
  the target pattern — the migration generalizes what they prove.
- In CI, the test env comes from `$GITHUB_ENV` (no `.env.test.local` file); `load-test-env.ts`
  already tolerates a missing file and won't overwrite pre-set vars.

## Desired End State

- A `pnpm test:integration` run executes (not skips) in CI against a freshly-booted,
  trimmed Supabase stack, and is **green**.
- Every integration suite owns its data inside a fresh plan and tears it down; **no
  suite references `"Seed Plan A/B"` by name** (enforced by a grep guard).
- Typed factories build advanced input (availability, merges/cores, slots) and produce
  **output** by driving the real domain functions; a base catalog is seeded per-plan
  from the real CSVs via a shared transcode module.
- `gen-seed.mjs` produces a byte-identical `seed.sql` after the transcode extraction.
- The action wrapper (`requireSession`/`requireSupabase`/`runDomain`/`defineDomainAction`)
  has unit coverage running in the existing CI unit lane.

## What We're NOT Doing

- **No Playwright / e2e** — deferred to a dedicated follow-up change (cookie
  `storageState` auth, `workers: 1`, etc. are scoped there).
- **No template-clone DB-per-worker isolation** — plan-rooted ownership is enough;
  revisit only if measured contention appears.
- **No perturbed-seed CI lane** — resilience is proven by a green CI run + the
  no-shared-reads invariant (grep guard), not a second stack boot.
- **No hosted Supabase branching** — self-hosted stack in the runner only.
- **No HTTP-route action integration tests** — the wrapper is unit-tested and the
  persistence half is already covered by the migrated domain-function suites.
- **No RLS / cross-author ownership tests — and no auth-user factory.** Exercising
  RLS-as-author (test-plan Risk #5) is Phase 3 of the test rollout, a separate change;
  the `createAuthedUser`/`signInAs` helpers ship **with** that follow-up, not here (no
  current suite consumes them). CI is already self-provisioning for the present
  `service_role` suites without any auth user.
- **No dp2 board work** — board stays dp1-only; factories take a `cohort` param so
  we're ready, but no dp2-specific UI/e2e.
- **No change to the deploy job's behavior** beyond adding the integration gate.

## Implementation Approach

Four incremental, independently CI-verifiable phases. Phase 1 makes the existing
suite *run* in CI (green, no rewrites) — the seed is freshly loaded by `supabase start`,
so even the seed-coupled suites pass. Phase 2 builds the factory harness and the
shared transcode (guarded by a byte-identical seed diff). Phase 3 migrates all six
seed-coupled suites onto the harness, achieving resilience. Phase 4 adds the action
wrapper unit tests in the unit lane.

## Critical Implementation Details

- **CI env source.** In CI the test vars are exported to `$GITHUB_ENV` via
  `supabase status -o env --override-name …` — there is no `.env.test.local` file.
  `load-test-env.ts` already swallows the missing file and only sets vars not already
  present, so it composes correctly; the fail-gate must read `process.env` after that.
- **Trimmed stack must keep `db` + `rest` + `kong`.** `supabase start -x` can exclude
  `studio,imgproxy,inbucket,realtime,storage,vector,analytics,edge-runtime,functions,meta`;
  `auth`/GoTrue is **not** in the excludable list and always boots. `supabase-js`
  reaches PostgREST through Kong, so those three are the live minimum — verify the
  trimmed set still serves the suite, and record `supabase start` wall-time.
- **Factory catalog must come from the real CSVs — via the shared row builder, not a
  re-implementation.** `adapter-parity`/`load-1` oracles are CSV-derived; the factory's
  `seedPlanCatalog` consumes the extracted transcode's ID-assigned, FK-remapped rows
  (same `data/dp1|dp2` source), rebinding them to the owned `plan_id`. The composite
  `(plan_id, x_id)` FK remap lives **only** in the shared builder, so the byte-identical
  seed diff guards it for both consumers. **Guard caveat:** the parity oracle
  `loadFixtureCourses` (`__fixtures__/cohort-catalog.node.ts`) is a *separate, independent*
  CSV parser (different newline/normalization handling) and is **not** under the
  byte-identical guard — it cross-checks only the dp2 course projection; `load-1` covers
  only the dp1 nameless-teacher case. Overlaps/merges/student_choices the factory seeds
  are guarded by single-sourcing (above), not by an oracle.
- **Byte-identical diff depends on `randomUUID()` call order.** The extraction must
  preserve the exact sequence of `randomUUID()` calls `emitPlan`/`emit*` make today
  (plan → teachers → courses dp1/dp2 → students dp1/dp2 → overlaps → merges → choices),
  or `diff <(node scripts/gen-seed.mjs) supabase/seed.sql` will be non-empty even when
  the data is equivalent.
- **Transcode module is tooling, not runtime.** It uses `node:fs`/CSV parsing and is
  consumed only by the build script and Vitest — never bundled into the Worker, so the
  no-Node-APIs hard rule is not engaged.
- **Auth-user factory is deferred to the e2e/RLS change (not built here).** No suite in
  this change consumes auth users — all current suites use `service_role` and touch no
  GoTrue. The `createAuthedUser`/`signInAs` helpers, auth-schema teardown, and the
  `email_confirm`/`inbucket`-trim handling land with the consumer that pins their shape.
  Recorded here so the follow-up has the context: the trimmed stack excludes `inbucket`,
  so a future factory must use `auth.admin.createUser({ email_confirm: true })` (never
  `signUp`, which hangs on email); auth users live in the `auth` schema and are not
  removed by the `plans` cascade, so they need explicit `auth.admin.deleteUser` teardown;
  and because the app uses `@supabase/ssr` cookie auth, e2e sign-in should drive the real
  `/api/auth/signin` route or inject `storageState` cookies — not a raw `supabase-js`
  Session.

---

## Phase 1: CI Supabase stack + fail-gating

### Overview

Add a CI job that boots the trimmed Supabase stack and runs `pnpm test:integration`,
and convert the silent-skip into a loud CI failure when the stack is expected but
absent. No test files are rewritten in this phase.

### Changes Required:

#### 1. New `integration` CI job

**File**: `.github/workflows/ci.yml`

**Intent**: Run integration tests in CI against a real, trimmed Supabase stack, in a
job parallel to `ci` so it doesn't slow lint/build feedback. Gate `deploy` on it.

**Contract**: A new `integration` job (`runs-on: ubuntu-latest`) with steps:
checkout → pnpm/action-setup → setup-node (`.node-version`, pnpm cache) →
`pnpm install --frozen-lockfile` → `supabase/setup-cli@v2` →
`node scripts/gen-seed.mjs > supabase/seed.sql` →
`supabase start -x studio,imgproxy,inbucket,realtime,storage,vector,analytics,edge-runtime,functions,meta` →
`supabase status -o env --override-name api.url=SUPABASE_URL --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY >> "$GITHUB_ENV"` →
`pnpm test:integration --no-file-parallelism`. Update `deploy.needs` from `ci` to
`[ci, integration]`. No repo secrets needed (the local stack mints its own keys).

**Serial-in-Phase-1 hedge.** Until Phase 3 migrates the seed-coupled suites, the
six fragile suites still rely on the hand-maintained snapshot-clone / distinct-plan
conventions (research §A flags these as fragile). Run the integration lane
**single-file** in Phase 1 (`--no-file-parallelism`, or a `poolOptions` single-thread
setting) so CI timing can't expose a cross-suite race before the isolation fix lands.
Phase 3 **removes** this flag (its success criteria add the plan-rooted isolation that
makes full parallelism safe by construction).

#### 2. Fail-in-CI gate

**File**: `src/test/load-test-env.ts`

**Intent**: When CI expects the stack (`process.env.CI === "true"`) but the required
vars are missing, fail the whole run loudly instead of letting suites skip; preserve
silent local skip when `CI` is unset.

**Contract**: After the file-load block, if `process.env.CI === "true"` and either
`SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is absent from `process.env`, `throw`
with a message naming the missing vars. Otherwise no-op (local DX unchanged). The
per-suite `hasEnv` `describe.skip` guards stay as the local-skip mechanism.

### Success Criteria:

#### Automated Verification:

- `pnpm test:integration` passes locally against the running local stack.
- The `integration` CI job is green and its log shows suites **executed**, not skipped.
- `ci` job (lint/steiger/unit/build) and `deploy` gating remain green.

#### Manual Verification:

- Confirm in the CI log that integration tests ran (test count > 0, no `skipped`).
- Record the `supabase start` boot time; note whether image caching is worth pursuing
  (decision rule: optimize only if the added wall-time is judged painful).
- Confirm the trimmed exclusion set still serves `supabase-js` (no PostgREST/Kong errors).

**Implementation Note**: After automated verification passes, pause for human
confirmation of the CI-log inspection and boot-time reading before Phase 2.

---

## Phase 2: Scenario-factory harness + catalog transcode extraction

### Overview

Extract the CSV→entities transcode from `gen-seed.mjs` into a shared module, then
build a typed factory harness that creates owned plans, seeds the real catalog, and
produces advanced input + output through the real domain functions.

### Changes Required:

#### 1. Shared catalog transcode

**File**: `scripts/lib/catalog-transcode.mjs` (new) + edits to `scripts/gen-seed.mjs`

**Intent**: Move **both** halves of the transcode into an importable module so the
factory inserts the *same* rows the seed emits — not a parallel re-implementation:
(1) the pure CSV→entity logic (`parseCSV`, `buildCohort`,
`enrichFromMergesAndOverlaps`, `verifyChoices`, normalizers), **and** (2) the
composite-key→UUID map building + FK-remapping currently fused into `emitPlan` /
`emitOverlaps` / `emitMerges` / `emitChoices` (`gen-seed.mjs:212-408`). After the
extraction `gen-seed.mjs` keeps only SQL *serialization* (`q`/`inserts`) over the
remapped rows the module returns; the factory's `seedPlanCatalog` inserts those same
rows. The composite-FK remap — the exact logic the two-plan (Seed Plan A/B) design
exists to stress — is then **single-sourced and under the byte-identical guard**,
instead of duplicated in `seedPlanCatalog` and left unguarded.

**Contract**: A `buildPlanRows(planName, dp1Data, dp2Data, fixtures)` (and the
per-table remappers) returns **ID-assigned, FK-remapped row collections** for every
table (`plans`, `teachers`, `courses`, `course_overlaps`, `course_merges`, `students`,
`student_choices`) — UUIDs assigned, composite-key→UUID maps resolved. `gen-seed.mjs`
imports it and serializes those rows to SQL with **identical `randomUUID()` call order**
so output stays byte-identical; `seedPlanCatalog` imports the same builder and inserts
the rows via Supabase. The byte-identical-output check (below) now guards the remap
logic both consumers share.

#### 2. Factory harness

**File**: `src/test/factories/` (new folder; `index.ts` pure barrel + one concept file per builder)

**Intent**: Provide the building blocks every integration suite uses to own and
populate a plan, then tear it down — input via direct inserts, output via the real
domain functions.

**Contract**: Barrel exports —
- `createPlan(supabase, opts?) → Promise<string>`: inserts a `plans` row (default
  preset `5x10`, unique name), registers it for teardown, returns the id.
- `seedPlanCatalog(supabase, planId)`: inserts the full CSV-derived catalog (both
  cohorts: teachers, courses, overlaps, merges, students, choices) for that plan by
  **consuming the shared transcode's ID-assigned, FK-remapped rows** (rebound to the
  owned `planId`) — it does **not** re-implement `emitPlan`'s map-building. Returns the
  id maps for assertions.
- `addAvailability`, `addMerge`, `addStudentWithChoices` — input builders (direct inserts).
- `placeCourse` (wraps `insertPlacement`), `ungroupSlot` (wraps `insertOverride`),
  `computeGroupingsFor` (wraps `computeAndPersistGroupings`) — **output** builders that
  drive the real domain functions.
- `teardown(supabase)`: cascade-deletes all registered plans (`DELETE FROM plans` for
  the owned ids — everything cascades from `plans.id`). Call in `afterAll`.

> **Deferred (not in this change):** `createAuthedUser` / `signInAs` and auth-schema
> teardown are **not** built here — no suite consumes them and RLS/e2e are out of scope.
> They land with the e2e/RLS follow-up that pins their shape (see the auth-user bullet
> in Critical Implementation Details for the captured context).

Follow the barrel + concept-file convention (index = pure barrel, one file per
concept, tests beside impl). Confirm `pnpm steiger` tolerates `src/test/**` (the
existing `src/test/load-test-env.ts` precedent); if not, fall back to root `test/factories/`.

### Success Criteria:

#### Automated Verification:

- `node scripts/gen-seed.mjs` output is byte-identical to committed `supabase/seed.sql`
  (`diff <(node scripts/gen-seed.mjs) supabase/seed.sql` is empty).
- `pnpm test:integration` stays green (harness exercised by at least one converted
  suite or a factory smoke test).
- A factory smoke test proves the plan lifecycle: `createPlan` + `seedPlanCatalog` build
  an owned, fully-cataloged plan, an output builder writes at least one row, and
  `teardown` cascade-removes the plan(s).
- `pnpm lint`, `pnpm steiger`, type-check, and `pnpm build` are clean.

#### Manual Verification:

- Inspect a factory-seeded plan in Supabase Studio — catalog matches a real seed plan.

**Implementation Note**: Pause for human confirmation after the byte-identical seed
check and a Studio spot-check before Phase 3.

---

## Phase 3: Migrate all six seed-coupled suites

### Overview

Move every seed-coupled suite onto the factory/plan-rooted pattern so none reads
`"Seed Plan A/B"` by name; drop the snapshot-clone workarounds; lock the invariant
with a grep guard. Once isolation is plan-rooted, **remove the Phase 1
`--no-file-parallelism` hedge** so the lane runs fully parallel again.

### Changes Required:

#### 1. Migrate the six suites

**Files**:
- `src/_pages/plan-detail/api/endpoint.integration.test.ts`
- `src/_pages/plans-list/api/clone-plan.integration.test.ts`
- `src/_pages/plans-list/api/plan-actions.integration.test.ts`
- `src/_pages/students/api/students-crud.integration.test.ts`
- `src/_pages/plan-detail/api/adapter-parity.integration.test.ts`
- `src/_pages/plan-detail/api/load.integration.test.ts` (suite 1 only)

**Intent**: Each suite creates a fresh plan via `createPlan`, seeds its own catalog
via `seedPlanCatalog` (plus output builders where it asserts on output), runs its
assertions against that owned plan, and cascade-deletes on teardown — removing all
name-lookups of the shared seed and the snapshot-clone preludes.

**Contract**: Per suite —
- `endpoint`: own plan → seed catalog → `computeGroupingsFor("dp2")` → assert persisted
  groupings/`catalog_hash` → teardown (was: mutated Seed Plan A, no cleanup).
- `clone-plan`: own plan → seed catalog + a few output rows (placements/availability/
  bundles via builders, so the clone copies a full graph) → `clone_plan` → assert
  row-count parity + id remap → teardown both plans (was: snapshot Seed Plan A).
- `plan-actions`: own plan → seed catalog → rename/delete/clone + groupings-hash
  recompute → teardown (was: snapshot Seed Plan A).
- `students-crud`: own plan → seed catalog (both cohorts incl. a merge for the
  cross-cohort guard) → CRUD + cohort-change + cascade-on-delete → teardown (was: Seed Plan B).
- `adapter-parity`: own plan → seed catalog → compare `loadCohortCourses(plan,"dp2")`
  with `loadFixtureCourses("data/dp2")` → teardown (oracle still CSV-derived, now via
  the same transcode).
- `load` suite 1: own plan → seed catalog (dp1) → `loadPlannerData` → assert name-record
  coverage + nameless-teacher→code → teardown. Optionally refactor suite 2 to use
  `createPlan`/`teardown` for consistency.

#### 2. No-shared-reads invariant + guard

**Files**: `src/test/no-seed-coupling.test.ts` (new) + `context/foundation/test-plan.md` (§6.2 cookbook)

**Intent**: Permanently prevent regressions to seed-name coupling and document the
isolation convention for future tests.

**Contract**: A unit test (runs in `pnpm test`) that scans `**/*.integration.test.ts`
and fails if any file matches `/Seed Plan [AB]/`. Add a §6.2 cookbook note describing
the `createPlan` + `seedPlanCatalog` + `teardown` pattern as the standard.

### Success Criteria:

#### Automated Verification:

- `pnpm test:integration` green with all six suites migrated.
- The grep-guard unit test passes (and fails if a `"Seed Plan"` reference is reintroduced).
- No `*.integration.test.ts` references `"Seed Plan A"`/`"Seed Plan B"` (the guard).
- `pnpm lint`, `pnpm steiger`, `pnpm build` clean.

#### Manual Verification:

- One-time independence check: alter/empty `supabase/seed.sql`, `supabase db reset`,
  run `pnpm test:integration` → still green; then restore the seed. Confirms a dev-DB
  exchange cannot affect a run.

**Implementation Note**: Pause for human confirmation of the one-time independence
check before Phase 4.

---

## Phase 4: Action-boundary unit tests

### Overview

Unit-test the single action wrapper and its helpers (auth guard + error translation +
client resolution), the one untested boundary in test-plan Risk #3, using a small
`astro:actions` stub. Runs in the existing unit lane.

> **Divergence from research decision #2 (deliberate).** Research #2 sketched invoking
> the real handler in the *integration* lane. The wrapper is pure, DB-independent logic
> (`requireSession` reads `locals.user`; `runDomain` translates errors; `requireSupabase`
> checks the client for null), so we unit-test it in the existing fast unit lane behind
> stubs instead — no stack, no handler round-trip. The full HTTP `/_actions/*` path stays
> for the deferred Playwright e2e, as research #2 also notes.

### Changes Required:

#### 1. `astro:actions` stub + alias

**File**: `test/stubs/astro-actions.ts` (new) + `vitest.config.ts`

**Intent**: Make `astro:actions` importable under Vitest (the helpers import
`ActionError`/`ActionAPIContext`/`defineAction`) so the wrapper is unit-testable,
mirroring the existing `astro:env/server` stub.

**Contract**: Stub exports a minimal `ActionError` (carrying `code`/`message`), a
passthrough `defineAction` (returns an object exposing the `handler`), and the
`ActionAPIContext` type shape used by the helpers. Add an `astro:actions` alias to
`vitest.config.ts` alongside the existing `astro:env/server` alias.

#### 2. Wrapper unit tests

**File**: `src/shared/lib/actions/__tests__/define-domain-action.test.ts` (new)

**Intent**: Assert the boundary contract once, covering every action that uses the
factory.

**Contract**: Cases —
- `requireSession`: no `locals.user` → throws `ActionError` `UNAUTHORIZED`; with user → returns.
- `runDomain`: `DomainError` → `ActionError` with the same `code`/`message`; a
  non-`DomainError` throw propagates unchanged; success returns the value.
- `requireSupabase`: `createClient` returning `null` → throws `INTERNAL_SERVER_ERROR`.
  This case is **free** — the existing `astro:env/server` stub leaves `SUPABASE_URL`/`KEY`
  undefined, so the real `createClient` returns `null` with no extra mocking.
- `defineDomainAction`: with an authed context and `createClient` mocked to a fake
  client, the `run` fn receives `(supabase, input)` and a thrown `DomainError`
  surfaces as the translated `ActionError`.

**Mocking strategy.** `createClient` is module-imported from `@/shared/api` (not
injectable), so the fake-client path uses `vi.mock("@/shared/api", …)` to return a stub
client; the null-client path needs no mock (relies on the env stub above). `astro:actions`
is resolved by the new alias/stub, not `vi.mock`.

### Success Criteria:

#### Automated Verification:

- New action-boundary unit tests pass under `pnpm test` (CI unit lane).
- `pnpm lint`, `pnpm steiger`, type-check, `pnpm build` clean with the new stub + alias.

#### Manual Verification:

- None required (pure logic; covered by automated tests).

---

## Testing Strategy

### Unit Tests:
- Action wrapper boundary (Phase 4): guard, error translation, client resolution.
- No-seed-coupling grep guard (Phase 3).

### Integration Tests:
- All existing suites, now plan-rooted and CSV-catalog-seeded via factories (Phase 3),
  running in CI against the trimmed stack (Phase 1).
- Factory output builders exercised through the real domain functions
  (`insertPlacement`/`insertOverride`/`computeAndPersistGroupings`).

### Manual Testing Steps:
1. Inspect CI `integration` job log: tests executed, not skipped; note boot time.
2. Studio spot-check a factory-seeded plan vs a real seed plan.
3. One-time seed-independence check (alter seed → reset → suite still green → restore).

## Performance Considerations

The only new cost is `supabase start` cold-image pull in CI (Phase 1), mitigated by
the `-x` exclusion set. Measure it; pursue Docker-image caching only if the wall-time
is judged painful. Factory per-test catalog seeding adds inserts per suite but each is
plan-scoped and torn down; acceptable for the integration lane.

## Migration Notes

All changes are additive (new CI job, new test helpers, test rewrites, a new stub).
`gen-seed.mjs` is refactored but its output is unchanged (byte-identical guard). No
schema migrations. Rollback = revert the commits; no data to preserve.

## References

- Research: `context/changes/data-for-e2e-and-integration-tests/research.md`
- Strategy/risks: `context/foundation/test-plan.md` (Risk #3; §3 Phases; §6 cookbook)
- Action wrapper: `src/shared/lib/actions/define-domain-action.ts`
- Stub precedent: `test/stubs/astro-env-server.ts`, `vitest.config.ts`
- Bare-plan exemplars (target pattern): `src/_pages/plan-detail/api/slot-bundles.integration.test.ts`,
  `src/_pages/teachers/api/teacher-availability.integration.test.ts`
- Seed generator: `scripts/gen-seed.mjs`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: CI Supabase stack + fail-gating

#### Automated

- [x] 1.1 `pnpm test:integration` passes locally against the running local stack — 9ce70a4
- [x] 1.2 `integration` CI job green; log shows suites executed, not skipped — 106c4c3
- [x] 1.3 `ci` job and `deploy` gating remain green — 9ce70a4

#### Manual

- [x] 1.4 CI log confirms integration tests ran (count > 0, none skipped) — 106c4c3
- [x] 1.5 `supabase start` boot time recorded; caching decision noted — 106c4c3
- [x] 1.6 Trimmed exclusion set confirmed to serve supabase-js (no PostgREST/Kong errors) — 106c4c3

### Phase 2: Scenario-factory harness + catalog transcode extraction

#### Automated

- [x] 2.1 `node scripts/gen-seed.mjs` output byte-identical to committed `supabase/seed.sql` — fdb76dd
- [x] 2.2 `pnpm test:integration` stays green (harness exercised) — fdb76dd
- [x] 2.3 Factory smoke test: `createPlan` + `seedPlanCatalog` + output builder → `teardown` cascade-removes plan(s) — fdb76dd
- [x] 2.4 `pnpm lint`, `pnpm steiger`, type-check, `pnpm build` clean — fdb76dd

#### Manual

- [x] 2.5 Studio spot-check: factory-seeded plan matches a real seed plan — fdb76dd

### Phase 3: Migrate all six seed-coupled suites

#### Automated

- [x] 3.1 `pnpm test:integration` green with all six suites migrated — 947da2d
- [x] 3.2 Grep-guard unit test passes (and fails on a reintroduced `"Seed Plan"` reference) — 947da2d
- [x] 3.3 No `*.integration.test.ts` references `"Seed Plan A"`/`"Seed Plan B"` — 947da2d
- [x] 3.4 `pnpm lint`, `pnpm steiger`, `pnpm build` clean — 947da2d

#### Manual

- [x] 3.5 One-time seed-independence check passes (alter seed → reset → green → restore) — 947da2d

### Phase 4: Action-boundary unit tests

#### Automated

- [x] 4.1 New action-boundary unit tests pass under `pnpm test`
- [x] 4.2 `pnpm lint`, `pnpm steiger`, type-check, `pnpm build` clean with the new stub + alias
