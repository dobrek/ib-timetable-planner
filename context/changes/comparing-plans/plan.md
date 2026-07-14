# Comparing Plans — Implementation Plan

## Overview

Build an in-app plan-comparison surface: an author picks two or more plans, and the app renders the
existing `analyzePlan` feature vector as a side-by-side scoreboard with baseline-relative deltas, a
rule verdict per plan, and a catalog-drift banner.

This is the deferred **"Option C"** from `plan-quality-analyzer`, whose gating condition (*"until after
the expert session validates which features matter"*) was satisfied by `generation-quality-tuning`. It is
a **UI change, not an engine change** — the compute core is built, pure, and Workers-safe by design for
exactly this reuse.

## Current State Analysis

**What exists and moves verbatim:**

- `analyzePlan` ([src/entities/timetable/model/analysis/analyze-plan.ts:25](src/entities/timetable/model/analysis/analyze-plan.ts#L25)) — a synchronous, side-effect-free fold over eleven lenses. ~50k Map/Set ops per two-cohort board, i.e. low single-digit ms. Zero occurrences of `async`/`Promise`/`process.`/`node:`/`Date.`/`Math.random` across all 15 non-test files and their transitive deps.
- `loadPlanAnalysis` ([bench/load-plan-analysis-input.ts:39](bench/load-plan-analysis-input.ts#L39)) — plan id → `LoadedPlan { id, name, input, snapshot, board, warnings }`. ~15 round trips in 2 waves. Imports only `@/shared/api`, `@/shared/config`, `@/shared/lib/*`, `@/entities/timetable`; takes the Supabase client as a parameter; reads no `process.env`. Verbatim-movable into `src/`.
- `verifyGeneration` ([src/entities/timetable/model/generation/verify.ts:51](src/entities/timetable/model/generation/verify.ts#L51)) — already public via the entity barrel. The loader's `pins: []` snapshot means `verifyGeneration(plan.snapshot, plan.board)` answers *"would the engine have been allowed to ship this board?"* for free.
- **N-plan loading already works**: `Promise.all(ids.map(id => loadPlanAnalysis(supabase, id)))` ([bench/plan-quality.analyze.ts:46](bench/plan-quality.analyze.ts#L46)), and `bench/plan-report.ts:62` renders N plans as N column groups today.

**What does not exist:**

| Missing | Evidence |
|---|---|
| A cross-plan catalog-drift detector | Nothing in the schema records lineage; the one hash that looks right digests UUIDs (see below) |
| A delta layer | `bench/plan-report.ts` has no subtraction, ratio, or ranking anywhere — deliberate (*"It reports; it never judges"*, [:17](bench/plan-report.ts#L17)) |
| A React presenter | `bench/plan-report.ts:285` is `console.log` + `padEnd`. Terminal-only. |
| Name resolution | The analyzer emits opaque `teacherKeys`/`studentKeys`; the CLI prints raw UUIDs ([analysis-run-1.md:187](context/archive/2026-07-12-plan-quality-analyzer/analysis-run-1.md#L187)) |
| A React inline alert/banner | `shared/ui` has `AlertDialog` (a modal) and `Banner.astro` (Astro, unusable in a React island). No `alert.tsx`. |

**The one real trap — the existing hash cannot do this job:**

`computeCatalogHash` ([src/shared/lib/catalog-hash/compute-catalog-hash.ts:13](src/shared/lib/catalog-hash/compute-catalog-hash.ts#L13)) digests `course.id`, `teacherKeys`, `studentKeys` — all **per-plan UUIDs**. `clone_plan` re-mints every one ([supabase/migrations/20260711174905_clone_plan_include_board.sql:41-64](supabase/migrations/20260711174905_clone_plan_include_board.sql#L41)), so **a clone and its own source hash differently**. That is precisely why the clone flow recomputes the hash in JS afterwards ([src/_pages/plans-list/api/clone-plan.ts:45](src/_pages/plans-list/api/clone-plan.ts#L45)).

The hash is not broken — it answers a different question (*has this plan's catalog changed since its groupings were computed?*) and lives on `course_groupings`, not `plans`. Cross-plan equivalence needs a **new natural-key fingerprint**.

## Desired End State

An authenticated author navigates to `/plans/compare?plans=<id>,<id>&baseline=<id>` (reachable from a
**Compare** button in the Plans hub header), picks plans in a `MultiSelect`, and sees:

- A **rule-verdict block** per plan (`oracle-valid: YES/NO · soft-availability warns: N`, plus blocking reasons and catalog warnings).
- A **drift banner** naming what differs from the baseline (*"Catalog differs from baseline: 3 courses added, 1 teacher removed, availability differs"*), with a louder tier when `slot_grid_preset` differs.
- **Five scoreboard sections** at full parity with `bench/plan-report.ts` — cohort scoreboard, golden slots, board-wide, cross-cohort weave, plus mirrored cells and the time-of-day gradient — each in a **frozen-pane** container (sticky header row, sticky metric-label column, bounded height).
- **Baseline-relative deltas** on every numeric metric.
- **Worst teacher / worst student rendered as names**, not UUIDs.

**Verification:** `pnpm test` (unit), `pnpm test:integration` (loader), `pnpm test:e2e` (clone → identical
pair renders no drift banner; mutate one → banner names the drift), `pnpm check` (the type gate — `pnpm lint`
and `pnpm build` are esbuild-based and go green over type errors), `pnpm lint`, `pnpm steiger`, `pnpm build`.

### Key Discoveries

- **The analyzer was built for this and the constraint held.** Its docblock states the intent: *"Pure and Workers-safe like the rest of the entity core, so a future in-app surface reuses it verbatim."* Workers-safety was a CI-enforced success criterion and it survived. The expensive part of this feature is pre-paid.
- **`GroupingCourse` must not be widened.** It is referenced in ~130 places across the domain core (collision, generation engine, verify, export, perspective, drop-hints) with ~10 fixture builders constructing literals. The codebase has an explicit, five-times-repeated convention: anything that is not a slot-compatibility constraint input stays **off** `GroupingCourse`, as a side-set — *"never a `GroupingCourse` field, to keep the catalog hash stable"* ([catalog-hash/types.ts:41](src/shared/lib/catalog-hash/types.ts#L41), [collision/constraints/types.ts:58](src/entities/timetable/model/collision/constraints/types.ts#L58), [generation/types.ts:32](src/entities/timetable/model/generation/types.ts#L32), [courses/model/schemas.ts:48](src/_pages/courses/model/schemas.ts#L48), [analysis/types.ts:11](src/entities/timetable/model/analysis/types.ts#L11)). `AnalyzerCourse = GroupingCourse & { name, level, groupIndex }` is already that pattern.
- **`CohortCatalog` is safe to widen additively.** Only 4 type references exist (its definition, its re-export, and two annotations in `loadCohortCourses`), and **nothing outside `loadCohortCourses` constructs one** — every call site destructures structurally. Adding a field is a zero-break change.
- **`CourseDisplay` is NOT safe to widen.** ~40 files consume it and ~15 test files construct object literals of it. Adding a required field breaks all of them.
- **Only *one* of the four `courses` re-queries is actually redundant.** `loadCohortCourses` already selects `name, level, group_index` ([load-cohort-courses.ts:135](src/shared/api/load-cohort-courses.ts#L135)) and discards them into a composite display name ([:195-200](src/shared/api/load-cohort-courses.ts#L195)), and four call sites re-query the same columns. But `catalog.courses` is a **filtered** projection ([:72-74](src/shared/api/load-cohort-courses.ts#L72) drops courses with no direct students and no enrolled dependent; merge parents become virtual), so it is a strict subset of the `courses` table. Only `bench/load-plan-analysis-input.ts:106` can be collapsed — the analyzer consumes exactly `catalog.courses`. The three app loaders (`plan-detail`'s `fetchCourseLevels`, both plan-views' `fetchCourseInfo`) deliberately need **every** row, merge children included ([course-info.ts:3-6](src/widgets/timetable-board/model/course-info.ts#L3)); they stay. See *What We're NOT Doing*.
- **The research doc is wrong about steiger.** It claims both prior view slices needed an `fsd/insignificant-slice` override. Git history (`git log -p -- steiger.config.ts`) shows the overrides were for `entities/timetable/**` (added `0afb9d0`, removed `32ce202`) and `widgets/timetable-board/**` (added `fc09aa8`, removed `2c2bf02`) — the *entity* and *widget* extractions. **No page-slice override ever existed**, because `_pages` slices are referenced by their Astro routes. `steiger.config.ts` is currently clean and should stay that way.
- **Auth is a non-issue.** No `author_id`/`owner` column exists anywhere and no policy references `auth.uid()` — every policy is `for all to authenticated using (true)`. Any authenticated user reads every plan; the picker needs no ownership filter. Middleware auto-gates the new route (deny-by-default, no allowlist change).
- **`_pages` slices import `entities` only through the public barrel.** Grep confirms zero deep imports into `@/entities/timetable/*` anywhere in `src/` or `bench/`. FSD `no-public-api-sidestep` is clean and must stay clean — which is exactly why the barrel must be widened rather than sidestepped.
- **E2E has no DB access today.** All 20 specs build their data through the UI; the only non-UI provisioning is the auth user (`scripts/provision-e2e-author.mjs`, run by `pretest:e2e`). `supabase/seed.sql` is a **generated artifact** that CI regenerates before boot, and it emits exactly two catalog-identical plans — so it cannot supply a drifted pair, and hand-editing it would be overwritten.

## What We're NOT Doing

- **No composite score, no ranking, no "Plan A wins".** Deltas per metric, yes. A verdict, no. This is a hard architectural stance with scar tissue behind it: the weighted-scalar objective had a tier-bleed bug in `generation-engine-hardening`.
- **No metric partitioning or per-row dimming on drift.** The banner is the guard (decision below). The severity tiers are encoded in the *model* so a later iteration can dim untrustworthy rows without a re-architecture, but v1 renders every row.
- **No blocking on grid mismatch.** Render everything, banner loudly.
- **No charting library.** None is installed (no recharts/d3/visx/nivo), a scoreboard table needs none, and adding one is a new dependency decision (audit gate + 10 MB script budget).
- **No `Tabs` shell.** Full bench parity means all five sections render on one page.
- **No web worker.** `analyzePlan` is a ~3 ms pure fold. The Web Worker seat ([generate.worker.ts:20](src/_pages/plan-detail/model/generation/generate.worker.ts#L20)) is correct for a 20 s solve and wrong here.
- **No per-student / per-teacher drill-down.** Aggregate metrics only, so only the extremes need name resolution.
- **No lineage column on `plans`.** Nothing records that plan B was cloned from plan A. The fingerprint answers "same catalog?" by content, which is what we need; lineage is a different feature.
- **No `bench/` copy of the loader.** Single source of truth — `bench/` re-points and its copy is deleted.
- **No deletion of the app's three redundant `courses` queries** (`plan-detail`'s `fetchCourseLevels`, both
  plan-views' `fetchCourseInfo`). They *look* redundant against `loadCohortCourses`, but they are not:
  `catalog.courses` is a filtered grouping projection that omits merge children with no direct choices,
  which those three surfaces still render and export. Replacing them with `courseIdentity` would regress
  board, teacher view, and student view to UUID card titles and empty export levels. Deleting them
  correctly means keying an identity map over the **full** `courses` row set and widening `CourseNaturalKey`
  with `cohort` + `hoursPerWeek` — a change to three shipped read surfaces that buys this feature nothing.
  **Follow-up change**, not this one. (Phase 2 *does* collapse the *bench* loader's own second `courses`
  query — that one is a genuine drop-in, because the analyzer only ever sees `catalog.courses`.)
- **No PRD/roadmap amendment in this change.** Plan comparison has zero hits in `context/foundation/prd.md` and `roadmap.md` — it is author/expert tooling that grew out of the generation-quality work. Note it as a follow-up, don't gate on it.

## Implementation Approach

Follow the **read-only view precedent** (`teacher-plan-view` / `student-plan-view`), not the editing-board
precedent. One SSR load in the Astro frontmatter, everything plain-serializable across the island
boundary, no `Map`s in props, and the island rebuilds indexes by calling pure `entities/timetable`
functions at render time.

Six phases, ordered so each is independently verifiable:

1. **Enable** — widen two types so the rest of the work is legal. Purely additive.
2. **Loader** — promote it, extend it, re-point `bench/` at it.
3. **Drift model** — the one genuinely new mechanism, pure and unit-tested in isolation.
4. **Scoreboard model** — port the bench's metric catalogs into typed, delta-aware data. Pure.
5. **UI** — route, island, tables, banner, picker. All presentation over data that is already tested.
6. **Verify** — E2E through the clone flow + the full CI gate.

**Model for N, ship for 2–4.** State is `{ baselineId, planIds[] }` and the loader is typed
`plans: LoadedPlan[]` from day one. `analyzePlan` has zero pairwise coupling, cost is linear and fully
parallel (~15 round trips per plan, no shared state ⇒ wall-clock ≈ one plan's latency), and the Workers
subrequest cap (1000/invocation on paid) stays safe past N ≈ 60. The scoreboard is per-cohort, so N plans
= 2N columns; the picker defaults to 2 and the frozen-pane containers handle the overflow.

## Critical Implementation Details

**Sticky headers do not work inside the DS `Table` without a bounded height.** `Table`
([src/shared/ui/table.tsx:5](src/shared/ui/table.tsx#L5)) wraps itself in a `div.overflow-x-auto`. Per the
CSS overflow spec, a non-`visible` value on one axis computes the other to `auto` — so that div is
**already a scroll container in both axes**, it simply has no height constraint and therefore never
scrolls vertically. A naive `sticky top-0` on `<TableHead>` would resolve against that div, not the
viewport, and would **silently fail to stick** — looking correct in a short table and breaking in exactly
the long one being built here. The container must get an explicit `max-h-… overflow-y-auto` for sticky to
engage. Sticky cells also need an explicit background (`bg-background`) and `z-index`, or rows show
through them.

**Two rendering invariants are load-bearing and must survive the port to React.** They are not style
preferences; each encodes a bug that shipped:
1. **A slot count never renders without that cohort's unplaced hours beside it.** *"An incomplete board trivially uses fewer slots, which is exactly how the engine's 5 abandoned hours once read as a 'better' slot count."* The bench enforces this with post-table annotation loops ([plan-report.ts:97-115](bench/plan-report.ts#L97)); the React version must render the same annotations beneath each table.
2. **`emptyDays` renders beside the day-edge metrics.** A wholly empty day dumps every period into `freeSlotsAtDayStart` (impl-review F8). Preserved by porting the bench's row order — `— of which EMPTY days` sits directly under `Free at day START` / `Free at day END`.

Catalog `warnings` are part of the product, not diagnostics: a `zero-hours` course reads as "complete"
(impl-review F4). Render them beside the numbers.

**Name resolution rides the fingerprint's data, not a second wave.** The fingerprint needs teacher `code`
and student `full_name` (the natural keys) for every teacher and student in the plan. The loader therefore
already holds full id→name maps — so the extremes' names are free. Load full maps server-side, ship only
the extremes' names to the island.

---

## Phase 1: Enable

### Overview

Widen two types so the UI can name its props and the fingerprint can see natural keys.

### Changes Required:

#### 1. Widen the analysis barrel

**File**: `src/entities/timetable/model/analysis/index.ts`

**Intent**: `GoldenCell` and `GoldenCensusFeatures` are not exported from *either* barrel today, so a
component cannot type a golden-census prop at all. Export them from the analysis segment barrel.

**Contract**: add `GoldenCell` and `GoldenCensusFeatures` to the existing type re-exports. Named exports
only — no `export *`.

#### 2. Widen the entity barrel

**File**: `src/entities/timetable/index.ts`

**Intent**: The barrel exports only six symbols ([:33-40](src/entities/timetable/index.ts#L33)), so any
component typing a prop as `CohortFeatures` cannot compile. `bench/plan-report.ts:154` works around this
with an indexed-access type. Widen it — **consciously**: the narrowing was a deliberate impl-review fix
(F7, [impl-review.md:94](context/archive/2026-07-12-plan-quality-analyzer/reviews/impl-review.md#L94)), so
this is a reversal, not an oversight being quietly undone.

**Contract**: add exactly the types the scoreboard names as props, as named exports:
`CohortFeatures`, `TeacherFeatures`, `CrossCohortFeatures`, `SubjectRollup`, `Extreme`, `ThinSlot`,
`MirroredCell`, `DayEdgeProfile`, `GoldenCell`, `GoldenCensusFeatures`. Do **not** convert to `export *`.
Add a docblock line recording that F7's narrowing is being widened for the in-app comparison surface.

#### 3. Add the course-identity side-set to `CohortCatalog`

**File**: `src/shared/lib/catalog-hash/types.ts`

**Intent**: The analyzer needs `(name, level, groupIndex)` per course and the fingerprint needs it as a
natural key, but `loadCohortCourses` currently folds all three into a composite display string and throws
the raw values away. Surface them as a **side-set map** — following the codebase's own five-times-stated
rule that non-constraint data never becomes a `GroupingCourse` field, so the catalog hash and grouping
staleness are unaffected.

**Contract**: new type `CourseNaturalKey = { name: string; level: string; groupIndex: number }`, and a new
required field on `CohortCatalog`.

**Named `CourseNaturalKey`, not `CourseIdentity`** — `bench/fixture-courses.ts:20` *already* exports a
`CourseIdentity` (`{ id, cohort, name, level, groupIndex }`, used by `generation.experiment.ts` and
`fixture-courses.test.ts`) for the same concept at a different shape. After Phase 2 re-points `bench/` at
this slice, both would be in scope in the same files. Cross-reference the two in the docblock rather than
shadowing.

```ts
/** Raw course identity, the cross-plan natural key `(cohort, name, level, group_index)`.
 *  A side-set (never a `GroupingCourse` field), so the catalog hash is unaffected.
 *  Distinct from `bench/fixture-courses.ts`'s `CourseIdentity`, which also carries the plan-local id. */
courseIdentity: Map<string, CourseNaturalKey>;
```

Export both from `src/shared/lib/catalog-hash/index.ts`. Safe: `CohortCatalog` has only 4 type references
and nothing outside `loadCohortCourses` constructs one.

#### 4. Populate the side-set

**File**: `src/shared/api/load-cohort-courses.ts`

**Intent**: The `courseRows` query already selects `name, level, group_index` ([:135](src/shared/api/load-cohort-courses.ts#L135))
and `courseById` already holds them — they are simply discarded at function exit. Build the identity map
from data already in memory. **No new query, no wider select.**

**Contract**: `CohortCatalog.courseIdentity` populated for **every course id in `courses`** — the
grouping projection, which is what the analyzer and the fingerprint consume — including the virtual
merge-parent courses built at [:84](src/shared/api/load-cohort-courses.ts#L84), whose identity comes from
the merge parent's own row (it is always present; `loadCohortCourses` throws otherwise, [:87](src/shared/api/load-cohort-courses.ts#L87)).
`compositeName` and `courseDisplay` are unchanged — `adapter-parity.integration.test.ts:52-56` re-keys on
the composite name and must keep passing.

**Do NOT key it over the full `courseRows` set, and do NOT use it to replace the app's `courses`
queries.** `catalog.courses` is a *filtered* projection: [:72-74](src/shared/api/load-cohort-courses.ts#L72)
drops every course with no direct students and no enrolled overlap-dependent, and replaces merge parents
with virtual ones — so **a merge child with no direct choices is absent from it**. The three app loaders'
`courses` queries exist precisely to cover that gap: `CourseInfo`'s contract is *"Raw badge/display fields
for EVERY course row in the plan — including merge children absent from the grouping catalog (no direct
choices), which the course list still renders"* ([course-info.ts:3-6](src/widgets/timetable-board/model/course-info.ts#L3)).
Feeding them `courseIdentity` would render those cards' titles as **raw UUIDs**
([PerspectiveCourseList.tsx:73](src/widgets/timetable-board/ui/PerspectiveCourseList.tsx#L73) falls back to
`{ name: item.courseId }`) and export their level as `""`
([perspective-workbook.ts:101](src/_pages/plan-detail/model/perspective-workbook.ts#L101)) — the exact
UUIDs-where-names-belong failure this whole change exists to remove. See *What We're NOT Doing*.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- `adapter-parity.integration.test.ts` still passes (the composite-name key is untouched): `pnpm test:integration`
- The catalog-hash golden digest test still passes — proving `GroupingCourse` and the hash are unchanged: `pnpm test`
- **Type check passes: `pnpm check`** (`astro check` — the only real type gate; `pnpm lint`/`pnpm build` are esbuild-based and go green over type errors). Lint passes: `pnpm lint`
- FSD structure clean, **with no new override in `steiger.config.ts`**: `pnpm steiger`
- Build clean: `pnpm build`

#### Manual Verification:

- None — this phase is additive: two barrels widened, one new field on `CohortCatalog`. No existing loader,
  query, or render path changes.

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Loader

### Overview

Promote `loadPlanAnalysis` into the new slice, extend it with the natural-key data the fingerprint and
name resolution need, and make `bench/` consume it so there is exactly one loader.

### Changes Required:

#### 1. Create the slice

**File**: `src/_pages/plan-comparison/index.ts`

**Intent**: New FSD page slice. Follow the `plans-list` precedent — the root barrel exists to satisfy
steiger's public-API rule; the Astro route imports the island by direct path and the loader from the `api`
segment barrel.

**Contract**: slice root barrel. Expect **no** `steiger.config.ts` change — `_pages` slices are referenced
by their Astro routes and no page-slice override has ever been needed. If `pnpm steiger` warns anyway,
apply the precedented scoped `fsd/insignificant-slice: "off"` block with a comment naming the phase that
removes it.

#### 2. Promote the loader

**File**: `src/_pages/plan-comparison/api/load-plan-analysis.ts` (moved from `bench/load-plan-analysis-input.ts`)

**Intent**: Move it. It cannot live in `shared/` (it imports `PlanAnalysisInput` from `entities`, and
`shared` may not import upward) and `entities/timetable` is deliberately IO-free — spending that purity
here would be a bad trade, since it is what makes the whole analysis core Workers-safe. A page slice's
`api/` segment is the natural home.

**Contract**: `loadPlanAnalysis(supabase: SupabaseClient, planId: string): Promise<LoadedPlan>` — signature
unchanged. The caller supplies the client, so the bench keeps its service-role client and the app passes
the request-scoped one. Every table it reads is already read by the authenticated app client via
[plan-detail/api/load.ts:57](src/_pages/plan-detail/api/load.ts#L57) — **no new RLS or grant surface.**

Collapse `loadCohortAnalysis` ([bench/load-plan-analysis-input.ts:95-134](bench/load-plan-analysis-input.ts#L95))
now that Phase 1 landed: the second `courses` query, the `subjectById` map, and the throw at `:121` all go
away — `AnalyzerCourse` is built by joining `catalog.courses` with `catalog.courseIdentity`.

#### 3. Extend `LoadedPlan` with natural keys

**File**: `src/_pages/plan-comparison/api/load-plan-analysis.ts`

**Intent**: The fingerprint keys on `teacher.code` and `student.full_name`, neither of which the analyzer
input carries (it speaks in UUIDs). Load both id→natural-key maps. They double as the name-resolution
source for the scoreboard's extremes, so this costs one wave, not two.

**Contract**: `LoadedPlan` gains a `naturalKeys` field carrying, at minimum:
- teachers: id → `{ code, fullName }` — reuse `loadPlanTeachers` ([src/shared/api/load-plan-teachers.ts:13](src/shared/api/load-plan-teachers.ts#L13)), which already returns exactly this.
- students: id → `full_name` — a new `students` select scoped by `plan_id`.

Both are cheap and join the existing first wave. **Note the weak key**: `students.full_name` has no unique
constraint (only `teachers_plan_code_unique (plan_id, code)` and `courses_unique (plan_id, cohort, name,
level, group_index)` exist). Two same-named students collide. Acceptable for the fingerprint (which
compares sorted multisets) and for aggregate metrics; document it as a known limitation.

#### 4. Re-point `bench/`

**Files**: `bench/plan-quality.analyze.ts`, `bench/generation.bench.ts`, `bench/load-plan-analysis-input.ts` (deleted)

**Intent**: A duplicated ~15-query loader will drift silently, and drift here means the CLI and the UI
disagree about what a plan *is* — while the CLI is precisely the tool used to validate the UI's numbers.
Single source of truth.

**Contract**: `bench/` imports `loadPlanAnalysis` from `@/_pages/plan-comparison/api` — **the `api` segment
barrel, never the slice root**; the bench copy is deleted.

This is a **new dependency direction**, not an existing one. `bench/` sits outside the FSD graph and today
imports only `@/shared/*` and `@/entities/timetable` — it has never imported `src/_pages/**`, and *nothing
enforces the boundary*: steiger lints `src/` only, and the flat ESLint config has no `no-restricted-imports`
or boundaries rule. So the guardrail has to be checked, not merely stated. The concrete hazard: the slice
root barrel (item 1) re-exports `ui/`, so a bench import of the slice **root** would drag React and
Astro-adjacent modules into `pnpm analyze:plans` — a Vitest **node** run.

Enforce it three ways: (a) bench imports only `@/_pages/plan-comparison/api`; (b) that `api` segment barrel
transitively reaches **no** `ui/` module (verify by inspecting its import graph, not by assumption);
(c) add an ESLint `no-restricted-imports` rule scoped to `bench/**` that permits `@/_pages/plan-comparison/api`
and forbids every other `@/_pages/*` path, so the next author cannot widen this silently.

Confirm the analyzer still runs against the local stack and
produces byte-identical output to before the move. **It is not a script** — it is a Vitest suite
(`vitest.analyze.config.ts`, include `bench/**/*.analyze.ts`) that takes its plan ids from **env vars**,
not argv:

```bash
ANALYZE_PLAN_A=<plan-id> [ANALYZE_PLAN_B=<plan-id>] pnpm analyze:plans
# needs the local Supabase stack up, and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.test.local
```

#### 5. Integration test

**File**: `src/_pages/plan-comparison/api/plan-comparison.integration.test.ts`

**Intent**: The loader is the only part of this feature with real failure modes (~15 round trips, two
waves, a widened catalog, two consumers). Test it against the real stack.

**Contract**: follow `teacher-plan-view/api/teacher-plan-view.integration.test.ts`. Build state through
`src/test/factories/` (`createPlan`, `seedPlanCatalog`, `addAvailability`, `placeCourse`) and clean up via
`teardown` in `afterAll` — **never assert against raw seed rows**; `src/test/no-seed-coupling.test.ts`
fails any `Seed Plan [AB]` reference in an integration test. Assert: `input` shape is well-formed;
`naturalKeys` resolves; `warnings` surface catalog anomalies; `verifyGeneration(snapshot, board)` returns
a verdict.

### Success Criteria:

#### Automated Verification:

- Loader integration test passes: `pnpm test:integration`
- The bench analyzer still runs and its output is unchanged: `ANALYZE_PLAN_A=<plan-id> pnpm analyze:plans` (local stack up; `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env.test.local`)
- `bench/load-plan-analysis-input.ts` no longer exists and nothing imports it: `grep -r "load-plan-analysis-input" .`
- **The bench→slice boundary holds**: `bench/` imports only `@/_pages/plan-comparison/api` (no slice-root, no other `_pages` path), that segment barrel transitively pulls in no `ui/` module, and the `bench/**` ESLint `no-restricted-imports` rule fails a deliberate violation: `pnpm lint`
- Type check + lint + steiger + build clean: `pnpm check && pnpm lint && pnpm steiger && pnpm build`

#### Manual Verification:

- Run the bench analyzer against a real plan and eyeball the output against a pre-move capture — the numbers must be identical.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Drift model

### Overview

The one genuinely new mechanism: a content-addressed fingerprint over natural keys, a **structured** diff
(not a boolean), and the three severity tiers. All pure, all unit-tested.

### Changes Required:

#### 1. The natural-key fingerprint

**File**: `src/_pages/plan-comparison/model/catalog-fingerprint.ts`

**Intent**: Answer "do these two plans share a catalog?" — which the existing `computeCatalogHash`
structurally cannot, because it digests UUIDs that `clone_plan` re-mints. Content-address the catalog over
natural keys instead.

Lives in the slice's `model/`, not `shared/lib/catalog-hash/`, because it has exactly one consumer today
(FSD: don't promote until a second appears) and because two hashes in one folder answering *different*
questions would invite exactly the confusion this whole trap is made of.

**Contract**: `computeCatalogFingerprint(plan: LoadedPlan): Promise<string>` — async, because
`crypto.subtle.digest` is. Mirror `computeCatalogHash`'s proven edge-safe shape exactly
([compute-catalog-hash.ts:13](src/shared/lib/catalog-hash/compute-catalog-hash.ts#L13)): an explicit
field-by-field allow-list projection (never raw `JSON.stringify` of a domain object), array fields
copied-then-`.sort()` with **default code-point compare** (deliberately not `localeCompare` — the existing
golden-digest test locks this), a hand-written comparator for the outer sort, then
`TextEncoder` → SHA-256 → lowercase zero-padded hex.

The projection, per research §4:

```
courses:      sorted (cohort, name, level, group_index, hours, week_mode)
teachers:     sorted (code)
students:     sorted (full_name)
choices:      sorted (student_full_name, course natural key)
availability: sorted (teacher_code, day, period, severity)
grid:         (days, periods)
```

#### 2. The structured diff

**File**: `src/_pages/plan-comparison/model/catalog-diff.ts`

**Intent**: The banner is the sole guard against misreading a drifted comparison (see the scope decisions),
so it must name *what* drifted. A boolean tells the reader something is wrong but not whether it is one
renamed course (harmless) or a different student body (fatal) — and with render-everything-and-let-the-
expert-judge, that distinction is the entire product.

**Contract**: `diffCatalogs(baseline: LoadedPlan, other: LoadedPlan): CatalogDiff` — pure, synchronous
(the fingerprint is the fast path; the diff runs only when fingerprints differ). Per-category
added/removed/changed counts over the six projections above, plus the grid comparison. Shape it so the
banner can render *"3 courses added, 1 teacher removed, availability differs"* without further derivation.

#### 3. The severity tiers

**File**: `src/_pages/plan-comparison/model/drift-tier.ts`

**Intent**: Encode the taxonomy in the model even though v1's UI only renders a banner. The information is
nearly free once the fingerprint and diff exist, and it lets a later iteration dim the untrustworthy rows
without a re-architecture.

**Contract**: `driftTier(diff: CatalogDiff): "clean" | "catalog-drift" | "incomparable"` —

| Tier | Condition | Meaning |
|---|---|---|
| `incomparable` | `slot_grid_preset` differs | `days`/`periods` differ ⇒ board-shape, day-edge, slot-census and week-symmetry metrics are meaningless |
| `catalog-drift` | course/teacher/student/choice/availability sets differ | Catalog-*dependent* metrics (completeness, students, slot census, teachers, subjects) are apples-to-oranges; catalog-*independent* ones (board shape, daily load, week symmetry, adjacency, spread) survive — they fold over placements + grid only |
| `clean` | fingerprints equal | Full comparison valid. This is the `clone_plan(source, name, include_board=false)` → generate flow the analyzer was validated on |

### Success Criteria:

#### Automated Verification:

- Fingerprint unit tests pass: order-insensitivity, a **fixed golden digest** (locking code-point sort, mirroring `compute-catalog-hash.test.ts`), and sensitivity to each of the six projection categories: `pnpm test`
- **The load-bearing test**: a plan and its `clone_plan` copy produce an **equal** fingerprint (they differ in every UUID) while producing **different** `computeCatalogHash` values. This is the whole reason the module exists: `pnpm test:integration`
- Diff unit tests pass — each category's added/removed/changed is exercised: `pnpm test`
- Tier unit tests pass — grid mismatch outranks catalog drift: `pnpm test`
- Type check + lint + steiger + build clean: `pnpm check && pnpm lint && pnpm steiger && pnpm build`

#### Manual Verification:

- None — this phase is pure and fully covered by tests.

---

## Phase 4: Scoreboard model

### Overview

Port `bench/plan-report.ts`'s five declarative metric catalogs into typed, delta-aware data. Pure, no JSX.

### Changes Required:

#### 1. The metric catalog

**File**: `src/_pages/plan-comparison/model/metric-catalog.ts`

**Intent**: `bench/plan-report.ts`'s console renderer is not reusable as code, but it **is a ready-made
spec**. Its declarative `rows: [label, fn][]` arrays encode exactly which metrics matter, in what order,
with what labels — validated against the expert board in analyzer run #1. Port the catalogs; leave the
`console.log` behind.

**Contract**: five exported catalogs matching the bench's sections and row order exactly:

| Section | Rows | Columns | Bench source |
|---|---|---|---|
| Cohort scoreboard | 18 | plan × cohort | [plan-report.ts:65-90](bench/plan-report.ts#L65) |
| Golden slots | 6 | plan × cohort | [:133-146](bench/plan-report.ts#L133) |
| Board-wide | 12 | plan | [:159-178](bench/plan-report.ts#L159) |
| Cross-cohort weave | 6 | plan | [:200-217](bench/plan-report.ts#L200) |
| Distributions / mirrored cells / gradient | free-form | plan | [:184-195](bench/plan-report.ts#L184), [:225-232](bench/plan-report.ts#L225), [:235-241](bench/plan-report.ts#L235) |

Each row is a typed `MetricRow`, not a tuple — it must carry a **`kind`** discriminating numeric rows
(which get a delta) from text rows (which do not: `extreme` yields `"Kowalski: 42"`, and several
cross-cohort rows are ratios like `"12 / 17"`). Two labels in the golden section are **dynamic** — the
band label `P{first}–P{last}` and the near-golden threshold `≤{pct(missShare)} missing` are read off the
baseline's `goldenCensus` ([:128](bench/plan-report.ts#L128)); model the label as a function of the
baseline, not a constant.

#### 2. The formatters

**File**: `src/_pages/plan-comparison/model/format.ts`

**Intent**: The bench's pure formatters lift straight across; they are currently module-private and
unexported.

**Contract**: `num` (integer as-is, else 2dp), `pct` (`Math.round(share * 100)` + `%`), `extreme`
(`null` → `"—"`, else `` `${key}: ${value}` ``), `distributionLine`, and `pooledMean` — which pools cohort
**samples** rather than averaging means ([:248](bench/plan-report.ts#L248)); that distinction is load-bearing
and must not be "simplified" in the port.

#### 3. Baseline-relative deltas

**File**: `src/_pages/plan-comparison/model/deltas.ts`

**Intent**: With two plans a delta column is unambiguous; with N, the natural generalization is one plan
designated the reference (the golden/expert plan, in the motivating use case) and N−1 comparand columns
rendered as delta-vs-baseline.

**Contract**: `computeDeltas(rows: MetricRow[], plans: Report[], baselineId: string): ScoreboardData` —
pure. Delta applies only to `kind: "number"` rows. **No ranking, no composite, no "better/worse" verdict**
— a signed delta and nothing more. Direction is not judged: fewer teacher gaps is better, but the model
must not say so.

#### 4. Name resolution + the invariant annotations

**File**: `src/_pages/plan-comparison/model/annotations.ts`

**Intent**: Carry the two load-bearing rendering invariants across as **data**, so the UI cannot forget
them, and resolve the extremes' opaque keys to names.

**Contract**:
- `resolveExtremes(features, naturalKeys)` — join `Extreme.key` (a teacher/student id) to a display name via the `naturalKeys` maps the loader already holds. Worst teacher, worst student, soft-hit teachers.
- `completenessAnnotations(plans)` — port the bench's post-table loops ([:97-115](bench/plan-report.ts#L97)): `! <plan> <cohort> is INCOMPLETE — its slot count is flattered: <Course> −Nh` and `~ <plan> <cohort> carries hours beyond the catalog's requirement`. The UI renders these beneath the cohort table; **a slot count must never appear without them.**
- Catalog `warnings` pass through to the verdict block, not swallowed.

### Success Criteria:

#### Automated Verification:

- Formatter unit tests pass, including `pooledMean` pooling **samples** not means: `pnpm test`
- Metric-catalog tests: every row resolves against a fixture `PlanQualityFeatures` without throwing; row count and order match the bench per section: `pnpm test`
- Delta tests: numeric rows get a signed delta; text rows get none; baseline's own delta column is absent/zero: `pnpm test`
- **Invariant test**: an incomplete cohort produces a completeness annotation — i.e. it is impossible to build scoreboard data with a slot count and no completeness beside it: `pnpm test`
- Extremes resolve to names, not UUIDs: `pnpm test`
- Type check + lint + steiger + build clean: `pnpm check && pnpm lint && pnpm steiger && pnpm build`

#### Manual Verification:

- None — pure model, fully covered.

---

## Phase 5: UI

### Overview

Route, SSR frontmatter, island, five frozen-pane tables, drift banner, verdict block, picker, hub entry.
All presentation over data that Phases 3–4 already tested.

### Changes Required:

#### 1. The route

**File**: `src/pages/plans/compare.astro`

**Intent**: A plans-level route, not the archived `/plans/[id]/compare/[otherId]` sketch — that nested it
under a single plan, which reads as "plan A's comparison page" and doesn't generalize to N. A symmetric,
shareable, bookmarkable, N-ready URL.

**Contract**: `/plans/compare?plans=<id>,<id>[,<id>…]&baseline=<id>`. Selection lives in the URL and is
read **server-side** from `Astro.url.searchParams` — it selects the SSR dataset, so it must be read before
the loader runs. This is the `plans/[id]/index.astro:14` precedent (`boardSurfaceSchema.parse(Astro.url.searchParams.get("focus"))`),
not the client-side `useUrlSyncedFilters` one. Put the codec in `lib/` (not `model/`), because an Astro
route imports it — same reason `board-surface.ts` lives in `plan-detail/lib/`.

Frontmatter: `createClient` → parse/validate ids (`isPlanId`) → load each plan → `analyzePlan` ×N →
`verifyGeneration` ×N → fingerprint + diff + tier → build scoreboard data. **No redirects**: set
`Astro.response.status` and render `PlanScopedError` or an inline unavailable message. Middleware
auto-gates the route; no allowlist change.

**Per-plan error isolation — `Promise.all` is wrong here.** The plan-view precedent survives a bad id
because `loadTeacherPlanView` returns a **Result**, which the route branches on
([\[teacherId\].astro:22](src/pages/plans/[id]/teachers/[teacherId].astro#L22):
`result.error.kind === "not-found" ? 404 : 503`). `loadPlanAnalysis` does **not** — it throws
`DomainError`, and Phase 2 pins its signature unchanged. An uncaught throw in Astro frontmatter is a **500**,
and `Promise.all` is all-or-nothing: one deleted plan id would take down the whole page, *including the
plans that loaded fine*. This URL is explicitly designed to be shareable and bookmarkable, and plans are
deletable — a stale link is the ordinary case, not an edge case.

Wrap each load individually (`Promise.allSettled`, or a thin Result-returning wrapper over
`loadPlanAnalysis` in the slice's `api/` — the wrapper keeps the loader's signature intact for `bench/`).
Then:
- **≥1 plan resolved** → render the comparison over the plans that loaded, and name the ones that did not
  ("Plan *X* could not be loaded"). Do not 404 a page that has something to show.
- **0 plans resolved** → 404 + `PlanScopedError`.
- **No Supabase client** → 503 + the inline unavailable message.
- **The designated baseline failed to load** → fall back to the first plan that did, and say so. Deltas are
  baseline-relative, so a silently-missing baseline would render an entire scoreboard of meaningless numbers.

#### 2. The params codec

**File**: `src/_pages/plan-comparison/lib/compare-params.ts`

**Intent**: Pure, testable parsing of the query string into `{ planIds: string[], baselineId: string }`.

**Contract**: `readCompareParams(search: string)` / `toCompareSearch(state)`, mirroring the
`readFilterParams` / `toFilterSearch` convention ([teachers/model/filter-params.ts:17-35](src/_pages/teachers/model/filter-params.ts#L17)).
Baseline defaults to the first picked plan. Drop malformed ids. Omit defaults so a clean state yields a
clean URL. Zero plans → render the picker with an empty state, not an error.

#### 3. The island

**File**: `src/_pages/plan-comparison/ui/PlanComparisonPage.tsx`

**Intent**: The presenter. Takes one plain-serializable `data` prop — no `Map`s cross the island boundary
([teacher-plan-view/api/loader.ts:64](src/_pages/teacher-plan-view/api/loader.ts#L64)).

**Contract**: `type Props = { data: PlanComparisonData }`, mounted `client:load`. Renders, in order:
picker → drift banner → verdict block → the five sections.

#### 4. The frozen-pane table

**File**: `src/_pages/plan-comparison/ui/ScoreboardTable.tsx`

**Intent**: One reusable section table. **See "Critical Implementation Details"** — the sticky header does
not work without a bounded container, and it fails *silently*.

**Contract**: bounded scroll box (`max-h-… overflow-auto`) wrapping the DS `Table`, with:
- `<TableHead>` cells `sticky top-0` + `bg-background` + `z-index`
- the first column (metric label) `sticky left-0` + `bg-background` — with 2N columns, losing the row label to horizontal scroll is as bad as losing the plan name to vertical scroll
- numeric cells explicitly `text-right` (`TableCell` defaults to `text-left`), reproducing the bench's `padStart` alignment
- height sized so short sections (golden census = 6 rows, cross-cohort = 6 rows) never scroll at all — only the 18-row cohort scoreboard should show a scrollbar

Each of the five sections gets its own instance: they have **different column sets** (cohort tables are
plan×cohort, board-wide and cross-cohort are plan-only), so a single global frozen header is structurally
impossible.

#### 5. The drift banner

**File**: `src/_pages/plan-comparison/ui/DriftBanner.tsx`

**Intent**: The **sole** guard against misreading a drifted or grid-mismatched comparison. Not decorative.

**Contract**: renders the structured diff by name — *"Catalog differs from baseline: 3 courses added, 1
teacher removed, availability differs"* — with a visually louder treatment for the `incomparable` tier
(grid mismatch), whose copy must say plainly that board-shape, day-edge, slot-census and week-symmetry
metrics are not comparable. Nothing renders for `clean`.

Slice-local, not `shared/ui`: there is no React `Alert` component (only `AlertDialog`, a modal, and
`Banner.astro`, which cannot mount inside a React island), and this has one consumer. Compose from `Badge`
+ tokens.

#### 6. The verdict block

**File**: `src/_pages/plan-comparison/ui/VerdictBlock.tsx`

**Intent**: The free rule-verdict that `verifyGeneration` gives us, alongside the feature table — one of
the two report-derived requirements the comparison report says a UI must not drop.

**Contract**: per plan — `oracle-valid: YES/NO · soft-availability warns: N`, one line per
`verdict.reasons`, and the catalog `warnings` (`! [cohort] kind: message`). Port
[plan-report.ts:44-58](bench/plan-report.ts#L44).

#### 7. The picker

**File**: `src/_pages/plan-comparison/ui/PlanPicker.tsx`

**Intent**: Select plans and designate the baseline. N-ready by construction.

**Contract**: `MultiSelect` ([src/shared/ui/multi-select.tsx:34](src/shared/ui/multi-select.tsx#L34)) —
searchable Popover+Command with removable badge chips. Requires `searchPlaceholder` and `emptyText`. The
baseline is a `Select` over the picked plans, defaulting to the first. **Changing the selection navigates**
(the URL drives the SSR dataset) rather than mutating client state — consistent with the plan views'
stance that *"views stay shareable and the browser owns history."* No ownership filter is needed: every
authenticated user reads every plan.

#### 8. Hub entry point

**File**: `src/_pages/plans-list/ui/PlansHub.tsx`

**Intent**: Make the feature reachable. The hub's own docblock already reserves the concept: *"No derived
comparison metrics — deferred."*

**Contract**: a **Compare** button in the hub header next to *New plan* ([:58-61](src/_pages/plans-list/ui/PlansHub.tsx#L58)),
linking to `/plans/compare`. Header-level, not a per-row dropdown item — comparison is inherently
multi-plan and does not belong to a single row. Update the stale docblock.

### Success Criteria:

#### Automated Verification:

- Params-codec unit tests pass (malformed ids dropped, baseline defaulting, round-trip): `pnpm test`
- Component tests render the scoreboard from fixture data without throwing: `pnpm test`
- **Per-plan error isolation**: with one valid and one non-existent plan id, the page renders the valid plan and names the missing one — no 500, no blank page. With *zero* valid ids, 404. With the designated baseline missing, it falls back to a loaded plan and says so: `pnpm test:integration`
- Type check + lint + steiger + build clean: `pnpm check && pnpm lint && pnpm steiger && pnpm build`
- **No new `steiger.config.ts` override was needed** (if one was, it is scoped and carries a comment naming its removal phase)

#### Manual Verification:

- Navigate `/plans/compare`, pick two plans, confirm the scoreboard renders all five sections.
- Hand-edit the URL to a deleted/garbage plan id alongside a real one — the page still renders the real plan and names the missing one.
- **Scroll the cohort scoreboard vertically — the header row stays visible.** Scroll it horizontally — the metric-label column stays visible. (This is the invariant that fails silently if the bounded container is missing.)
- Short sections (golden census, cross-cohort) do not show a scrollbar.
- Worst teacher / worst student show **names**, not UUIDs.
- A cohort with unplaced hours shows the completeness annotation beneath its slot counts.
- Compare a plan against its own clone → **no** drift banner.
- Compare two unrelated plans → banner **names** what drifted.
- The Compare button is reachable from the Plans hub.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: Verify

### Overview

E2E through the clone flow, then the full CI gate.

### Changes Required:

#### 1. The clone helper

**File**: `e2e/support/planner.ts`

**Intent**: E2E has **no DB access** — all 20 specs build data through the UI. `supabase/seed.sql` is a
generated artifact that CI regenerates before boot and it emits exactly two *catalog-identical* plans, so
it cannot supply a drifted pair and hand-editing it would be overwritten. The app's own **Clone plan**
action is the natural identical-catalog producer: `clone_plan` deep-copies the catalog and re-mints every
UUID — which is exactly the case the new fingerprint exists to get right.

**Contract**: `clonePlan(page, sourceName, newName)` — row Actions kebab (`aria-label="Actions for {name}"`,
[PlansHub.tsx:140](src/_pages/plans-list/ui/PlansHub.tsx#L140)) → *Clone* menu item → fill *New plan name*
→ submit. Entity-lifecycle plumbing, so it belongs in `support/` beside `createPlan` / `deletePlan` per
`e2e/CLAUDE.md`.

#### 2. The spec

**File**: `e2e/specs/plan-comparison.spec.ts`

**Intent**: Guard the full path — route, SSR, picker, scoreboard, and the drift detector's headline claim.

**Contract**: follow the house shape (`shortId()`, `createPlan`, roles-only locators, no `waitForTimeout`,
`try/finally { deletePlan }`).

1. `createPlan` + a minimal catalog (one teacher, one or two courses, one student) → **clone it** → compare the pair → assert the scoreboard renders and **no drift banner appears**. This is the load-bearing assertion: every UUID differs, and the old `catalog_hash` would report drift here.
2. Add a student to one side through the UI (the move at [grouping-staleness.spec.ts:53](e2e/specs/grouping-staleness.spec.ts#L53)) → compare again → assert the banner appears and **names** the drift.
3. Tear down both plans.

### Success Criteria:

#### Automated Verification:

- E2E passes locally and in CI: `pnpm test:e2e`
- The full CI gate passes: run the `/verify` skill (install → `astro sync` → lint → steiger → audit → test → build)
- Integration suite passes: `pnpm test:integration`

#### Manual Verification:

- Confirm the CI `e2e` job passes on the PR (it boots the stack + workerd preview).
- Sanity-check the rendered numbers for a real plan against `ANALYZE_PLAN_A=<plan-id> pnpm analyze:plans` — the UI and the analyzer now share one loader and must agree digit-for-digit.

---

## Testing Strategy

### Unit Tests

- **Fingerprint**: order-insensitivity; a fixed golden digest locking code-point sort (mirroring `compute-catalog-hash.test.ts`'s triad); sensitivity to each of the six projection categories.
- **Diff**: each category's added/removed/changed counts.
- **Tier**: grid mismatch outranks catalog drift; equal fingerprints yield `clean`.
- **Formatters**: `num` / `pct` / `extreme` / `distributionLine`, and `pooledMean` pooling **samples** not means.
- **Metric catalog**: every row resolves against a fixture feature vector; row count and order match the bench per section; dynamic golden labels read off the baseline.
- **Deltas**: numeric rows get a signed delta, text rows get none; no ranking is produced.
- **Invariant**: an incomplete cohort always produces a completeness annotation.
- **Params codec**: malformed ids dropped, baseline defaulting, clean round-trip.

### Integration Tests

- **Loader** (`plan-comparison.integration.test.ts`): well-formed `input`, resolving `naturalKeys`, surfaced `warnings`, a `verifyGeneration` verdict. State built through `src/test/factories/`, cleaned up via `teardown`. Never assert against seed rows.
- **The clone test** (the reason the fingerprint exists): a plan and its `clone_plan` copy produce an **equal** natural-key fingerprint while producing **different** `computeCatalogHash` values.

### E2E

- Clone → identical pair → scoreboard renders, no drift banner.
- Mutate one side → drifted pair → banner names the drift.

### Manual Testing Steps

1. Navigate `/plans/compare`, pick two plans, confirm all five sections render.
2. Scroll the 18-row cohort scoreboard vertically — the header row must stay pinned. Scroll horizontally — the metric-label column must stay pinned.
3. Confirm short sections show no scrollbar.
4. Confirm worst teacher / worst student render as names.
5. Confirm a cohort with unplaced hours shows its completeness annotation beneath the slot counts.
6. Cross-check the rendered numbers against the bench CLI for the same plan id.

## Performance Considerations

Analysis is not the cost centre; the Supabase round trips are. `analyzePlan` is ~50k elementary operations
per board — against the paid tier's 30 s CPU ceiling, under 0.01% of budget. The loader is ~15 round trips
per plan with no shared state, so `Promise.all` over N plans gives wall-clock ≈ one plan's latency. The
Workers subrequest cap (1000/invocation on paid) stays safe past N ≈ 60.

Phase 2 removes one redundant `courses` query from the analyzer loader. The three *app* loaders keep
theirs — see *What We're NOT Doing*; their queries are not redundant, and a follow-up change can retire
them properly.

The real ceiling is **readability, and it arrives fast**: the scoreboard is per-cohort, so N plans = 2N
columns. Three plans is six cohort columns; five is ten. The frozen-pane containers absorb this, and the
picker defaults to two.

## Migration Notes

No schema change, no migration, no new RLS policy or grant. Every table the loader reads is already read by
the authenticated app client. `GroupingCourse` and `computeCatalogHash` are untouched, so grouping
staleness is unaffected — the golden-digest test proves it.

**PII, consciously.** The comparison surface renders real teacher and student names (the only real gold
plan is production data; `data/golden-plan.sql` is gitignored precisely because it carries them). This is
normal for this app — the board already renders them — but the analyzer's CLI carried a local-stack-only
guard (`ANALYZE_ALLOW_REMOTE`, impl-review F2) because it had no such licence. The in-app surface does:
it is behind deny-by-default auth. This is a deliberate yes, not an accident.

## References

- Research: `context/changes/comparing-plans/research.md`
- Change notes: `context/changes/comparing-plans/change.md`
- The deferred design (Option C): `context/archive/2026-07-12-plan-quality-analyzer/research.md:135-138`
- The deferral and its now-satisfied gating condition: `context/archive/2026-07-12-plan-quality-analyzer/plan.md:33`
- The manual v0 of this report — the de-facto content spec: `context/archive/2026-07-12-plan-quality-analyzer/comparison-report.md`
- The analyzer's real output, showing raw UUIDs where names belong: `context/archive/2026-07-12-plan-quality-analyzer/analysis-run-1.md`
- The read-only view precedent: `src/_pages/teacher-plan-view/api/loader.ts:69`, `src/pages/plans/[id]/teachers/[teacherId].astro:15`
- The mechanism that produces catalog-identical plans: `context/archive/2026-07-11-clone-plan-without-board/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Enable

#### Automated

- [x] 1.1 Unit tests pass
- [x] 1.2 `adapter-parity.integration.test.ts` still passes (composite-name key untouched)
- [x] 1.3 Catalog-hash golden digest test still passes (GroupingCourse + hash unchanged)
- [x] 1.4 Type check (`pnpm check`) + lint pass
- [x] 1.5 FSD structure clean with no new steiger override
- [x] 1.6 Build clean

#### Manual

- [x] 1.7 None required — the phase is purely additive (two barrels widened, one new `CohortCatalog` field); confirm no existing render path changed

### Phase 2: Loader

#### Automated

- [ ] 2.1 Loader integration test passes
- [ ] 2.2 Bench analyzer still runs with unchanged output (`ANALYZE_PLAN_A=<id> pnpm analyze:plans`)
- [ ] 2.3 `bench/load-plan-analysis-input.ts` deleted and unreferenced
- [ ] 2.4 Bench→slice boundary holds (api-segment-only; no `ui/` in its import graph; `bench/**` ESLint rule fails a violation)
- [ ] 2.5 Type check (`pnpm check`) + lint + steiger + build clean

#### Manual

- [ ] 2.6 Bench analyzer output matches a pre-move capture digit-for-digit

### Phase 3: Drift model

#### Automated

- [ ] 3.1 Fingerprint unit tests pass (order-insensitivity, golden digest, per-category sensitivity)
- [ ] 3.2 Clone-vs-source: equal natural-key fingerprint, different `computeCatalogHash`
- [ ] 3.3 Diff unit tests pass (every category)
- [ ] 3.4 Tier unit tests pass (grid mismatch outranks catalog drift)
- [ ] 3.5 Type check (`pnpm check`) + lint + steiger + build clean

### Phase 4: Scoreboard model

#### Automated

- [ ] 4.1 Formatter unit tests pass, incl. `pooledMean` pooling samples not means
- [ ] 4.2 Metric-catalog tests pass (row count + order match the bench per section)
- [ ] 4.3 Delta tests pass (numeric rows only; no ranking produced)
- [ ] 4.4 Invariant test: incomplete cohort always yields a completeness annotation
- [ ] 4.5 Extremes resolve to names, not UUIDs
- [ ] 4.6 Type check (`pnpm check`) + lint + steiger + build clean

### Phase 5: UI

#### Automated

- [ ] 5.1 Params-codec unit tests pass
- [ ] 5.2 Component tests render the scoreboard from fixture data
- [ ] 5.3 Per-plan error isolation: 1 valid + 1 missing id renders the valid plan and names the missing one; 0 valid → 404; a missing baseline falls back and says so
- [ ] 5.4 Type check (`pnpm check`) + lint + steiger + build clean
- [ ] 5.5 No new steiger override needed (or: scoped, with a removal-phase comment)

#### Manual

- [ ] 5.6 `/plans/compare` renders all five sections for two picked plans
- [ ] 5.7 A deleted/garbage plan id alongside a real one still renders the real plan and names the missing one
- [ ] 5.8 Vertical scroll keeps the header row pinned; horizontal scroll keeps the label column pinned
- [ ] 5.9 Short sections show no scrollbar
- [ ] 5.10 Worst teacher / worst student render as names
- [ ] 5.11 Incomplete cohort shows its completeness annotation beneath the slot counts
- [ ] 5.12 Plan vs its own clone → no drift banner
- [ ] 5.13 Two unrelated plans → banner names the drift
- [ ] 5.14 Compare button reachable from the Plans hub

### Phase 6: Verify

#### Automated

- [ ] 6.1 E2E passes locally and in CI
- [ ] 6.2 Full CI gate passes (`/verify` skill)
- [ ] 6.3 Integration suite passes

#### Manual

- [ ] 6.4 CI `e2e` job passes on the PR
- [ ] 6.5 UI numbers match the bench CLI digit-for-digit for the same plan
