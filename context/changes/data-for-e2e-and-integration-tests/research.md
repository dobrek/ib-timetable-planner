---
date: 2026-06-15T14:02:35+02:00
researcher: Dobromir Kropielnicki
git_commit: 4da782febfec9bd817c0d59bed29692e7fd3224a
branch: main
repository: ib-timetable-planner
topic: "Isolating the test database and seeding advanced (input + output) data for integration and Playwright e2e tests, runnable locally and in CI"
tags: [research, testing, integration-tests, e2e, playwright, supabase, ci, seeding, test-isolation]
status: complete
last_updated: 2026-06-15
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Resolved all five open questions in discussion; decisions recorded below."
---

# Research: Isolating the test database and seeding advanced data for integration + e2e tests

**Date**: 2026-06-15T14:02:35+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 4da782febfec9bd817c0d59bed29692e7fd3224a
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

The current setup works for unit tests and partially for integration tests run
locally. We want integration — and eventually Playwright e2e — tests to be
**resilient** (a change/exchange in the local dev database must not break a run)
and to **run in CI**. So we need to **isolate the test database** both locally and
in CI. Going further: today's tests bootstrap off the dev seed, which is only a
**starting point**. Future actions (teacher availabilities, "filets with cores",
boards with a proper set of slots, placed courses) need **richer data** — not just
*input* but also *output*. What are the options, and what should we do? Playwright
is the likely e2e runner and CI execution is the goal.

## Summary

**The core problem is coupling, not configuration.** Integration tests today connect
to the **single local dev Supabase** with the `service_role` key and find their data
by **looking up seed rows by name** ("Seed Plan A" / "Seed Plan B"). Isolation exists
only as a hand-maintained convention (different suites claim different seed plans;
some snapshot-clone the seed first; bare-plan suites mint per-run unique names). That
is exactly why a dev-DB exchange breaks a run, why parallelism is fragile, and why the
suite cannot move to CI as-is. CI runs **unit tests only**; every integration suite
**silently `describe.skip`s** when the env/stack is absent — which is always true in CI.

**The seed is input-only.** `scripts/gen-seed.mjs` emits exactly 7 catalog/input
tables (`plans`, `teachers`, `courses`, `course_overlaps`, `course_merges`,
`students`, `student_choices`). It emits **zero** `placements`, `slot_bundles`,
`teacher_availability`, or `course_groupings`. So there is no "output" data and no
"advanced input" (availability, slots) in the seed at all — confirmed by grepping
`seed.sql`. Every test that needs those builds them inline today.

**Recommendation (committed) — a layered, three-part architecture:**

1. **Run the real Supabase stack in CI** via the **official `supabase/setup-cli`
   action → `supabase start`** (free, self-hosted in the GitHub runner; Docker is
   preinstalled on `ubuntu-latest`). `supabase start` auto-applies migrations + runs
   `seed.sql`, and ships GoTrue/Auth + RLS — which we need (we test auth/RLS), so the
   slimmer `supabase db start` (DB-only) is **not** sufficient. This is Supabase's
   own documented CI pattern. **Verified.**

2. **Isolate by ownership, not by shared mutation.** Make the *root* the unit of
   isolation: **every test (or worker) creates its own `plans` row and works only
   inside it**, then tears down with a single `DELETE FROM plans WHERE id = …`
   (everything cascades from `plans.id`). This is already proven by the
   `slot-bundles` / `teacher-availability` suites. It is parallel-safe, survives a
   dev-DB exchange (tests never read shared seed state), and is the lowest-friction
   path from where we are. Reserve heavier mechanisms (schema/DB-per-worker via
   `CREATE DATABASE … TEMPLATE`) as an upgrade only if contention bites. **Do not**
   use transaction-rollback isolation — it cannot work for Playwright (the app server
   holds its own connection) and forces serial Vitest.

3. **Seed in two layers: a static catalog base + typed scenario factories.** Keep
   `seed.sql` as the immutable reference catalog (the DP1/DP2 courses/students), and
   add **typed TS "scenario builder" factories** that, given a fresh plan, insert
   advanced input (availability, merges/cores, slot grid) and produce **output by
   driving the real domain functions** (`insertPlacement`, `insertOverride`,
   `computeAndPersistGroupings`) rather than hand-writing result rows. The factories
   are shared by Vitest and Playwright. This gives "input + output" scenarios that are
   genuinely *computed*, so the tests assert against real behavior, not transcribed
   fixtures.

For Playwright specifically: auth here is **cookie-based `@supabase/ssr`** (verified
in `src/shared/api/supabase.ts`), so session injection must use **`storageState`
cookies** (or hit the real `/api/auth/signin` route), **not** a localStorage token;
seed per-test scenarios through the admin client / factories; run **`workers: 1` in
CI** as the safe default initially.

A phased migration path (small, independently shippable steps) is in
[§7 Recommendation](#7-recommendation-committed-architecture--phased-path).

---

## Detailed Findings

### A. The current integration-test harness — isolation is convention, not mechanism

**How tests connect.** Each `*.integration.test.ts` reads `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` from `process.env`, loaded by the Vitest setup file
`src/test/load-test-env.ts`, which hand-parses `.env.test.local` (gitignored;
local-only; never committed, never in CI by design). The `service_role` key
bypasses RLS so tests read/write directly without a session.

**The skip gate.** Every suite uses `(hasEnv ? describe : describe.skip)(…)` where
`hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY)`. In CI both vars are undefined →
**all integration tests skip silently**. There are 9 such gates across the 8 files.

**Isolation today = three hand-maintained conventions** (no transactions, no schema
isolation, no per-test DB; all suites share one DB):

| Suite | Plan used | R/W | Coordination strategy (verbatim intent) |
|---|---|---|---|
| `endpoint.integration.test.ts` | **Seed Plan A** (dp2) | Write groupings, **no cleanup** | Mutates the shared seed plan directly. |
| `clone-plan.integration.test.ts` | Seed Plan A → snapshot | Write | *"Other integration suites mutate 'Seed Plan A' … while files run in parallel, so this suite first snapshots the seed plan with one atomic clone_plan call and uses that frozen base as its source."* |
| `plan-actions.integration.test.ts` | Seed Plan A → snapshot | Write | *"Like the clone-RPC suite, it snapshots 'Seed Plan A' first so parallel files mutating the seed plan can't race it."* |
| `students-crud.integration.test.ts` | **Seed Plan B** | Write students/choices | *"Seed Plan B, deliberately … sharing a plan makes parallel runs flaky."* |
| `adapter-parity.integration.test.ts` | Seed Plan A (dp2) | Read-only | No mutation → no race. |
| `load.integration.test.ts` (suite 1) | Seed Plan A | Read-only | No mutation. |
| `load.integration.test.ts` (suite 2) | **Bare plan** | Write availability | Creates its own plan; cleans up. |
| `slot-bundles.integration.test.ts` | **Bare plan + run-id** | Write bundles | *"Each test owns a freshly-created BARE plan rather than a clone of the shared seed … keeps the suite independent of seed contents AND of any other data already sitting in the dev DB."* |
| `teacher-availability.integration.test.ts` | **Bare plan + run-id** | Write availability | *"availability needs a real teacher (composite FK) … each test seeds a bare plan + one teacher."* |

**Key insight:** the suites already split into two philosophies. The **bare-plan**
suites (`slot-bundles`, `teacher-availability`, `load` suite 2) are the resilient
ones — they depend on **nothing** in the seed and survive a dev-DB exchange. The
**seed-coupled** suites (`endpoint`, `clone-plan`, `plan-actions`, `students-crud`,
`adapter-parity`, `load` suite 1) are the fragile ones that break when the seed
changes or when files race. **The fix is to generalize the bare-plan pattern** — it's
the project's own, already-working answer to the isolation question.

**Vitest config has no isolation knobs.** `vitest.integration.config.ts` sets only
`environment`, `include`, `setupFiles`. No `pool`, `fileParallelism`, `sequence`,
`globalSetup`, or `maxConcurrency`. So files run in parallel by default and the
seed-coupled suites rely purely on the conventions above to not collide.

### B. The seed is INPUT-ONLY — there is no "output", and no "advanced input" either

`scripts/gen-seed.mjs` transcodes `data/dp1/` + `data/dp2/` CSVs into `seed.sql`,
running the pipeline twice with fresh UUIDs to produce **Seed Plan A** and **Seed
Plan B** (identical content; two copies exist to make composite-FK remapping bugs
fail loudly, not to provide different scenarios). It emits exactly:

- ✅ `plans`, `teachers`, `courses`, `course_overlaps`, `course_merges`, `students`, `student_choices`

It does **not** emit (confirmed by grepping `seed.sql` → 0 hits each):

- ❌ `placements` (the timetable **output**)
- ❌ `slot_bundles` (board grouping overrides)
- ❌ `teacher_availability` (advanced constraint input)
- ❌ `course_groupings` / `course_grouping_members` (computed palette hints)

So the user's instinct is exactly right: **the dev seed is a starting point that
covers only the catalog input.** Everything the future tests care about —
availability, merges/cores configured *for a scenario*, a board with placed courses —
is absent and must be built per-test.

### C. What the "advanced data" actually is (schema map)

- **`plans`** is the domain root; `plans.slot_grid_preset` (e.g. `'5x10'`) **is**
  "the board" — there is no per-slot table. A "board with a proper set of slots" =
  a plan with the right preset (parsed in `src/shared/lib/grid/grid.ts`, bounds
  days ≤ 7, periods ≤ 12).
- **"Filet with cores" = `course_merges`**: a `parent_course_id` (the virtual combined
  "filet" session) → `child_course_id` ("cores"). Merge-children legitimately carry
  `hours_per_week = 0`. At runtime `loadCohortCourses` collapses each merge into one
  virtual course whose `studentKeys` are the union of parent + children choices.
- **`teacher_availability`**: plan-scoped, **cohort-independent**, one row per
  constrained `(teacher, day, period)` with `severity` `strong` (cannot) / `soft`
  (prefers not). Absence of a row = available.
- **`slot_bundles`**: **inverted/opt-out** semantics — a cell with ≥2 occupants is
  bundled *by default*; a `slot_bundles` row is the explicit **un-bundle** exception.
- **`placements`** ⭐ is the **output table**: one row = one course-hour in a
  `(cohort, day, period)` cell. Unique on `(plan_id, cohort, day, period, course_id)`.
  The board currently renders **dp1 only** (`BOARD_COHORT = "dp1"` in `load.ts`),
  though dp2 is schema-ready.

**Complete-scenario insert order** (topological; authoritatively encoded by the
`clone_plan` RPC): `plans` → `teachers` → `teacher_availability` → `courses` →
`course_overlaps` → `course_merges` → `students` → `student_choices` → **`placements`**
→ `slot_bundles` → `course_groupings` → `course_grouping_members`. Teardown is one
`DELETE FROM plans WHERE id = …` — **every table cascades from `plans.id`**, which is
what makes plan-rooted isolation cheap.

### D. Output can be *computed*, not hand-written

There is **no batch/solver endpoint** — a placed timetable is produced by repeated
**single-row, idempotent** `insertPlacement` calls. The real write paths are domain
functions usable directly with a service-role client:

- `insertPlacement(supabase, input)` / `removePlacement(...)` — the output writes.
- `insertOverride(...)` / `deleteOverride(...)` — slot-bundle (un)grouping.
- `computeAndPersistGroupings(supabase, input)` — computes + persists palette hints
  via the `replace_cohort_groupings` RPC.
- `loadPlannerData(supabase, id)` — the canonical "read the whole board" path
  (placements + bundles + availability + groupings + merged catalog).

This is the foundation for the recommended seeding approach: **a factory inserts
input then calls these real functions to materialize output**, so "output" fixtures
are genuinely computed by the code under test rather than transcribed by hand.

---

## Options Survey

### 1. Database isolation strategies (local + CI)

| Strategy | Fits Vitest | Fits Playwright | Parallel-safe | Speed | Complexity | Notes for this project |
|---|---|---|---|---|---|---|
| **(a) Transaction per test (BEGIN/ROLLBACK)** | ✅ | ❌ **No** | ❌ forces serial | Fastest | Low | App server holds its own pool → e2e mutations never roll back. Supabase docs explicitly say app-level tests "cannot use transactions". **Reject.** |
| **(b) Plan-rooted ownership (each test owns a `plans` row, cascade-delete)** | ✅ | ✅ | ✅ | Fast | **Low** | The project's existing bare-plan pattern. No new infra. Survives dev-DB exchange. **Recommended baseline.** |
| **(c) Schema- / DB-per-worker via `CREATE DATABASE … TEMPLATE`** | ✅ | ✅ | ✅ strongest | ~10–70ms clone after one-time template build | Med–High | True DB-level isolation; point the app at a per-worker DB URL. Tools: IntegreSQL, pgtestdb. **Upgrade path if (b) contention bites.** |
| **(d) Truncate + re-seed between tests** | ✅ | ⚠️ serial only | ⚠️ | Medium | Low | Simple but slow at volume and not parallel-safe in a shared DB. |
| **(e) Fresh DB once per CI job + unique-ID discipline** | ✅ | ✅ | ✅ w/ discipline | Fast | Low | **Supabase's official recommendation** for app-level tests. Pairs naturally with (b). |
| **(f) Testcontainers (`@testcontainers/postgresql`)** | ✅ | ✅ | ✅ per-file | Container start cost | Med | Gives *plain* Postgres — **no GoTrue/`auth` schema**, so we'd rebuild auth ourselves. The **Supabase CLI stack is the better fit** here because we test Auth + RLS. |

**Reading of the table for us:** combine **(b) plan-rooted ownership** + **(e) fresh
seeded DB per job** as the baseline — it is the smallest delta from today and directly
uses a pattern already in the repo. Keep **(c) template-clone per worker** in the back
pocket for when parallel Playwright workers or heavy integration parallelism start
contending. Reject **(a)**. Avoid **(f)** because it discards the Auth stack we need.

### 2. Seeding strategies (input + output)

| Approach | What it is | Strengths | Weaknesses | Verdict |
|---|---|---|---|---|
| **Static SQL seed (`seed.sql`)** | Generated catalog, loaded on `supabase start`/`db reset` | Zero per-test cost; great for the immutable reference catalog | Can't express per-scenario or *output* data; brittle if used for scenarios | **Keep — for the base catalog only** |
| **Typed scenario factories / builders (TS)** | `make*` helpers that insert via admin client and **drive real domain fns** to produce output | Compose input→output; computed (not transcribed) output; shared by Vitest + Playwright; auto-cleanup closures | Must be written/maintained | **Recommended for advanced input + output** |
| **Declarative SQL fixtures per scenario** | Hand-written `.sql` per scenario | Explicit, reviewable | Output rows are hand-transcribed → drift from real logic; verbose with composite FKs | Niche; not preferred |
| **DB snapshots (capture/restore)** | Binary/SQL dump of a built state | Fast restore | Opaque, brittle, hard to review/evolve | **Discouraged** |
| **Third-party generators (Snaplet, etc.)** | Realistic bulk data | Volume | External dep; Snaplet hosted wound down; against self-hosted/free preference | Out of scope |

**Reading for us:** **layered** — `seed.sql` for the static catalog base, **typed
factories** for everything advanced (availability, merges/cores, slots) and all
output (placements via `insertPlacement`, bundles via `insertOverride`, groupings via
`computeAndPersistGroupings`). The factory pattern is the field's 2024–2026 consensus
for Supabase test data; reference blueprints exist (e.g. the `supabase-tdd-boilerplate`
repo and Supawright fixture).

---

## Supabase-in-CI (verified — the user explicitly asked to double-check)

- **There IS an official action: `supabase/setup-cli`** — composite action that
  installs/configures the Supabase CLI on hosted runners. Current as of 2026-05-21:
  **`v2` line (latest `v2.1.1`)** — the action README pins `@v2`; the **Testing docs
  page still shows `@v1`** (latest `v1.7.1`, also current). Both tags are live;
  **pin `@v2`** (README is the source of truth) — don't float `@latest`.
- **Official CI pattern:** `actions/checkout` → `supabase/setup-cli` →
  **`supabase start`** → run tests. `ubuntu-latest` has Docker preinstalled (required).
- **`supabase start` vs `supabase db start`:** `start` boots the **full stack**
  (Postgres + **GoTrue/Auth** + PostgREST + Studio + …); `db start` is DB-only and
  faster. **We need `supabase start`** because our tests use Auth (`service_role`,
  `auth.admin.createUser`, `signInWithPassword`) and RLS — GoTrue is not in `db start`.
- **Migrations + seed:** `supabase start` **auto-applies all migrations then runs
  `seed.sql`** on boot; `supabase db reset` does the same explicitly (use it only for
  a mid-run clean slate). Because our `seed.sql` is generated, run
  `node scripts/gen-seed.mjs > supabase/seed.sql` **before** `supabase start` in CI
  (or assert the committed seed is current).
- **Exporting env to the runner** (from the setup-cli README):
  `supabase status -o env --override-name api.url=SUPABASE_URL --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY >> "$GITHUB_ENV"`.

**Sketch CI steps (additive to the existing `ci` job):**

```yaml
- uses: supabase/setup-cli@v2
- run: node scripts/gen-seed.mjs > supabase/seed.sql   # regenerate catalog seed
- run: supabase start                                   # stack + migrations + seed
- run: supabase status -o env \
       --override-name api.url=SUPABASE_URL \
       --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY >> "$GITHUB_ENV"
- run: pnpm test:integration
- run: pnpm exec playwright test                        # later phase
```

**Caveat (flagged, unverified):** a cold runner pulls the Supabase Docker images
(~tens of seconds to minutes). There is no official image-cache recipe; the community
accepts the cold pull or uses a Postgres service container. Treat startup time as a
known CI cost, measure it, optimize later if needed.

---

## Playwright specifics (for the later e2e phase)

- **Auth is cookie-based `@supabase/ssr`** — verified in
  `src/shared/api/supabase.ts` (`createServerClient` + `parseCookieHeader`,
  sets cookies via Astro `cookies.set`); sign-in is the `/api/auth/signin` API route.
  → For Playwright, **inject the session as cookies in `storageState`** (or drive the
  real `/api/auth/signin` request and capture `storageState`). The localStorage
  `sb-<ref>-auth-token` technique does **not** apply to this app.
- **Auth project pattern:** a `setup` project authenticates once → saves
  `storageState`; downstream projects depend on it. For state-mutating suites,
  authenticate **per worker** keyed on `testInfo.parallelIndex`. Prefer **API login**
  over UI login for speed.
- **Isolation for e2e:** never transaction-rollback. Use **scenario factories via the
  admin client** (unique data per test + teardown cleanup), optionally **per-worker DB**
  (strategy c). Run **`workers: 1` in CI** as the pragmatic default to dodge Supabase
  connection-limit/contention until proven safe to parallelize.
- **Supawright** (Playwright fixture that recursively creates FK-respecting rows and
  auto-cleans on exit) is a relevant building block if we don't hand-roll factories.

---

## Code References

(Permalinks pinned to commit `4da782f`.)

- [`vitest.integration.config.ts`](https://github.com/dobrek/ib-timetable-planner/blob/4da782febfec9bd817c0d59bed29692e7fd3224a/vitest.integration.config.ts) — integration runner; no isolation/parallelism knobs set.
- [`src/test/load-test-env.ts`](https://github.com/dobrek/ib-timetable-planner/blob/4da782febfec9bd817c0d59bed29692e7fd3224a/src/test/load-test-env.ts) — hand-parses `.env.test.local`; the only source of `SUPABASE_SERVICE_ROLE_KEY`.
- [`src/shared/api/supabase.ts`](https://github.com/dobrek/ib-timetable-planner/blob/4da782febfec9bd817c0d59bed29692e7fd3224a/src/shared/api/supabase.ts) — `@supabase/ssr` **cookie-based** server client (drives the Playwright auth approach).
- [`src/middleware.ts`](https://github.com/dobrek/ib-timetable-planner/blob/4da782febfec9bd817c0d59bed29692e7fd3224a/src/middleware.ts) — deny-by-default auth via `auth.getUser()`.
- [`scripts/gen-seed.mjs`](https://github.com/dobrek/ib-timetable-planner/blob/4da782febfec9bd817c0d59bed29692e7fd3224a/scripts/gen-seed.mjs) — input-only seed generator; `PLAN_NAMES = ["Seed Plan A","Seed Plan B"]`.
- [`.github/workflows/ci.yml`](https://github.com/dobrek/ib-timetable-planner/blob/4da782febfec9bd817c0d59bed29692e7fd3224a/.github/workflows/ci.yml) — `ci` job runs `pnpm test` (unit only); no Supabase, no `test:integration`, no e2e.
- `src/_pages/plan-detail/api/placements.ts` — `insertPlacement` / `removePlacement` (the output write path).
- `src/_pages/plan-detail/api/slot-bundles.ts` — `insertOverride` / `deleteOverride`.
- `src/_pages/plan-detail/api/grouping-compute.ts` — `computeAndPersistGroupings`.
- `src/_pages/plan-detail/api/load.ts` — `loadPlannerData`; `BOARD_COHORT = "dp1"`.
- `src/shared/api/load-cohort-courses.ts` — merge-collapse logic ("filet with cores").
- `supabase/migrations/20260611180006_plans_as_domain_root.sql` — plans-as-root rebaseline; placements re-keyed onto `plan_id`.
- `supabase/migrations/20260613130001_clone_plan_with_teacher_availability.sql` — `clone_plan`: authoritative full entity dependency order.
- Bare-plan isolation exemplars: `src/_pages/plan-detail/api/slot-bundles.integration.test.ts`, `src/_pages/teachers/api/teacher-availability.integration.test.ts`.
- Seed-coupled (fragile) exemplars: `src/_pages/plan-detail/api/endpoint.integration.test.ts` (mutates Seed Plan A, no cleanup), `src/_pages/students/api/students-crud.integration.test.ts` (Seed Plan B).

---

## 7. Recommendation (committed architecture + phased path)

**Target architecture.**

- **CI database:** `supabase/setup-cli@v2` → `supabase start` (full stack) in a new CI
  job/step; regenerate `seed.sql` first; export env via `supabase status -o env`.
  Self-hosted in the runner, free, no hosted dependency.
- **Isolation:** plan-rooted ownership (strategy **b**) on a once-seeded DB (strategy
  **e**). Generalize the bare-plan pattern into a shared helper so **every** integration
  test (and Playwright scenario) owns its plan and cascade-deletes it. Migrate the
  seed-coupled suites off name-lookup of the shared seed.
- **Seeding:** `seed.sql` = static catalog base only; **typed scenario factories**
  build advanced input and **drive real domain functions** to produce output.
- **Playwright:** cookie `storageState` auth; per-test factory scenarios; `workers: 1`
  in CI initially.

**Phased path (each phase independently shippable and CI-greenable):**

1. **Wire Supabase into CI (no test changes).** Add `setup-cli@v2` + `supabase start`
   + env export + `pnpm test:integration` to the `ci` job. This alone makes the 3
   already-resilient bare-plan suites run in CI and flips the `describe.skip` gate on.
   Measure cold-start time.
2. **Extract a `withPlan` / scenario-factory harness.** A shared test helper that
   (a) creates a fresh plan, (b) exposes builders for teachers, availability, courses,
   merges/cores, students, choices, and output (placements/bundles/groupings via the
   real domain fns), (c) cascade-deletes on teardown. Co-locate per FSD conventions.
3. **Migrate the seed-coupled suites** (`endpoint`, `clone-plan`, `plan-actions`,
   `students-crud`, `adapter-parity`, `load` suite 1) onto the factory so none of them
   read shared-seed state by name. Now a dev-DB exchange cannot affect a run, and
   parallelism is safe by construction. Drop the snapshot-clone workarounds.
4. **Add the first Playwright e2e** for the drag→validate→feedback + persistence loop
   (test-plan §3 Phase 2), using cookie `storageState` auth and a factory-built
   scenario; gate it in CI.
5. **(Only if needed)** introduce template-clone DB-per-worker (strategy c) when
   parallel contention shows up in CI timings.

This sequence is consistent with the existing **test-plan.md** rollout (Phase 1
validator/route boundary already references a `testing-validator-trust-core` change;
Phase 2 is drag→feedback + persistence; Phase 3 is auth/RLS) — the work here is the
**infrastructure** those phases assume but that doesn't exist yet.

---

## Architecture Insights

- **The root is the natural isolation boundary.** Because every table cascades from
  `plans.id` and the schema uses composite `(plan_id, x_id)` FKs throughout, "own a
  plan" gives free, total isolation with a one-line teardown. The project already
  discovered this (bare-plan suites); the task is to make it the default, not the
  exception.
- **Output is computed, not stored-as-fixture.** No solver/batch endpoint exists;
  placements are idempotent single inserts. That is a *feature* for testing: factories
  can drive the real `insertPlacement`/`insertOverride`/`computeAndPersistGroupings`
  so "output" data is produced by the code under test — closing the oracle-independence
  gap the test-plan worries about (Risk #1) instead of widening it.
- **Auth shape dictates the Playwright approach.** Cookie-based `@supabase/ssr` (not
  localStorage) is the single most load-bearing detail for e2e auth setup; getting it
  wrong is the classic Playwright-Supabase failure.
- **`describe.skip` is a silent-coverage trap.** Today the suite "passes" in CI by
  skipping. Once the stack is in CI, consider failing (not skipping) when env is
  expected, so a missing stack is loud rather than invisible.

## Historical Context (from prior changes)

- `context/archive/2026-06-04-port-grouping-algorithm/plan.md` — origin of the
  `service_role` + local-Supabase + `describe.skip` harness; explicitly "never in CI".
- `context/archive/2026-06-01-minimal-domain-schema/plan.md` — "No automated test
  runner is configured (CI = install → astro sync → lint → build)"; placements/groupings
  intentionally unseeded.
- `context/archive/2026-06-11-multi-variant-management/plan.md` — Seed Plan A/B design;
  two copies via fresh-UUID re-runs to surface FK-remapping bugs.
- `context/archive/2026-06-05-first-valid-drop-with-validation/plan.md` — placement
  persistence (POST-new → DELETE-old); "zero `course_groupings` and zero `placements`"
  in the seed.
- `context/archive/2026-06-13-slot-as-a-group/` and `…teacher-availability/` — the
  advanced-data tables; their integration suites are the bare-plan exemplars.
- `context/archive/2026-06-11-students-and-choices-ui/reviews/impl-review.md` (F3) —
  documents the known gap: load-bearing CRUD ordering "covered only by the integration
  suite … CI runs `pnpm test` only."
- `context/foundation/test-plan.md` — the rollout this research serves: Phase 1
  validator/route boundary (`testing-validator-trust-core`, not yet on disk), Phase 2
  drag→feedback + persistence (≤1 e2e, Playwright), Phase 3 auth/RLS. §5 marks
  integration as "required after Phase 1" — i.e. the CI wiring is the missing piece.

## Related Research

- `context/foundation/test-plan.md` — the canonical strategy/risk map this enables.
- `context/foundation/lessons.md` — "Catalog CRUD integration tests belong in the test
  harness"; "Astro Actions are the single transport" (shapes where domain fns live).

## Resolved Decisions (2026-06-15 discussion)

All five open questions were settled in discussion. These are the decisions the plan
must implement.

1. **CI stack — full `supabase start`, aggressively trimmed; measure before caching.**
   Use `supabase start -x studio,imgproxy,inbucket,realtime,storage,vector,analytics,edge-runtime,functions,meta`
   to keep Postgres + PostgREST + Kong (auth/GoTrue boots regardless — it is **not** in
   the excludable container list `[analytics,db,edge-runtime,functions,imgproxy,inbucket,kong,meta,realtime,rest,storage,studio,vector]`, **verified** via `supabase start --help`).
   Today's 8 suites touch **no** GoTrue (all `service_role`, **verified**) so `db`+`rest`+`kong`
   is the live minimum; auth matters only when Phase 3 (RLS) + e2e land — and since it
   always boots, we run **one** stack mode, not two. Eat the cold image pull; treat
   Docker-image caching as a later optimization only if a **measured** CI delta is
   painful. Validate the exact exclusion set + record the timing in Phase 1.
2. **Action-boundary tests — add a thin, representative layer (later phase).** Domain
   functions are covered; the thin Action wrapper (`requireSession` → `requireSupabase`
   → `runDomain` → `DomainError`→`ActionError`) is not (test-plan Risk #3). Add **one
   action-boundary test per "shape"** (one auth-guard assertion, one error-translation
   assertion) — not per-action — invoking the Astro 6 action handler with a constructed
   context, **reusing the existing `astro:env/server` stub** (the integration vitest
   config must gain that stub, which only the unit config has today). Let **Playwright**
   cover the full HTTP `/_actions/*` path for the hot drag→placement action. Not Phase 1.
3. **Parallelism — Vitest full-parallel post-migration; Playwright `workers: 1` in CI
   first.** Once seed-coupled suites move to plan-rooted ownership, Vitest runs fully
   parallel (`test.concurrent`-safe by construction). Playwright starts serial in CI
   (one dev server, local-Supabase connection limits, auth `storageState` races), then
   parallelizes with per-worker auth once stable. **Template-clone per-worker stays
   deferred** — only if measured contention appears.
4. **CI fails (not skips) when the stack is expected.** Gate on `process.env.CI === 'true'`:
   when set and the stack env is missing, **throw in `src/test/load-test-env.ts`** (fail
   the whole run loudly). Absent the flag (local dev without the stack), keep
   `describe.skip` so local DX is unblocked. Kills the silent-zero-coverage trap.
5. **dp2 stays at the integration layer; e2e targets dp1.** The board renders dp1 only
   (`BOARD_COHORT = "dp1"`), so Playwright scenarios place into dp1. Keep dp2 coverage in
   integration suites (where catalog-hash suites already use it). Factories take a
   `cohort` param so we're ready when the dp2 board ships, but no dp2 e2e until then.

## Open Questions

- **Exact CI wall-clock delta of the trimmed `supabase start`** — to be measured in
  Phase 1; only then decide whether image caching is worth the fiddle. (Decision rule
  set above; the number is the only unknown.)
- **Exact Astro 6 action-handler invocation API for tests** — confirm during planning
  of the action-boundary phase (handler call + constructed context shape).
