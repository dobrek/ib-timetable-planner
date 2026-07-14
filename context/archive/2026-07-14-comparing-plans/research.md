---
date: 2026-07-14T14:07:53Z
researcher: Claude (Opus 4.8), with the plan author
git_commit: c5e3308cf22f7e28d610488c8776ed05aef7129f
branch: main
repository: ib-timetable-planner
topic: "Feasibility of an in-app plan-comparison feature (pick plans → analyzer → UI)"
tags: [research, codebase, analysis, plan-quality, comparison, fsd, _pages, entities-timetable]
status: complete
last_updated: 2026-07-14
last_updated_by: Claude (Opus 4.8)
---

# Research: Comparing plans in the UI

**Date**: 2026-07-14T14:07:53Z
**Researcher**: Claude (Opus 4.8), with the plan author
**Git Commit**: `c5e3308cf22f7e28d610488c8776ed05aef7129f`
**Branch**: `main`
**Repository**: ib-timetable-planner

## Research Question

> Check the feasibility of introducing a plan-comparison feature: a user picks plans to compare, and
> based on the analysis process we already have, gets that information in the UI.

**Scope decisions taken with the author before this research was synthesized:**

| Decision | Choice |
|---|---|
| Which pairs are pickable | **Any two plans, flag drift** — no picker restriction; the UI detects catalog differences and warns |
| What the user sees | **Scoreboard table** — per-plan metric columns with deltas; the digital twin of `comparison-report.md` |
| Research depth | **Full architectural dive** |
| *(asked mid-research)* | *Can this extend beyond two plans?* → see [§7](#7-scaling-beyond-two-plans) |

## Summary

**Feasible, and cheaper than it looks. This is a UI change, not an engine change.**

The verdict rests on four facts:

1. **The compute core is already built, pure, and deliberately Workers-safe *for this exact purpose*.**
   `analyzePlan` ([src/entities/timetable/model/analysis/analyze-plan.ts:25](src/entities/timetable/model/analysis/analyze-plan.ts#L25)) is a synchronous, side-effect-free fold — ~50k Map/Set operations for a whole two-cohort board, i.e. **low single-digit milliseconds**. Its own docblock states the intent: *"Pure and Workers-safe like the rest of the entity core, so a future in-app surface reuses it verbatim."*

2. **This feature was already designed and consciously deferred — it is "Option C".**
   [context/archive/2026-07-12-plan-quality-analyzer/research.md:135](context/archive/2026-07-12-plan-quality-analyzer/research.md#L135) specifies `/plans/[id]/compare/[otherId]`, the SSR `Promise.all`, the side-by-side feature table. The deferral is recorded as an explicit scope exclusion in that change's plan ([plan.md:33](context/archive/2026-07-12-plan-quality-analyzer/plan.md#L33)): *"No in-app surface (KPI strip / comparison page — Options B/C): explicitly deferred **until after the expert session validates which features matter**."* **That gating condition has since been met** — the expert session happened in `generation-quality-tuning`. The block is lifted.

3. **The plan-id → analyzer-input loader already exists and runs today** — `loadPlanAnalysis` ([bench/load-plan-analysis-input.ts:39](bench/load-plan-analysis-input.ts#L39)). It imports **only** `@/shared/api`, `@/shared/config`, `@/shared/lib/*` and `@/entities/timetable`, takes the Supabase client as a parameter, reads no `process.env`, and touches no Node API. It is verbatim-movable into `src/`.

4. **Two plans is already a solved shape.** [bench/plan-quality.analyze.ts:46](bench/plan-quality.analyze.ts#L46) does `Promise.all(ids.map(id => loadPlanAnalysis(supabase, id)))` today, and `bench/plan-report.ts` already renders **N plans as N side-by-side columns**.

**What is genuinely net-new:** a route, an SSR loader in a page slice, a React `<Table>` presenter, a plan picker, name resolution for opaque keys — and **one thing nobody has built: a catalog-drift detector.**

### The one real trap

> **The existing `catalog_hash` cannot detect catalog drift between plans. It hashes UUIDs.**

`computeCatalogHash` ([src/shared/lib/catalog-hash/compute-catalog-hash.ts:13](src/shared/lib/catalog-hash/compute-catalog-hash.ts#L13)) digests `course.id`, `teacherKeys` and `studentKeys` — all of which are **per-plan UUIDs**. `clone_plan` re-mints every course/teacher/student UUID ([supabase/migrations/20260711174905_clone_plan_include_board.sql:41-64](supabase/migrations/20260711174905_clone_plan_include_board.sql#L41)), so **even a clone and its own source produce different catalog hashes** — which is precisely why the clone flow recomputes the hash in JS afterwards ([src/_pages/plans-list/api/clone-plan.ts:45](src/_pages/plans-list/api/clone-plan.ts#L45)).

That hash is an *intra-plan staleness* fingerprint (it lives on `course_groupings`, not on `plans`), and it is doing its job correctly. It is simply the wrong tool for cross-plan equivalence. The chosen "flag drift" behaviour therefore requires a **new, content-addressed fingerprint over natural keys** — see [§4](#4-the-catalog-drift-problem-the-only-genuinely-new-design-work).

## Detailed Findings

### 1. The analyzer core — reuse verbatim

`src/entities/timetable/model/analysis/` — 15 source files, 13 co-located test files (~70 cases, all in `pnpm test`).

**Entry point.** `analyzePlan(input: PlanAnalysisInput): PlanQualityFeatures` composes eleven lenses. Per-cohort lenses receive `rows.filter(cohort)`; the board-wide lenses (`teachers`, `crossCohort`, `subjects`) read the merged catalog, because staff work both cohorts and a subject has an edition in each ([analyze-plan.ts:26-39](src/entities/timetable/model/analysis/analyze-plan.ts#L26)).

| Lens | Module | Derives |
|---|---|---|
| completeness | `completeness.ts:21` | unplaced hours (parity with the generator's `deriveGenerationDeficits`), **over-placed hours kept separate and never netted**, `uncataloguedRows` |
| board shape | `board-shape.ts:14` | occupied slots, placement rows, interior holes, free-at-day-**start** vs free-at-day-**end** (split deliberately), `emptyDays`, per-day `DayEdgeProfile[]` |
| daily load | `daily-load.ts:13` | hours/day, slots/day + distributions |
| slot census | `slot-census.ts:37` | students/slot, courses/slot, thin slots **with position**, and the golden census (per-week-lane, worst lane wins) |
| week symmetry | `week-symmetry.ts:11` | slots in week A vs B, `slotDelta`, `differingCells` |
| adjacency | `course-adjacency.ts:18` | adjacent pairs (doubles), **same-day splits**, `splitCourseIds` |
| spread | `course-spread.ts:14` | placed/multi-day courses, days-used distribution, mean period by course |
| students | `student-lens.ts:20` | gap slots (**parity-pinned to `countStudentHoles`**), worst student, hours/student-day, span efficiency, single-lesson days, early starts, late finishes |
| teachers | `teacher-lens.ts:20` | gap slots, worst teacher, teaching days, hours/teaching day, **soft/strong availability hits** |
| cross-cohort | `cross-cohort.ts:21` | teachers in both cohorts, cohort-pure days, cohort switches + seamless share, **mirrored-cell fixture detector** |
| subjects | `subject-rollup.ts:22` | per-subject placed hours, **mean period (the time-of-day gradient)**, adjacent pairs, same-day splits |

The shared primitive under ~80% of these is `expandLanes` ([lanes.ts:46](src/entities/timetable/model/analysis/lanes.ts#L46)) — rows → `(entityKey, day, weekLane)` lanes, where a `both`-week row fans into **both** lanes. This lane-expansion convention is what made the golden-side numbers agree digit-for-digit with the hand-written SQL in analyzer run #1.

**Purity verdict — clean.** Grepped across all 15 non-test files and every transitive dependency: **zero** occurrences of `async`, `await`, `Promise`, `process.`, `require(`, `node:`, `fs.`, `Date.`, `Math.random`, `crypto`, `globalThis`, `import.meta`. Fully synchronous, deterministic, non-mutating (every fold builds fresh Maps/Sets/arrays).

**Perf.** With R ≈ 250 rows/cohort, S ≈ 27–34 students/cohort, D=5, P=10: no term is quadratic in R. Dominant costs are the student lane expansion (~6k Set inserts/cohort, [student-lens.ts:23](src/entities/timetable/model/analysis/student-lens.ts#L23)) and golden coverage (~17k, [slot-census.ts:102](src/entities/timetable/model/analysis/slot-census.ts#L102)). **Total ≈ 50k elementary operations per board.** Against the paid-tier **30 s CPU** ceiling this is under 0.01% of budget. Analysis is not the cost centre; the Supabase round trips are.

**Types.**

```ts
// types.ts:36 — what a caller must supply
type PlanAnalysisInput = {
  days: number;
  periods: number;
  courses: Record<Cohort, AnalyzerCourse[]>;   // "dp1" | "dp2"
  rows: AnalyzerRow[];                          // BOTH cohorts, one flat array
  availability: BoardAvailabilityCell[];        // plan-scoped, cohort-independent
  parkedCourseIds: Record<Cohort, string[]>;    // multiset: one entry = one off-board hour
};

// types.ts:18 — student choices arrive PRE-RESOLVED, not as raw rows
type AnalyzerCourse = {
  id: string; teacherKeys: string[]; studentKeys: string[]; hours: number; weekMode: WeekMode;
  name: string; level: string; groupIndex: number;   // added for roll-ups + mirrored-cell census
};
```

The analyzer **never sees a `student_choices` row** — overlaps and merges are already folded into `studentKeys` by `loadCohortCourses`. Its output nests roughly ten lenses under `cohorts.dp1` / `cohorts.dp2` plus board-wide `teachers` / `crossCohort` / `subjects`, with `Distribution = {count,min,p10,median,mean,max,variance}` and `Extreme = {key, value}` as the leaf shapes ([types.ts:289-310](src/entities/timetable/model/analysis/types.ts#L289)).

### 2. The loader — exists, in the wrong folder

`loadPlanAnalysis(supabase, planId) → { id, name, input, snapshot, board, warnings }` ([bench/load-plan-analysis-input.ts:39](bench/load-plan-analysis-input.ts#L39)).

| Step | Source | Tables |
|---|---|---|
| plan header + grid | `:81` | `plans` → `id, name, slot_grid_preset`; grid via `parseGridPreset` ([src/shared/lib/grid/grid.ts:27](src/shared/lib/grid/grid.ts#L27)) |
| catalog ×2 cohorts | `:106` → [src/shared/api/load-cohort-courses.ts:29](src/shared/api/load-cohort-courses.ts#L29) | `courses`, `course_teachers`, `student_choices`, `course_overlaps`, `course_merges` (5 queries each) |
| subject identity ×2 | `:107` | a **second** `courses` query for `name, level, group_index` — see the redundancy note below |
| placements ×2 | `:108` → `src/shared/api/load-placements.ts:8` | `placements` |
| availability | `:45` → `src/shared/api/load-teacher-availability.ts:7` | `teacher_availability` |
| parked | `:138-155` | `shelf_bundles` + `shelf_bundle_courses` |

**≈15 round trips per plan, in 2 waves.** It also assembles a `GeneratorSnapshot` with `pins: []` ([:62](bench/load-plan-analysis-input.ts#L62)) so the *whole* board can be handed to `verifyGeneration` — "would the engine have been *allowed* to build this?" That is the free rule-verdict block the comparison report asked for, and it is how analyzer run #1 established that the expert's board is oracle-valid. It surfaces `warnings: PlanWarning[]` (catalog anomalies `no-students` / `zero-hours`) rather than dropping them.

**Why it moves cleanly.** It cannot live in `shared/` (it depends on `PlanAnalysisInput` from `entities`, and `shared` may not import upward), and `entities/timetable` is deliberately IO-free. **The natural home is a page slice's `api/` segment.** The only bench-specific thing is the *caller's* choice of a service-role client ([bench/local-supabase.ts:13](bench/local-supabase.ts#L13), hostname-pinned to localhost); in-app that becomes the request-scoped client. Every table it reads is already read by the authenticated app client via [src/_pages/plan-detail/api/load.ts:57](src/_pages/plan-detail/api/load.ts#L57) — **no new RLS or grant surface**.

**Redundancy worth fixing on the way through:** the second `courses` query at [:107](bench/load-plan-analysis-input.ts#L107) exists only because `loadCohortCourses` selects `name, level, group_index` and then discards them into a composite display name ([load-cohort-courses.ts:135](src/shared/api/load-cohort-courses.ts#L135)). Widening `CohortCatalog` to carry the raw identity triple removes one query per cohort per plan — and, not coincidentally, **hands the drift detector the natural keys it needs** (§4).

**Do not reuse `loadCombinedPlannerData`** ([src/_pages/plan-detail/api/load.ts:50](src/_pages/plan-detail/api/load.ts#L50)) — ≈26 round trips, roughly a third of which (groupings, grouping members, shelf, staleness hashing, batch-export sources) exist purely to drive the *editing* palette. Promoting the bench loader is cleaner than retrofitting the board loader.

### 3. What does NOT exist

| Missing piece | Evidence | Cost |
|---|---|---|
| **A delta/diff layer** | `bench/plan-report.ts` has **no subtraction, no ratio, no ranking** anywhere — every "comparison" is side-by-side columns (`columns = reports.flatMap(...)`, [:62](bench/plan-report.ts#L62)). Deliberate: *"It reports; it never judges"* ([:17](bench/plan-report.ts#L17)). | Must be written. Small and pure. |
| **A React presenter** | `bench/plan-report.ts` is `console.log` + fixed-width `padEnd` ([:285](bench/plan-report.ts#L285)). Terminal-only. | Rewrite. But see below. |
| **A catalog-drift detector** | Nothing in the schema records lineage; the existing hash is UUID-based (§4). | **The real design work.** |
| **Name resolution** | The analyzer speaks in opaque `studentKeys`/`teacherKeys`; the CLI prints **raw UUIDs** for worst teacher/student ([analysis-run-1.md:187](context/archive/2026-07-12-plan-quality-analyzer/analysis-run-1.md#L187)). | Join via `loadTeacherNames` / `loadStudentNames`, already in `shared/api`. |

**The console renderer is not reusable as code, but it is a ready-made spec.** Its declarative metric catalogs — `rows: [label, (report, cohort) => string][]` at [:65-90](bench/plan-report.ts#L65), `:133-146`, `:159-178`, `:200-217` — encode exactly which metrics matter, in what order, with what labels. Its pure formatters (`num`, `pct`, `extreme`, `distributionLine`, `pooledMean` — which pools cohort *samples* rather than averaging means) lift straight into a framework-free presenter module. `buildReport(plan)` ([:27](bench/plan-report.ts#L27)) — `{plan, verdict: verifyGeneration(...), features: analyzePlan(...)}` — is directly reusable.

### 4. The catalog-drift problem (the only genuinely new design work)

**The schema makes every catalog plan-owned, and no two plans share identity.**

[supabase/migrations/20260611180006_plans_as_domain_root.sql:3-6](supabase/migrations/20260611180006_plans_as_domain_root.sql#L3) states it outright: *"The catalog (teachers, courses, students, choices, dependencies) becomes plan-owned; … composite FKs make cross-plan references impossible at the DB level."* Every domain table carries `plan_id` and cascades on plan delete. The global `teachers_code_key` was **dropped** and replaced with `teachers_plan_code_unique (plan_id, code)` — the migration comment says the global unique *"blocked cloning."*

Consequences, in order of how much they will bite:

1. **`clone_plan` re-mints every UUID.** Each parent table gets a temp ID map whose `new_id` is `default gen_random_uuid()`. A clone and its source share *content* — course names, levels, group indices, teacher codes, student names, hours, availability — but never *identity*.
2. **Therefore the existing `catalog_hash` is structurally incapable of answering "do these two plans share a catalog?"** It digests `course.id` + `teacherKeys` + `studentKeys`, all UUIDs. It will report drift between a clone and its source, which are identical. It is not broken — it answers a different question (has *this plan's* catalog changed since *its* groupings were computed?) and lives on `course_groupings`, not `plans`.
3. **There is no lineage column.** `plans` is only `id, name, slot_grid_preset, created_at, updated_at` ([20260602185012_minimal_domain_schema.sql:91](supabase/migrations/20260602185012_minimal_domain_schema.sql#L91)) — verified across all 53 migrations, no column was ever added. Nothing records that plan B was cloned from plan A, and **nothing distinguishes a generated plan from a hand-authored one** (generation writes into the same `placements` table).
4. **Any cross-plan join must key on natural keys, never UUIDs:**
   - course → `(cohort, name, level, group_index)` — the `courses_unique` tuple ([:42](supabase/migrations/20260611180006_plans_as_domain_root.sql#L42))
   - teacher → `code` — `teachers_plan_code_unique` ([:34](supabase/migrations/20260611180006_plans_as_domain_root.sql#L34))
   - student → `full_name` — **no unique constraint; the weakest key.** Two students with the same name collide.

**Proposed drift detector** — a new pure fingerprint in the slice's `model/`, content-addressed over natural keys:

```
courses:      sorted (cohort, name, level, group_index, hours, week_mode)
teachers:     sorted (code)
students:     sorted (full_name)
choices:      sorted (student_full_name, course natural key)
availability: sorted (teacher_code, day, period, severity)
grid:         (days, periods)
```

Reuse `computeCatalogHash`'s canonical-JSON + SHA-256 + Web-Crypto shape (edge-safe, already proven) but over the *natural-key* projection. Equal fingerprint ⇒ the comparison is apples-to-apples. Unequal ⇒ compute a **structured diff**, not just a boolean, so the banner can say *what* drifted.

**A drift taxonomy the UI should distinguish** (severity ascending):

| Tier | Condition | Consequence |
|---|---|---|
| **Incomparable** | `slot_grid_preset` differs | `days`/`periods` differ ⇒ board-shape, day-edge and slot-census metrics are meaningless. Prior work flags this as *"an unhandled case today"* ([plan.md:52](context/archive/2026-07-12-plan-quality-analyzer/plan.md#L52)). **Block or hard-warn.** |
| **Catalog drift** | Course/student/teacher/availability sets differ | Catalog-*dependent* metrics (completeness, student lens, slot census, teacher lens, subject roll-up) are apples-to-oranges. Catalog-*independent* ones (board shape, daily load, week symmetry, adjacency, spread) survive — they fold over placements + grid only. |
| **Clean** | Fingerprints equal | Full comparison valid. This is the `clone_plan(source, name, include_board=false)` → generate flow the analyzer was validated on. |

> The author chose **"any two plans, flag drift"** over metric-partitioning. That is the right default — but the tiers above are worth encoding *in the model* even if the first UI only renders a banner: the information is nearly free once the fingerprint exists, and it lets a later iteration dim the untrustworthy rows without a re-architecture.

### 5. Where the code goes (FSD)

**Verdict: a new `src/_pages/plan-comparison/` page slice**, mirroring `teacher-plan-view` / `student-plan-view`.

- Not `widgets/` — that layer is *composed read-only UI shared across page slices* (`ScheduleGrid`, `PerspectiveCourseList`). A comparison table has one consumer.
- Not `entities/timetable/` for the UI. The *pure* comparison math (fingerprint, feature deltas) belongs in the slice's `model/` until a second consumer appears.
- `_pages/` may import `entities` — **but only through the public barrel.** Grep confirms **zero** deep imports into `@/entities/timetable/*` anywhere in `src/` or `bench/`; FSD `no-public-api-sidestep` is clean and must stay that way.

**Barrel gap to plan for.** [src/entities/timetable/index.ts:33-40](src/entities/timetable/index.ts#L33) exports only six symbols:

```ts
export { analyzePlan, type AnalyzerCourse, type AnalyzerRow, type Distribution,
         type PlanAnalysisInput, type PlanQualityFeatures } from "./model/analysis";
```

`CohortFeatures`, `TeacherFeatures`, `CrossCohortFeatures`, `SubjectRollup`, `Extreme`, `GoldenCell`, `ThinSlot`, `MirroredCell`, `DayEdgeProfile` are **not exported**. `bench/plan-report.ts:154` works around this with an indexed-access type. **Any component that types a prop as `CohortFeatures` must widen this barrel** — and the narrowing was a *deliberate* impl-review fix (F7, [impl-review.md:94](context/archive/2026-07-12-plan-quality-analyzer/reviews/impl-review.md#L94)), so widening is a conscious decision, not an oversight to be quietly undone.

**Steiger friction.** A new slice with exactly one consumer trips `fsd/insignificant-slice` under `--fail-on-warnings`. Both prior view slices needed a temporary scoped override in `steiger.config.ts` (teacher `plan.md:124-130`, student `plan.md:140-146`). Copy that precedent.

### 6. Where the compute runs, and the route

**Server-side, in the Astro page frontmatter.** `analyzePlan` is a sub-millisecond pure fold; there is nothing here resembling the 20-second engine solve.

For contrast — and this is the useful precedent to *not* copy: **plan generation runs in a browser Web Worker**, deliberately ([generate.worker.ts:20](src/_pages/plan-detail/model/generation/generate.worker.ts#L20), `GENERATION_BUDGET_MS = 20_000` at [worker-protocol.ts:12](src/_pages/plan-detail/model/generation/worker-protocol.ts#L12)). The decision is recorded: *"**No server-side generation seat** — no Astro Action engine, no Timefold container; client Web Worker only"* ([plan-generation/plan.md:98](context/archive/2026-07-11-plan-generation/plan.md#L98)). That rationale (unlimited wall-clock, natural cancel, zero server cost) **does not transfer** to analysis, which is ~4 orders of magnitude cheaper.

Follow the read-only view pattern instead — one SSR load, everything plain-serializable, island rebuilds indexes at render:

1. **Route** `src/pages/plans/compare.astro` (see below) — frontmatter: `createClient` → validate ids (`isPlanId`) → `Promise.all` the loads → `analyzePlan` ×N → `verifyGeneration` ×N → fingerprint/drift → `Result<T, {kind:"not-found"}|{kind:"unavailable"}>`.
2. **Island** `<PlanComparisonPage data={data} client:load />` — takes plain Records/arrays (no Maps), per [teacher-plan-view/api/loader.ts:64](src/_pages/teacher-plan-view/api/loader.ts#L64): *"the island rebuilds indexes by calling the pure `entities/timetable` functions at render time."*
3. Middleware auto-gates it — deny-by-default, no allowlist change ([src/middleware.ts:7](src/middleware.ts#L7)).

**Route shape — prefer a plans-level route over the archived `/plans/[id]/compare/[otherId]`.** The 2026-07-12 sketch nested it under a single plan, which reads as "plan A's comparison page" and doesn't generalize to N. `**/plans/compare?plans=<id>,<id>[,<id>…]**` is symmetric, shareable, bookmarkable, and N-ready. Use `useUrlSyncedFilters` + a pure `model/compare-params.ts` codec (the established pattern) so selection lives in the URL.

**Auth is a non-issue, and worth knowing why.** There is **no `author_id`/`owner` column anywhere**, and **no `auth.uid()` in any policy** — grepped all 53 migrations, zero hits. Every policy is `for all to authenticated using (true) with check (true)` ([20260602185012:163](supabase/migrations/20260602185012_minimal_domain_schema.sql#L163)). Any authenticated user reads every plan. The picker needs **no ownership filter**.

**Picker.** `MultiSelect` ([src/shared/ui/multi-select.tsx:34](src/shared/ui/multi-select.tsx#L34)) — searchable Popover+Command with removable badge chips — is the direct fit, and is N-ready by construction. Precedents: `BulkChoiceDialog.tsx:182`, `CourseFilter.tsx:20`, `MergeBuilderDialog.tsx:84`. Entry point from the Plans hub ([plans-list/ui/PlansHub.tsx:74](src/_pages/plans-list/ui/PlansHub.tsx#L74)), whose own comment already says *"No derived comparison metrics — deferred."*

**DS inventory:** `Table`, `Tabs`, `Dialog`, `MultiSelect`, `Badge`, `Select`, `Command` all exist and are token-based. **No charting library is installed** (no recharts/d3/visx/nivo) — a scoreboard table needs none, and adding one is a new dependency decision (audit gate + 10 MB script budget). Given the chosen "scoreboard table" output, this is a non-issue.

### 7. Scaling beyond two plans

**Yes — and the compute side is already N-shaped. Design for N now; it costs nothing today and is expensive to retrofit.**

- **The analyzer has zero pairwise coupling.** `analyzePlan` maps one plan → one independent feature vector. There is no "compare" step inside it.
- **The CLI already does N.** `Promise.all(ids.map(...))` ([bench/plan-quality.analyze.ts:46](bench/plan-quality.analyze.ts#L46)) and `columns = reports.flatMap(...)` ([bench/plan-report.ts:62](bench/plan-report.ts#L62)) — the text report renders N plans as N column groups today. It happens to be invoked with 1–2.
- **Cost is linear and fully parallel.** ~15 round trips per plan, no shared state ⇒ wall-clock ≈ one plan's latency regardless of N. The binding limit is the Workers **subrequest cap** (1000/invocation on paid), so 15N stays safe past N ≈ 60. Analysis CPU (~50k ops × N) is noise.

The three things that actually change with N > 2:

1. **"Delta" needs a baseline.** With two plans a delta column is unambiguous. With N, the natural generalization is **one plan designated the reference** (the golden/expert plan, in the motivating use case) and N−1 comparand columns rendered as delta-vs-baseline. Model the state as `{ baselineId, planIds[] }` from day one, not `{ a, b }`.
2. **Drift becomes a fan, not a pair.** Fingerprint every plan, group by fingerprint, and flag each plan's drift **relative to the baseline**. This falls out of the §4 design for free.
3. **Readability is the real ceiling, and it arrives fast.** The scoreboard is already **per-cohort** — `bench/plan-report.ts` emits dp1 *and* dp2 columns per plan — so **N plans = 2N metric columns.** Three plans is six columns; five plans is ten. Practical guidance: **build the model for N, ship the UI comfortable at N = 2–4**, put the table in an `overflow-x: auto` container, and consider a cohort toggle (`Tabs`) to halve the column count when N grows.

**Recommendation: type the loader and the comparison model as `plans: PlanQualityFeatures[]` with a `baselineId`, and let the first UI iteration merely *default* to two.** The N-plan capability then costs a picker change, not a rewrite.

## Code References

**The compute core (reuse as-is)**
- `src/entities/timetable/model/analysis/analyze-plan.ts:25` — `analyzePlan`, the entry point; docblock states the in-app reuse intent
- `src/entities/timetable/model/analysis/types.ts:36` — `PlanAnalysisInput`
- `src/entities/timetable/model/analysis/types.ts:289` — `PlanQualityFeatures`
- `src/entities/timetable/model/analysis/lanes.ts:46` — `expandLanes`, the lane-expansion convention behind ~80% of metrics
- `src/entities/timetable/index.ts:33-40` — the barrel; **exports only 6 symbols, must be widened**

**The loader (promote into `src/`)**
- `bench/load-plan-analysis-input.ts:39` — `loadPlanAnalysis(supabase, planId)`; ≈15 round trips, no bench-only dependency
- `bench/load-plan-analysis-input.ts:62` — the `pins: []` snapshot that yields the free `verifyGeneration` verdict
- `bench/load-plan-analysis-input.ts:107` — the redundant second `courses` query (fix on the way through; also yields the natural keys)
- `bench/plan-quality.analyze.ts:46` — `Promise.all(ids.map(...))`: two-plan loading already works

**The report spec (port, don't reuse)**
- `bench/plan-report.ts:27` — `buildReport`: `{plan, verdict, features}` — directly reusable
- `bench/plan-report.ts:65-90`, `:133-146`, `:159-178`, `:200-217` — the declarative metric catalogs = the scoreboard spec
- `bench/plan-report.ts:20-22` — the rendering invariant: *no slot count without completeness beside it*
- `bench/plan-report.ts:285` — `printTable`, the `console.log` part that must be replaced

**Drift**
- `src/shared/lib/catalog-hash/compute-catalog-hash.ts:13` — hashes UUIDs; **cannot detect cross-plan drift**
- `src/_pages/plans-list/api/clone-plan.ts:45` — recomputes the hash after cloning (the tell)
- `supabase/migrations/20260611180006_plans_as_domain_root.sql:31-65` — plan-owned catalog; the natural keys
- `supabase/migrations/20260711174905_clone_plan_include_board.sql:41-64` — every UUID re-minted on clone

**Precedents to copy**
- `src/_pages/teacher-plan-view/api/loader.ts:69` — the SSR read-only loader shape + `Result` convention
- `src/pages/plans/[id]/teachers/[teacherId].astro:15` — route → frontmatter `Promise.all` → island
- `src/shared/ui/multi-select.tsx:34` — the plan picker
- `src/shared/lib/actions/define-domain-action.ts:13` — the Action pattern, *if* a re-analyze-without-navigation seat is ever needed

**Precedents NOT to copy**
- `src/_pages/plan-detail/api/load.ts:50` — `loadCombinedPlannerData`, ≈26 round trips, a third of it editing-only
- `src/_pages/plan-detail/model/generation/generate.worker.ts:20` — the Web Worker seat; correct for a 20 s solve, wrong for a 3 ms fold

## Architecture Insights

1. **The analyzer was built with this feature in mind and the constraint held.** Workers-safety was an explicit, CI-enforced success criterion (`plan.md:324`), and it survived. This is the payoff: the expensive part of the feature was pre-paid.
2. **"Feature vector, never a score" is a hard architectural stance, not a preference.** Both the analyzer ([analyze-plan.ts:20-23](src/entities/timetable/model/analysis/analyze-plan.ts#L20)) and the reporter ([plan-report.ts:17](bench/plan-report.ts#L17)) say so, and the reason is scar tissue: the weighted-scalar objective had a tier-bleed bug (`generation-engine-hardening`). **The UI must not render "Plan A wins", a composite score, or a pass/fail bar.** Deltas per metric, yes. A verdict, no.
3. **Two rendering invariants are load-bearing and must migrate into React:** (a) a slot count never renders without that cohort's unplaced hours beside it — *"an incomplete board trivially uses fewer slots, which is exactly how the engine's 5 abandoned hours once read as a 'better' slot count"*; (b) `emptyDays` renders beside the day-edge metrics — a wholly empty day dumps every period into `freeSlotsAtDayStart` (impl-review F8).
4. **Identity vs display is a recurring seam in this codebase** — and it is exactly the `lessons.md` rule *"Port the mechanism, not the legacy type shape"* in a new guise. The analyzer keeps identity as opaque tokens (`studentKeys`/`teacherKeys`) and pushes display to the edges. The UI is that edge: it must join names itself. The same seam is why cross-plan joins need natural keys.
5. **Catalog warnings are part of the product, not diagnostics.** A `zero-hours` course reads as "complete" (impl-review F4). In a tool whose entire product is trustworthy figures, a silent catalog anomaly is a wrong answer. Render `warnings` beside the numbers.

## Historical Context (from prior changes)

- `context/archive/2026-07-12-plan-quality-analyzer/research.md:135-138` — **Option C, the deferred design**: `/plans/[id]/compare/[otherId]`, SSR `Promise.all`, side-by-side feature table, *"durable (any two plans, not just gold-vs-generated); moderate effort."*
- `context/archive/2026-07-12-plan-quality-analyzer/plan.md:33` — the deferral and its gating condition (*"until after the expert session"*). **Condition now satisfied** by `generation-quality-tuning`.
- `context/archive/2026-07-12-plan-quality-analyzer/plan.md:50-52` — the non-negotiables: completeness beside slots; **plans by id, never by name** (the bench's name lookup broke the moment the gold plan arrived); **grid must not be hardcoded** — read `slot_grid_preset`.
- `context/archive/2026-07-12-plan-quality-analyzer/comparison-report.md` — the manual v0 of exactly this report, and the de-facto content spec.
- `context/archive/2026-07-12-plan-quality-analyzer/analysis-run-1.md` — the analyzer's real output; shows raw UUIDs where names belong.
- `context/archive/2026-07-11-clone-plan-without-board/` — `clone_plan(source, name, include_board=false)`: the mechanism that *produces* catalog-identical plans. Availability travels with the clone, so *"the comparison is fair on constraints, not just on courses"* (`research.md:386`). Clone-fresh discipline: *"make the clone immediately before generating and treat it as disposable"* (`:389`).
- `context/archive/2026-07-12-generation-quality-tuning/change.md:158-257` — five deferred follow-ups, **all engine-side**. None touches analysis or comparison: **no competing claim on this scope.**
- `context/archive/2026-07-05-teacher-plan-view/` and `2026-07-06-student-plan-view/` — the read-only view precedent. Each was planned at 3–4 sessions, but most of that was **one-time infrastructure** (extracting `entities/timetable`, creating `widgets/timetable-board`) that now exists. The pure "new read-only page" work was a **single phase** in each.

**PRD / roadmap status: net-new.** Grepped `context/foundation/prd.md` and `roadmap.md` for compare/comparison/diff/analyzer/quality-report/side-by-side — **zero hits** for plan comparison (every "side by side" hit is the DP1|DP2 combined cohort view, slice S-06, done). This is author/expert tooling that grew out of the generation-quality work, not a committed product requirement. Note `prd.md:43`: the *"multiple variants per plan"* concept was collapsed — the domain root is `Plan`, and **multiple plans are the variant mechanism**, so comparing plans is coherent with the domain model. Expect to write a PRD amendment (precedent: `roadmap.md:203`, the XLSX-export open question folded back in).

## Risks and Open Questions

**Risks, ranked**

1. **Catalog-drift detection has no existing mechanism** (§4). The one hash that looks like it would work does not. Mitigation: new natural-key fingerprint in the slice's `model/`; reuse `computeCatalogHash`'s canonical-JSON/SHA-256 shape.
2. **Grid mismatch is unhandled today.** Two plans with different `slot_grid_preset` are not meaningfully comparable and the analyzer will happily produce numbers anyway. Decide: block, or render with a hard warning and suppress grid-dependent rows.
3. **Student natural key is weak** — `full_name` has no unique constraint. Two same-named students collide in any cross-plan student join. Acceptable for aggregate metrics (which need no join); a hazard only for per-student drill-down.
4. **Barrel widening is a deliberate reversal** of impl-review F7. Do it consciously and narrowly — export the feature types the UI actually names as props, not `export *`.
5. **PII.** The only real gold plan is production data; `data/golden-plan.sql` is gitignored precisely because it carries real student and teacher names. An in-app comparison surface renders those names — which is normal for this app (the board already does), but the analyzer's *local-stack-only guard* (`ANALYZE_ALLOW_REMOTE`, impl-review F2) exists because the CLI had no such licence. Worth a conscious "yes, the UI is allowed to show this" rather than an accident.
6. **Steiger `insignificant-slice`** on a one-consumer slice under `--fail-on-warnings`. Known, precedented, cheap.

**Open questions for the author**

1. **Baseline semantics.** With the golden plan as the motivating reference, should the comparison always designate a baseline (delta-vs-baseline), or render symmetric columns with no privileged plan? (Recommendation: baseline, defaulting to the first-picked plan — it generalizes to N and matches the actual use case.)
2. **Grid mismatch:** hard block, or warn-and-degrade?
3. **Subject roll-up key is provisional** — `name`, not `name+level` (`plan.md:39`). One `keyFn` change if the expert moves it. Does the UI expose the choice, or pin the default?
4. **Which lenses ship in v1?** The full feature vector is ~10 lenses; the CLI report prints all. A first table could be the six ranked findings from `comparison-report.md` (completeness, adjacency/splits, teacher gaps, soft-availability hits, student gaps, week shape) with the rest behind `Tabs`.
5. **Does `bench/` re-point at the promoted loader, or keep its copy?** Single-source-of-truth argues for the former (`bench/` is outside the FSD graph and already imports `@/shared/api` + `@/entities/timetable`); layer purity argues for the latter. Recommendation: re-point — a duplicated loader will drift.

## Effort Estimate

**~1–2 sessions**, assuming no engine or schema work rides along. The compute core is built; the read-only-view infrastructure (`entities/timetable`, `widgets/timetable-board`) is built; the loader exists and moves. What remains is a slice, a route, a table, a picker, a fingerprint, and a delta function — all pure or conventional.

Rough phase shape for `/10x-plan` to refine:

| Phase | Content |
|---|---|
| **P1 — enable** | Widen the entity barrel (feature types); widen `CohortCatalog` with the identity triple, deleting the redundant `courses` query; steiger override |
| **P2 — loader** | Promote `bench/load-plan-analysis-input.ts` → `src/_pages/plan-comparison/api/`; re-point `bench/`; loader integration test |
| **P3 — model** | Natural-key catalog fingerprint + structured drift diff; N-plan feature-delta model with a baseline; name resolution. All pure, all unit-tested |
| **P4 — UI** | Route `/plans/compare?plans=…`, SSR frontmatter, island, `<Table>` scoreboard (carrying both rendering invariants), drift banner, verdict block, `MultiSelect` picker + Plans-hub entry point |
| **P5 — verify** | E2E: pick two plans → scoreboard renders; drifted pair → banner; `pnpm check` / steiger / build |
