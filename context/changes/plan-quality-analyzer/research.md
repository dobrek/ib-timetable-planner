---
date: 2026-07-12T22:34:06+0200
researcher: Claude (Fable 5)
git_commit: f12aa0fda81fc58166dc8a52bdacdd5749532ac1
branch: main
repository: 10xdev3 (ib-timetable-planner)
topic: "Plan-quality analyzer — feasibility, what's needed, and how it can surface in the app (dev tool vs in-app KPIs vs comparison page)"
tags: [research, codebase, plan-quality-analyzer, generation, objective, entities-timetable, kpi, bench, feasibility]
status: complete
last_updated: 2026-07-12
last_updated_by: Claude (Fable 5)
last_updated_note: "Follow-up 7: cross-cohort patterns — 16/17 teachers teach both cohorts; expert halves cohort switches (86 vs 180, 63% back-to-back), keeps 49% vs 28% cohort-pure teacher days, anti-batches subject editions; all 10 mirrored cells = the school skeleton incl. NEW Polish A Monday-morning fixture (parallel staffing KK/MD); mirrored-cell census = automatic fixture detector"
---

# Research: Plan-quality analyzer — feasibility, needs, and integration options

**Date**: 2026-07-12T22:34:06+0200
**Researcher**: Claude (Fable 5)
**Git Commit**: f12aa0fda81fc58166dc8a52bdacdd5749532ac1
**Branch**: main
**Repository**: 10xdev3 (ib-timetable-planner)

## Research Question

Take the plan-quality analyzer described in `context/changes/generation-quality-tuning/discovery-notes.md` §6 (a read-only feature extractor that measures plan quality for any plan — human-made or generated) as a new change. Check feasibility and needs: what is needed to build it, and how can it be part of the application — as a dev tool, or as KPIs next to the plan? What options do we have?

## Summary

**Feasible, and cheaper than the discovery notes assume.** The metrics core the analyzer needs already exists as pure, exported, framework-free functions in `src/entities/timetable/model/generation/` — three of the nine candidate features (slot count, interior holes, student gaps) are shipped functions, four more (time-of-day, daily load, teacher gaps, completeness) are derivable from the same input shape with new pure functions, and the whole-board hard-rule oracle (`verifyGeneration`) comes for free. Both human-made and generated plans already reduce to the exact same input shape the extractor needs (`{cohort, courseId, day, period, week}` rows + `GroupingCourse[]`), via `assembleGeneratorSnapshot` on the client or a DB load server-side.

**Two real gaps, both input-side, not extractor-side:**

1. **Subject identity never reaches the generation types.** `GroupingCourse` carries `{id, teacherKeys, studentKeys, hours, weekMode}` — no subject, no level. Same-subject adjacency and fragmentation (the expert's headline rule) need `courses.name`/`level` threaded into an analyzer input projection (recommended) or parsed from the display-only composite name (fragile).
2. **No expert "gold" plan exists anywhere.** The only baseline is the tacit "48 of 50" figure; the archive explicitly records that manual per-cohort boards are not recoverable. The schema supports gold plans perfectly (a plan is just `plans` + `placements` rows; no generated-vs-manual flag exists; `clone_plan(p_include_board=false)` yields identical catalog inputs) — but someone must **enter** the expert board, and there is no import path (exports only).
   **⟶ Superseded by Follow-up 2 (2026-07-12):** the gold plan *does* exist — in the **production** database, plan id `fefd03e5-fc72-4706-8a12-524811c9cf3f` (author-provided). The gap shifts from *entry* to *acquisition/access*, and the author additionally reports the generator cannot produce anything close to it **nor anything truly valid** — see the follow-up section for how this reprioritizes the analyzer.

**Integration options (all share one pure extractor in `entities/timetable`):**

- **A. Dev-side runner (bench-style)** — extend the existing `bench/generation.bench.ts` pattern to load two plans and print the §6 side-by-side table. Fastest route to the ranked-terms list; strongest precedent; smallest effort.
- **B. KPI strip in plan-detail** — live quality metrics next to the board, following `PlanSummaryBar` / `GenerationSummaryPanel` precedents. Best long-term surface, but premature before the expert calibration tells us *which* features matter.
- **C. Read-only comparison page** (`/plans/[id]/compare/...`) — follows the student/teacher perspective-view precedent exactly; renders the expert-vs-generated table in-app, self-serve for the expert. Middle effort, highest leverage for the elicitation conversation (§7 of the notes).
- **D. Astro Action + persistence** — only needed if feature vectors should be stored (KPI history); skip for MVP. A browser-DevTools/Astro-dev-toolbar approach is a poor fit (no precedent in repo, and the analyzer needs DB-backed plan data).

**Suggested sequencing**: pure extractor (Phase 1) → dev runner A for the diff numbers (Phase 2) → expert elicitation with numbers in hand → then invest in C and/or B for the surface once features are validated. Options B and C reuse the extractor and most of the table rendering, so nothing built in Phase 1–2 is throwaway.

## Detailed Findings

### 1. The metrics core is analyzer-ready

The generation core is split cleanly: pure entity core in `src/entities/timetable/model/generation/` (objective, verify, types, deficits, occupied-slots, run, greedy engine) and page wiring in `src/_pages/plan-detail/model/generation/` (worker, protocol, snapshot assembly, hook). A grep for Node/DOM globals across the entity core returns nothing — it runs identically in a Web Worker, on the main thread, in Vitest (node), and in workerd SSR.

Existing metric functions:

- `countOccupiedSlots(placements)` — `src/entities/timetable/model/generation/occupied-slots.ts:5`. Distinct `(day, period)` cells; **per-cohort, never summed across cohorts**; week-agnostic.
- `countInteriorHoles(rows, days)` — `src/entities/timetable/model/generation/objective.ts:75-83`. Per-day span gaps (periods strictly between min and max used); cohort-level, week-agnostic.
- `countStudentHoles(courses, rows)` — `objective.ts:87-110`. Joins `row.courseId → course.studentKeys` (line 92), buckets into `student|day|week` lanes, **fans `both`-week rows into both `a` and `b` lanes** (line 94), adds span − occupancy per lane. Week-aware, per-student. This is the template every new per-entity gap metric should mirror.
- `deriveGenerationDeficits` — `model/generation/deficits.ts` (completeness/unplaced hours).
- `verifyGeneration(snapshot, generated) => {ok, reasons, softWarnCount}` — `model/generation/verify.ts:31`. Structural pass (catalog membership, bounds, week-mode consistency, duplicates, `verify.ts:40-61`) + oracle pass over the merged boards via the shared collision core (`verify.ts:64-98`). Pure; already called both off-thread (`generate.worker.ts:38`) and on the main thread (`use-cohort-board-state.ts:130`).

The `Objective` tuple `[unplacedTotal, holes, totalSlots, studentHoles]` (`objective.ts:17`) is assembled by `scoreCandidate` (`objective.ts:46-71`) over `rows = [...pins, ...generated]` per cohort (`objective.ts:56`) — exactly the "any plan" shape the analyzer wants. `compareObjectives` (`objective.ts:35-40`) loops over tuple length, so a graduated term needs no comparator change.

**Everything is already exported app-wide**: `src/entities/timetable/index.ts:18-26` re-exports `types`, `deficits`, `verify`, `occupied-slots`, `objective`, `run`, and the engine factory. No page/widget currently imports the counting functions (only the engine uses them internally; `verifyGeneration` has one external consumer at `use-cohort-board-state.ts:9,130`) — the analyzer would be the **first external consumer of the objective-style extractors, and the barrel already permits it.**

One design note: the objective is deliberately lexicographic (the weighted-scalar predecessor had a tier-bleed bug — see Historical Context). The analyzer is a **feature vector**, not a comparator — it should be a standalone extractor that *reports* per-feature numbers, not a piggyback on `scoreCandidate`'s tuple.

### 2. Feature-by-feature data availability

`GroupingCourse` — the only per-course shape reachable from the generation core (`src/shared/lib/catalog-hash/types.ts:18-25`) — carries `{id, teacherKeys[], studentKeys[], hours, weekMode}`.

| Candidate feature (notes §6) | Status | Source / gap |
|---|---|---|
| Slot count per cohort | **exists** | `countOccupiedSlots` (`occupied-slots.ts:5`) |
| Interior holes per day | **exists** | `countInteriorHoles` (`objective.ts:75`) |
| Student gaps per student-day | **exists** | `countStudentHoles` (`objective.ts:87`), week-aware |
| Completeness / unplaced hours | **exists** | `deriveGenerationDeficits` (`deficits.ts`) |
| Hard-rule compliance + soft warns | **exists** | `verifyGeneration` (`verify.ts:31`) |
| Teacher gaps | **new fn, data present** | mirror `countStudentHoles` over `teacherKeys` (a set — co-teaching supported, `builders.ts:38`; engine already indexes teachers cross-cohort, `engines/greedy/board.ts:43`) |
| Daily load balance | **new fn, data present** | rows + `GroupingCourse.hours`; variance of hours/day |
| Time-of-day distribution | **new fn, data present** | period ordinal (1–12); wall-clock only via hardcoded `src/entities/timetable/lib/period-times.ts:15` (P1 08:15 … P10 16:25) — **times are not persisted** |
| Same-subject adjacency / double periods | **new fn + DATA GAP** | no subject identity in `GroupingCourse` / `GeneratorSnapshot` |
| Subject fragmentation / per-day spread | **new fn + DATA GAP** | same gap |
| Room / assessment features | **impossible** | confirmed absent from schema, seed, and fixtures — scope out (matches notes §9) |

**The subject-identity gap in detail.** The DB has the data: `courses` carries `name` (e.g. `'Math AA'`, `'Polish A'`), `level` (free text: `HL`/`SL`/`AB`/`none`/combos), `group_index` (`src/shared/api/load-cohort-courses.ts:104-115`). But it is deliberately kept off the constraint/generation projection — it survives only as the display-only composite token `Physics-HL-1` built by `compositeName` (`load-cohort-courses.ts:182-186`) in the `courseDisplay` side map (`types.ts:16,38-39`), which is **not** part of `GeneratorSnapshot`. Note the source CSVs keep subject and level as *separate* columns (`data/dp1/teachers_subjects.csv`: `code, subject_name, level, group_index, hours`) — the clean key exists upstream and gets folded at seed time.

Three ways to close it:
1. **Analyzer-own input projection (recommended for this change)** — the analyzer takes its own richer course projection (`{id, name, level, groupIndex, teacherKeys, studentKeys, hours, weekMode}`) built from data `loadCombinedPlannerData`/`load-cohort-courses.ts` already fetches. Keeps `GeneratorSnapshot` and the engine untouched; matches the "port the mechanism, model on app-native types" lesson.
2. **Parse the composite `courseDisplay.name`** — zero plumbing but fragile (display format is not a contract).
3. **Extend `GroupingCourse`** — required later *only if* a subject feature graduates into an `Objective` tier (the engine must see what it optimizes). ⚠️ `GroupingCourse` lives in `shared/lib/catalog-hash` and feeds the catalog hash used for grouping persistence/staleness — verify whether the hash serializes all fields before extending (plan-time check).

Also open (notes §9, needs the expert): is "same subject" `name` alone, `name+level`, or a discipline above both (is `Math AA` adjacent-compatible with `Math AI`)? The grouping key decides the adjacency/fragmentation numbers.

### 3. Both plan kinds already reduce to one input shape

- **Persistence**: a plan's board is normalized rows — `placements` `(plan_id, cohort, course_id, day, period, week, is_optional, bundle_id)` with unique `(plan_id, cohort, day, period, course_id)` (`supabase/migrations/20260602185012_minimal_domain_schema.sql:116`, re-keyed `20260611180006`), plus `bundles` for cell identity (`20260624120000_bundles.sql:17`). **No `origin`/`generated_at`/`is_generated` flag exists anywhere** — generated boards are applied through `apply_generated_placements` (`20260711202237`), which reuses the manual `place_course` bundle logic, so a gold plan and a generated plan are byte-identical in schema.
- **Client-side**: `assembleGeneratorSnapshot` (`src/_pages/plan-detail/model/generation/assemble-snapshot.ts:26-38`) already turns *any live board* (human-edited included) into a `GeneratorSnapshot`. `scoreCandidate` scores `pins + generated` — with `generated = []`, pins-only scoring **is** human-plan scoring.
- **Server/dev-side**: `bench/generation.bench.ts:69-95` (`loadSeedPlanSnapshot`) already assembles a real-catalog snapshot from the local DB via the production `loadCohortCourses` — the exact loader a two-plan analyzer runner needs.
- **Grid/time model**: `plans.slot_grid_preset` `"5x10"` parsed at `src/shared/lib/grid/grid.ts:27`; day/period are ordinals (1..7 / 1..12); week enum `both|a|b`; cohort a native enum on every row.

### 4. Gold plans: the missing input (and the workflow that fixes it)

> **⟶ Superseded by Follow-up 2 (2026-07-12):** the gold plan exists in the production DB (id `fefd03e5-fc72-4706-8a12-524811c9cf3f`). The findings below about *schema support* and the *clone/compare workflow* stand; the "must be entered manually / no import path" conclusion no longer gates the change — acquisition options are in the follow-up.

- The archive is explicit: *"The manual plan's per-cohort occupied-slot counts are not recoverable locally: the seed carries no manual board"* (`context/archive/2026-07-11-plan-generation/change.md:106-108`). The only figure is "48 of 50" (`frame.md:13-16`), and the bench's dp1 ≤ 50 bar is a deferred stand-in "until checkpoint 2.8 real manual counts" (`bench/generation.bench.ts:13-21`).
- The intended comparison workflow already exists end-to-end: **clone the real plan catalog-only** (`clone_plan` RPC with `p_include_board=false`, `src/_pages/plans-list/api/clone-plan.ts:18`, migration `20260711174905_clone_plan_include_board.sql`), generate onto the clone, and compare the two plans over identical `courses`/`teachers`/`students`/`student_choices`. This was the original plan-generation intent (`plan-generation/plan.md:26-29,331-335`).
- ⚠️ **Clone re-mints every UUID.** Aggregate features (counts, variances) compare fine, but any per-course/per-subject drill-down across the two plans must join on composite identity `(cohort, name, level, group_index)`, not `courseId`.
- **There is no board import path** (xlsx exports exist; imports don't). The expert's gold board must be entered manually via the board UI into a plan of its own — acceptable once, but if multiple gold plans are wanted, a small import script becomes its own scope item.
- `data/out/dp*-variants-2.csv` are grouping-enumeration outputs, **not** gold boards — don't mistake them for expert plans.

### 5. Integration surfaces — precedent inventory

- **Bench/dev-runner precedent (closest existing "quality metrics over a real plan" tool)**: `pnpm bench:generation` (`package.json:19`) → `vitest.bench.config.ts` (node env, real catalog from local Supabase, stubs `astro:env/server` / `astro:actions`) → `bench/generation.bench.ts` — prints per-cohort slots vs bar, unplaced, day-edge holes, elapsed. Runs in CI as a **non-blocking job** (`.github/workflows/ci.yml:84-100`). `scripts/` holds host-side Node tools (`gen-seed.mjs`, `provision-e2e-author.mjs`) — but a TS analyzer over entity code is far easier as a vitest-config runner (aliases + TS handled) than as an `.mjs` script.
- **KPI-like UI precedents in plan-detail**: `PlanSummaryBar` ("N hours left · M over" + parked badge, `ui/chrome/PlanSummaryBar.tsx:31-64`), `GenerationSummaryPanel` (dismissible post-solve strip: per-cohort `slots N → M`, unplaced list, elapsed/optimal/soft-warns — `ui/chrome/GenerationSummaryPanel.tsx:21-70`; ephemeral, auto-dismissed on next edit, `use-generate-plan.ts:71-86`), `LensBar` match-count chips (`PlannerBoard.tsx:262-267,321-332`), `HoursCounter` on palette chips (`ui/palette/HoursCounter.tsx:14-28`).
- **Read-only derived-view precedent**: perspective routes `src/pages/plans/[id]/students/[studentId].astro:13-16` (SSR `Promise.all` loaders → error mapping → island) with slim page slices (`_pages/student-plan-view/`: `api/loader.ts` + `ui/`) rendering shared `widgets/timetable-board` components; derivations are plain render-time calls into pure entity functions (`StudentPlanPage.tsx:25-52`).
- **Pure-computation shipping precedent (exports)**: three-layer split — pure sheet builders in `entities/timetable/model/export/`, pure page-lib assembly (`_pages/plan-detail/lib/export-workbook.ts:56-75`), leaf UI binds the heavy library (`ui/chrome/ExportMenu.tsx:2-3`). Heavy inputs travel as SSR props kept **off the drag hot path** (`lib/batch-export-workbooks.ts:15-18`).
- **Server compute precedent**: `defineDomainAction` (`src/shared/lib/actions/define-domain-action.ts:13-26`) and the one-shot compute→persist→return pattern in `grouping-compute.ts:21-26`.
- **Routing/auth**: deny-by-default middleware (`src/middleware.ts:7-11,40-42`) means any new page/endpoint is auth-gated with zero middleware change.
- **No dev-mode machinery exists**: zero `import.meta.env.DEV` usages, no feature flags, no dev-only routes, no Astro dev-toolbar apps (`astro.config.mjs:58-81`). A "DevTools panel" would be a first-of-kind mechanism in this repo, whereas options A/B/C all extend existing mechanisms.
- **FSD placement**: steiger runs the stock recommended ruleset only (`steiger.config.ts:1-5`); the entities-vs-page-model split is convention (CLAUDE.md hard rule + barrel headers). Widgets sit below pages and render what they're given (`widgets/timetable-board/index.ts:1-8`) — a shared feature-table component could live there if both B and C need it.

### 6. Options analysis — how the analyzer can be part of the application

All options depend on the same Phase-1 core: a pure extractor in `entities/timetable` (e.g. `model/analysis/` with one concept file per metric + barrel, per repo convention): `analyzePlan(input) → PlanQualityFeatures`, input = placement rows + the richer course projection from §2. Unit tests mirror `objective.test.ts` builders (`__fixtures__/builders.ts:23`).

**Option A — dev-side analyzer runner (the "microscope"; recommended first surface).**
A vitest-config runner (like `bench/plan-quality.ts` beside `generation.bench.ts`) that loads **two named plans** from the local DB (reusing the `loadSeedPlanSnapshot` assembly pattern + `load-placements.ts`), runs the extractor on both, and prints the §6 side-by-side table (optionally as markdown for pasting into the change notes).
- *Pros*: smallest effort; directly produces the ranked-list-of-missing-terms artifact the parent change needs; strongest precedent; can join CI as a second non-blocking job later.
- *Cons*: dev-only (requires local stack + the gold plan entered); invisible to the planner; per-run, not live.

**Option B — KPI strip/panel next to the plan (in-app, live).**
A read-only chrome component in plan-detail (sibling of `PlanSummaryBar`/`GenerationSummaryPanel`) fed by a memoized model-hook derivation over `assembleGeneratorSnapshot` output. Extraction is O(rows) over ≤ ~500 placements — trivially inside budget, but follow the batch-export precedent and recompute on settle, not per drag tick.
- *Pros*: quality feedback while editing (the planner sees adjacency/gap counts move as they drag); becomes the natural A/B surface once terms graduate into the engine ("generate with/without term, watch the KPIs").
- *Cons*: **premature before calibration** — the analyzer's entire purpose is to discover *which* features matter and what "good" values are; uncalibrated KPIs can mislead. UI investment is also the largest of the three.

**Option C — read-only comparison page (in-app, expert-facing).**
`/plans/[id]/compare/[otherId]` (or `?with=`), cloning the perspective-view pattern: SSR `Promise.all` of two plans' placements + catalogs, features computed server-side (pure functions are workerd-safe) or at render, side-by-side feature table (+ optionally two mini read-only boards via `widgets/timetable-board`). Auth comes free from middleware.
- *Pros*: implements the §6 "expert vs generated table" **in the product**, self-serve for the expert — turns the §7 elicitation session into "look at this page together"; durable (any two plans, not just gold-vs-generated); moderate effort.
- *Cons*: more work than A; per-subject drill-down needs the composite-identity join from §4; still gated on the gold plan existing.

**Option D — Astro Action / persistence (defer).**
Only needed if feature vectors should persist (KPI history over plan versions, dashboards). The compute needs no server: it's pure, cheap, and the data is already client-side on plan-detail and SSR-side on any new page. If persistence is ever wanted, `grouping-compute.ts` is the pattern. Skip for MVP.

**On "DevTools" specifically**: a browser-DevTools/Astro-dev-toolbar surface is the weakest fit — no precedent in the repo, dev-toolbar exists only under `astro dev`, and the analyzer's inputs are DB-backed plans, not page internals. The meaningful "dev tool" incarnation is Option A.

**Suggested sequencing** (mirrors notes §11 and keeps every step additive):
1. **Phase 1** — pure extractor + tests (`entities/timetable/model/analysis/`), with its own input projection carrying subject/level.
2. **Phase 2** — Option A runner; enter the gold plan (manual board entry into a dedicated plan; catalog-only clone for the generated counterpart); produce the first expert-vs-generated table.
3. **Expert session** — walk notes §7 with numbers in hand; decide subject-identity grouping and tier-ordering questions.
4. **Phase 3** — Option C if the expert/authoring workflow is the driver, Option B once features are validated; both reuse the Phase-1 extractor and can share a feature-table component (widget if shared).

Phases 1–2 fit comfortably in this change; Phase 3 can be its own follow-up change informed by the expert session — that decision doesn't need to be made now.

### 7. Performance & runtime constraints

- The entity core is Workers-safe by construction (structured-clone-safe snapshot fields asserted at `types.ts:11-13`); the extractor inherits this — usable in worker, island, SSR, and vitest without adaptation.
- The <200ms drag budget (CLAUDE.md) is not threatened: feature extraction is a linear pass over placements. Still, keep in-app KPIs on a settled-state derivation (the `use-board-derivations.ts` / batch-export-prop precedent), not the drag hot path.
- A bench-style runner must stub `astro:env/server` / `astro:actions` — `vitest.bench.config.ts` already shows how.
- Engine A/B for graduated terms is already possible per-call: `createGreedyEngine({stagnationMs, diversifyAttempts})` (`engines/greedy/search.ts:52-70`) + per-call `budgetMs`; direct engine calls must go through `runVerifiedGeneration` (`run.ts:16-31`) — pins-only precondition (refactor impl-review F1).

## Code References

- `src/entities/timetable/model/generation/objective.ts:17` — `Objective` tuple; `:35-40` `compareObjectives`; `:46-71` `scoreCandidate`; `:75-83` `countInteriorHoles`; `:87-110` `countStudentHoles` (the pattern for new gap metrics)
- `src/entities/timetable/model/generation/occupied-slots.ts:5` — `countOccupiedSlots` (per-cohort, never summed)
- `src/entities/timetable/model/generation/verify.ts:31` — `verifyGeneration` oracle; `:40-61` structural pass; `:64-98` collision-core pass
- `src/entities/timetable/model/generation/types.ts:16-49` — `GeneratorSnapshot` / `GeneratorCohortSnapshot` / `GeneratedPlacement`
- `src/entities/timetable/index.ts:18-26` — barrel already exports the whole generation module app-wide
- `src/shared/lib/catalog-hash/types.ts:18-25` — `GroupingCourse` (no subject/level — the data gap)
- `src/shared/api/load-cohort-courses.ts:104-115,182-186` — DB `name`/`level`/`group_index` and the display-only `compositeName` fold
- `src/entities/timetable/lib/period-times.ts:15` — hardcoded wall-clock times (not persisted)
- `src/_pages/plan-detail/model/generation/assemble-snapshot.ts:26-38` — live board → snapshot (human-plan input path)
- `bench/generation.bench.ts:69-95` — real-catalog snapshot assembly from local DB (dev-runner input path); `:13-21` deferred manual-count bar
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:116` — `placements`; `20260624120000_bundles.sql:17`; `20260711202237_apply_generated_placements.sql` — generated boards use the manual write path (no origin flag)
- `src/_pages/plans-list/api/clone-plan.ts:18` + `supabase/migrations/20260711174905_clone_plan_include_board.sql` — catalog-only clone (same-inputs comparison; re-mints UUIDs)
- `src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx:31-64`, `GenerationSummaryPanel.tsx:21-70`, `PlannerBoard.tsx:262-267` — KPI-UI precedents
- `src/pages/plans/[id]/students/[studentId].astro:13-16` + `src/_pages/student-plan-view/ui/StudentPlanPage.tsx:25-52` — read-only comparison-page precedent
- `src/shared/lib/actions/define-domain-action.ts:13-26`, `src/_pages/plan-detail/api/grouping-compute.ts:21-26` — server-compute precedent (Option D only)
- `src/middleware.ts:7-11,40-42` — new routes auth-gate automatically
- `src/entities/timetable/model/generation/objective.test.ts` + `__fixtures__/builders.ts:23` — test templates for the extractor

## Architecture Insights

- **The refactor's payoff is real**: the objective is engine-agnostic and barrel-exported precisely so "a second engine and the bench score against the same tiers" (`objective.ts:6-11`). The analyzer is the third consumer that design anticipated — it should live beside the objective, not inside it (feature *vector* ≠ lexicographic *comparator*).
- **Rows + course-projection is the universal plan shape.** Pins-only rows are a human plan; pins+generated is a machine plan; the DB rows load into the same shape. The extractor should take `{rows, courses, days, periods}` — not a `GeneratorSnapshot` — so it never depends on engine types it doesn't need (and per the "port the mechanism" lesson, model its course projection on app-native fields).
- **Identity vs display is already a guarded boundary**: subject/level being display-only in the planner types is a deliberate separation. The analyzer needs subject as *identity* — thread it as first-class fields in the analyzer projection, don't parse the display token.
- **Every surface extends an existing mechanism**: bench runner (A), chrome panel + model derivation (B), perspective-view route (C). No new infrastructure category is required unless persistence (D) is chosen.
- **Convention fits**: one concept file per metric + pure barrel (`model/analysis/`), declarative pipelines for the counting functions, exported function first, `.ts` only.

## Historical Context (from prior changes)

- `context/archive/2026-07-12-generation-engine-hardening/change.md:22-24` — the weighted-scalar objective had tier bleed (`studentHoles` outvoting the slots tier); Phase 2 replaced it with the ordered tuple. Cautionary tale for any analyzer "score" aggregation — report the vector, don't scalarize.
- `context/archive/2026-07-11-plan-generation/change.md:31-34` + `frame.md:100-108` — the tier ordering was an **author decision, contested at frame time** ("48 slots is a guardrail, not the goal"), never measured. The analyzer's highest-value output is testing whether the dominant tier is even right (notes §5).
- `context/archive/2026-07-11-plan-generation/change.md:70-116` — CP-SAT spike evidence behind "~1–2 dp1 slots headroom": dp1 clique lower bound exactly 48; warm-started CP-SAT reached 49 (proven bound 46); dp1=48 "appears unreachable". Don't chase `totalSlots`.
- `context/archive/2026-07-12-generation-engine-refactor/change.md:93-97` + `plan.md:33` — the ~6.7s convergence / 60s plateau was measured with the committed bench (5 consecutive runs, dp1=49/dp2=46); more compute is not the lever.
- `context/archive/2026-07-12-generation-engine-refactor/plan.md:38-45` — deferred items this change inherits: CP-SAT engine, `studentHoles`-targeting move operator, week-aware hole/slot metrics.
- `context/archive/2026-07-11-plan-generation/change.md:106-108` — manual boards unrecoverable; "48 of 50" is the only manual figure; bench bar tightening waits on real manual counts (checkpoint 2.8) — the gold-plan entry in Phase 2 would finally unblock this too.
- `context/archive/2026-07-11-day-scoped-course-rules/change.md:18-26` — `finishes_early` edge placement is a **hard rule** (validated like a collision), 2/day cap warns; so "day-edge quality" is enforced, not scored — the analyzer measures *soft* dimensions beyond these.
- `context/changes/generation-quality-tuning/discovery-notes.md` — the parent seed; this change is step 2 of its §11 path (build the analyzer before touching the engine). §6 fixes the output shape (side-by-side table → ranked terms); §9's open modeling questions are carried into Open Questions below.

## Related Research

- `context/changes/plan-quality-analyzer/comparison-report.md` — **the consolidated golden-vs-generated quality report** (folds Follow-ups 2–5 into scoreboard + ranked findings + recommendations; the artifact the analyzer will eventually produce automatically)
- `context/changes/generation-quality-tuning/discovery-notes.md` — parent discovery notes (the analyzer spec seed, §6)
- `context/archive/2026-07-11-plan-generation/research.md` — engine feasibility research (objective priorities, CP-SAT, worker architecture)
- `context/archive/2026-07-06-student-plan-view/research.md` — read-only perspective-view feasibility (the Option C pattern)

## Open Questions

1. **Subject identity key** — is "same subject" `courses.name` alone, `name+level`, or a discipline above both (`Math AA` vs `Math AI`)? Expert input required; decides the adjacency/fragmentation grouping. (Notes §9.)
2. **Gold plan entry** — ~~is one-time manual board entry by the expert acceptable, or do we need an xlsx/CSV board-import script (new scope)? No import path exists today.~~ **Resolved (Follow-up 2)**: the gold plan exists in prod (id `fefd03e5-…`). Replaced by: pull it into the local stack (single-plan copy script / filtered dump) or point the analyzer runner at prod read-only — see Follow-up 2 acquisition options.
3. **Cross-plan drill-down identity** — confirm `(cohort, name, level, group_index)` as the join key across cloned plans (clone re-mints UUIDs); aggregates don't need it, per-subject diffs do.
4. **Persist feature vectors?** — ephemeral computation suffices for A/B/C; persistence (Option D) only if KPI history becomes a requirement. Default: no.
5. **Which in-app surface first (B vs C)** — decide *after* the Phase-2 diff and expert session; C serves the elicitation workflow, B serves day-to-day authoring.
6. **Metric granularity & week handling** — per-student vs cohort vs teacher level per metric, and how `both`/`a`/`b` rows count toward adjacency (mirror the `countStudentHoles` fan-out?). (Notes §9.)
7. **`GroupingCourse` extension risk (only if terms graduate)** — does the catalog hash serialize all fields of `GroupingCourse`? Must be checked before extending the type, or groupings' staleness detection may misfire.

## Follow-up Research 2026-07-12T22:44+0200

**Question**: beyond the §6 candidate list, what metrics could the analyzer gather? E.g., average number of students per slot — and what else?

### A sorting principle first: input-invariant vs placement-sensitive

On a **complete** plan (all hours placed — tier 1 of the objective already enforces this), several plausible-sounding aggregates are fixed by the catalog and carry **zero placement signal**:

- Σ over occupied slots of (students in that slot) = Σ over placed course-hours of enrollment = **total enrolled student-hours — a catalog constant**.
- Therefore **average students per slot = (fixed constant) ÷ occupiedSlots** — a monotone transform of the existing tier-3 slot count. Two complete plans with equal slot counts have *identical* averages, no matter how differently they're arranged.
- Same class: total teacher-hours, total hours per course, per-student weekly hours — all catalog constants.

The signal lives in the **distribution**, not the mean: a plan averaging 45 students/slot can hide a P9 slot serving 8 students — exactly the "we're burning a whole period for a handful of students" observation a human planner makes. So the user-proposed metric survives in sharpened form: **students-per-slot distribution** (min, p10, median, variance) and a **thin-slot count** (slots below a threshold share of the cohort). The same sharpening applies throughout the catalog below: report distributions and worst cases, not just totals — totals are where the signal goes to die (and the fairness questions in notes §7g are explicitly about worst cases).

Corollary for the diff workflow (§2b of the notes): because expert and generated plans share identical inputs, unnormalized counts are directly comparable — normalization is only needed where a metric would otherwise be dominated by a catalog constant.

### A second correction: the headline adjacency metrics do NOT need the subject key

The main research body classified same-subject adjacency/fragmentation as gated on subject identity. That was too pessimistic. **A student takes at most one course per subject**, so a *student's* experience of "two of the same subject in a row" / "gap between two of the same subject" is a **same-`courseId`** phenomenon — computable today from placement rows alone. Cross-course same-subject adjacency (Math AA group 1 at P3, group 2 at P4) involves *different students* and is unlikely to be what the expert's rule means.

The subject key (§2 options) is still wanted, but its role shrinks to **aggregation and reporting**: rolling course-level numbers up to subject level ("Sciences average period 7.2"), time-of-day-by-subject profiles, HL/SL contrasts, and the T3 rules below. That means the highest-value metrics ship in v1 with zero schema/plumbing work, and the subject-key decision stops blocking the expert diff.

### Metric catalog

Readiness tiers: **T1** = computable now from rows + `GroupingCourse` (+ `BoardAvailabilityCell` availability, `finishesEarlyByCourseId`, `course_groupings.opposite_week`, verify outputs); **T2** = needs subject/level threaded in (§2); **T3** = needs expert-supplied classification that exists nowhere (heaviness weights, subject-pair rules) — elicitation output, representable as an analyzer-local config map, no schema change.

**Board / cohort lens** (all T1):

| Metric | Definition | Informs (notes ref) |
|---|---|---|
| Occupied slots per cohort | exists — `countOccupiedSlots` | §5 tier ordering |
| Interior holes per day | exists — `countInteriorHoles` | §7c |
| Edge-free profile | free slots at day edges vs mid-day; first/last occupied period per day; day span | the manual plan's stated quality ("48 of 50, free slots at the edges", `frame.md:13-16`) |
| Daily load balance | hours-per-day and slots-per-day variance across the week | §7d "even daily load" |
| Students-per-slot distribution | min / p10 / median / variance + thin-slot count (below threshold share of cohort) | slot "cost efficiency"; new |
| Parallelism per slot | courses-per-occupied-slot distribution (bundle sizes) | how well groupings pack; new |
| Week-lane symmetry | A-lane vs B-lane slot delta; count of cells differing between weeks | §7g week-to-week similarity |

**Student lens** (all T1; report per-student distribution + worst student, not only the sum):

| Metric | Definition | Informs |
|---|---|---|
| Student gaps | exists — `countStudentHoles` | §7c |
| Span efficiency | per student-day: hours ÷ span (1.0 = fully compact); note span = hours + holes, so report alongside holes, not as an independent tier | §7c |
| Max consecutive hours | longest unbroken streak per student-day | fatigue; §7g |
| Single-lesson days | student-days with exactly 1 hour | classic real-world irritant; new |
| Late finishes / early starts | per student-day, distance of last/first lesson from day edge | §7d |
| Days on campus | days with ≥1 hour per student | new; ask expert if it matters |
| Fairness spread | variance / max across students of each metric above | §7g "neither cohort/student gets all the bad slots" |

**Teacher lens** (all T1 — `teacherKeys` join mirrors `countStudentHoles`; co-teaching = sets):

| Metric | Definition | Informs |
|---|---|---|
| Teacher gaps | holes in each teacher's day (span − occupancy), week-aware | §7c/§7f — explicitly not modeled today |
| Teaching days / span | days-in count per teacher; first-to-last span per day | §7f "minimize span", "keep grouped" |
| Max consecutive teaching | longest teaching streak per teacher-day | §7f "limit consecutive hours" |
| Soft-unavailability hits | placements on `severity: soft` cells, per teacher (`availability-index.ts:10-15`); board-wide total already exists as `softWarnCount` | localizes the existing verify warn count |
| Cross-cohort alternation | adjacent periods where a teacher switches dp1↔dp2 | context-switch cost; new |

**Course lens** (T1 at `courseId` grain; T2 only for subject-level roll-ups):

| Metric | Definition | Informs |
|---|---|---|
| Same-course adjacency | consecutive same-course pairs within a day (double periods), per week lane (`both` fans out like `objective.ts:94`) | §7b — the expert's headline rule |
| Same-course same-day split | same course ≥2× in a day with a gap between — the expert's exact anti-pattern | §7b |
| Days-spread per course | distinct days used ÷ hours (4h on 4 days vs 2 days) | §7e; the §8 adjacency-vs-spread tension becomes measurable |
| Period consistency | distinct periods used per course / period variance (same time every day vs rotating) | §7d — ask expert which direction is "good" |
| Time-of-day profile | mean period per course; first/last-period occupancy counts | §7d (subject roll-up = T2) |
| Biweekly mirroring | for biweekly courses: a-lane and b-lane rows in the same cell? (paired via `course_groupings.opposite_week`) | §7g |
| Optional-hour placement | `is_optional` rows at day edges vs interior (do optional hours punch holes for non-attendees?) | new; nuanced — flag for expert |

**T3 — gated on expert classification** (collect during §7 elicitation; store as analyzer config, not schema): heavy-subject morning share (needs per-subject heaviness weights), discouraged back-to-back subject pairs, lab/practical double-period requirement conformance, subject-pair same-day balance (§7e).

Not includable at any tier: room stability / room changes and assessment-spacing metrics — no data exists (confirmed in §2), matching notes §8's data-availability warning.

### Implementation insight: one primitive powers ~80% of the catalog

Nearly every metric above is a small fold over one shared expansion: **rows → (entity, day, weekLane) lanes**, where entity ∈ {cohort, student, teacher, course} and `both`-week rows fan into both lanes — exactly what `countStudentHoles` already does for students (`objective.ts:92-95`). Per lane, the primitives are: sorted period list → span, holes, max streak, first/last, count. Gaps, spans, streaks, adjacency, splits, consistency, late/early — all derive from these. The slot-centric metrics (students-per-slot, parallelism) use the transpose (cell → occupants). So the extractor's core is one `expandLanes(rows, keyFn)` helper + one `laneStats` function, with each published metric a thin concept-file wrapper (matching the barrel convention and the declarative-pipelines lesson). This keeps the catalog cheap to extend when the expert reveals new rules — the marginal metric is a ~10-line fold, not a new traversal.

### Suggested v1 scope

Ship **all T1 metrics** in the extractor (once the lane primitive exists they're individually trivial), each reported as `{total, perCohort, distribution/worst}`. Defer T2 to the subject-key decision (it only affects roll-up labels, not the diff's power) and T3 to after the elicitation session. The v1 vector is already strictly richer than what the §7 expert conversation needs as input.

## Follow-up Research 2026-07-12T22:50+0200 — the gold plan exists in production

**New facts (author-provided):**
1. The expert gold plan **exists in the production database**: plan id **`fefd03e5-fc72-4706-8a12-524811c9cf3f`** (hosted project `hwmuiymhjgewtymymbmb`).
2. *"Currently we couldn't build anything which is close to it with the mechanisms that we have — and even anything that is truly valid."*

**✅ VERIFIED and IMPORTED (2026-07-12, author-authorized read-only prod access).** The plan is **"2026/2027"** (5x10 grid, created 2026-07-01) and has been fully copied into the local DB (all 15 plan-scoped tables, ids preserved — see `gold-plan-import.md` for the executed procedure). Measured facts:

| | dp1 | dp2 |
|---|---|---|
| **Gold occupied slots** | **48** | **47** |
| Gold placement rows | 113 | 135 |
| Engine (bench, 5 runs) | 49 | 46 |
| Clique lower bound (dp1) | 48 | — |

Week lanes: 234 `both` + 7 `a` + 7 `b` rows (biweekly in real use). `teacher_availability`: 125 rows across 10 teachers. Shelf: empty.

**The checkpoint-2.8 numbers land, and they cut both ways:**
- **dp1: the expert hit the provable optimum (48 = the max-weight-clique lower bound) — the engine has never gotten below 49.** The "~1–2 slot headroom" is real and the expert banks it by hand.
- **dp2: the expert uses MORE slots than the engine (47 vs 46)** — the exact §5 scenario the discovery notes warned about: on dp2 the engine out-minimizes the human and *still* produces a worse plan, so slot count is demonstrably not the human's dominant criterion there. The bench's dp2 = 46 "regression envelope" sits *below* the expert's own count.

**Discovery: the gold plan is the seed's descendant — and the catalogs have drifted.** The gold plan's UUID *is* the local seed's "Seed Plan A" id (deterministic seed ids; prod was seeded, renamed, then hand-built). But prod's catalog kept evolving: 17 teachers / 85 courses / 86 course_teachers / 609 student_choices / 125 availability rows vs the local seed's 18 / 84 / 85 / 548 / **0**. Consequences:
- **The bench has been running on stale inputs** — `bench/generation.bench.ts` assembles its snapshot from the seed catalog (and zero availability rows), which is no longer the gold catalog. The engine-vs-gold comparison must **regenerate on the gold plan's own catalog** (clone catalog-only → generate), not reuse bench numbers.
- **Local import replaced Seed Plan A** (same id, full delete+insert in one transaction; Seed Plan B and E2E plans untouched). `pnpm exec supabase db reset` restores the seed state — and erases this import; re-run the runbook after resets.
- ⚠️ **`bench:generation` breaks locally while the import is in place**: `loadSeedPlanSnapshot` looks the plan up **by the name "Seed Plan A"** (`bench/generation.bench.ts:69-95`), which no longer exists locally (it's "2026/2027" now). Design cue for the analyzer runner: target plans **by id or parameter, never by hardcoded name**.

### Implication 1 — the validity gap is tier-0, above every soft metric

"Not even truly valid" means one of two things, and the analyzer's **first** measurement distinguishes them cheaply:

- **(a) Hidden hard rules** (notes §7h): generated plans violate rules the expert holds but the oracle (`verifyGeneration`) doesn't know. The engine ships only oracle-verified boards, so if those boards are "invalid" to the expert, the oracle's rule set is *incomplete*.
- **(b) Mis-specified hard rules**: the gold plan itself violates the *current* oracle (e.g. the 2/day cap, the flagged-edge rule, week-mode consistency). Then the engine is searching inside a wrongly-shaped feasible region and can never reach gold — no soft-term tuning will fix that.

**Decisive first experiment: run `verifyGeneration` on the gold plan itself.** Gold fails the oracle ⇒ (b), with the failing reasons naming exactly which coded rules are wrong or too strict. Gold passes ⇒ (a), and every "this is invalid" complaint the expert makes about generated output becomes a candidate new hard rule (collect them during the §7h walk). This should run **before** any soft-feature diff — it is one function call once the gold plan is loadable, and it re-orders the whole tuning roadmap: hard-rule corrections dominate objective-tier work.

Consequence for the analyzer's shape: v1 output should include a **rule-verdict block** (structural reasons + per-rule violation counts + `softWarnCount`, both plans) alongside the feature table — not the feature table alone.

### Implication 2 — acquisition replaces entry (three options)

The plans-as-domain-root schema makes a plan fully self-contained (plan-scoped `courses`/`teachers`/`students`/`student_choices`/`placements`/`bundles`), so single-plan acquisition is well-defined:

- **(i) Run the analyzer against prod, read-only.** The bench pattern (`bench/generation.bench.ts:69-95`) already reads env-configured Supabase; pointing the runner at the hosted project (service-role key from the dashboard, or the `pnpm env:prod` profile + an authenticated session) needs no data movement. README already sanctions read-only prod smoke usage.
- **(ii) Pull the plan local once** — a small host-side copy script (read prod with service key → insert into local stack; `scripts/` precedent) or a filtered data dump. Local copy composes best with the tight generate→measure loop, which otherwise hammers prod.
- **(iii) Do the whole comparison *in* prod:** `clone_plan(p_include_board=false)` exists in the deployed schema (migration `20260711174905` ships via CI `db push`), and generation runs **client-side in the browser** — the author can clone the gold plan catalog-only and generate onto the clone in the production app today, no tooling. The analyzer then compares two prod plans via (i).

Recommended: (iii) + (i) for the first diff (zero new tooling beyond the runner's env flexibility), (ii) if/when the iterate-on-engine loop needs local speed.

### Implication 3 — checkpoint 2.8 unblocks as a side effect

The deferred "real per-cohort manual counts" (`bench/generation.bench.ts:13-21`, `refactor/change.md:65-67`) become measurable the moment the gold plan is readable: its per-cohort `count(distinct (day, period))` **are** those counts. The bench bars (dp1 ≤ 50, dp2 ≤ 46) can then be tightened from deferred stand-ins to the real manual figures — worth folding into this change's success criteria since the query is free once acquisition lands.

### Implication 4 — "not close" strengthens the notes' deepest warning

Notes §5 warned the expert's plan may reveal the *dominant tier is wrong*, not just that lower tiers are missing. "Couldn't build anything close" is consistent with that: if gold turns out to use *more* slots than generated output (per-cohort counts will tell), slot-minimization (tier 3) is actively steering away from expert quality, and if gold fails the oracle (Implication 1b), even tier-1 completeness is being optimized inside the wrong feasible set. Both are exactly the measurements the analyzer produces first.

**⟶ Now partially measured (see the verified table above): on dp2 this is no longer a hypothesis — gold uses 47 slots where the engine reaches 46, so the engine wins the slot tier and still loses the plan. On dp1 the opposite: gold reaches the provable 48-slot optimum the engine has never found. The tuple is simultaneously too weak (dp1: search can't find the slot optimum the human finds) and mis-prioritized (dp2: the slot tier outranks whatever the human actually optimizes). Caveat: engine numbers come from the stale seed catalog — re-run generation on the gold catalog before treating the deltas as exact.**

**⟶ Superseded by Follow-up 4: the caveat bit. On the gold catalog (availability active) the engine's dp2 = 47 *incomplete* — the 46 was a stale-catalog artifact, and the engine fails completeness outright (5 unplaced hours). See Follow-up 4 for the corrected evidence base.**

### Revised sequencing (updates §6's Phase 2)

1. Phase 1 unchanged — pure extractor + rule-verdict block.
2. Phase 2 becomes: point the runner at the gold plan (acquisition option i/ii) → **verify-gold experiment** (Implication 1) → per-cohort slot counts (Implication 3) → full feature diff vs a generated board on the cloned catalog (option iii).
3. Expert session (§7) now has three artifact classes in hand: rule verdicts, the tier-order evidence, and the soft-feature table.

## Follow-up Research 2026-07-12T23:39+0200 — the comparison rig is operational (workflow verified end-to-end)

The acquisition story closed out; this section records the working setup and the verified facts behind it.

### The three-plan local state (verified after a full `db reset` cycle)

| Plan | Id | Content |
|---|---|---|
| Seed Plan A | `fefd03e5-…` (deterministic seed id) | stale scrubbed catalog (18 teachers / 84 courses / 548 choices / **0 availability**), no board — regenerated by every reset; keeps `bench:generation` working |
| **Golden Plan** | `4bc9fe99-33ae-4c58-9b66-9b8477dad33f` | the expert reference: full gold catalog + board (dp1 = 48 / dp2 = 47), 125 availability rows — restored from `data/golden-plan.sql` |
| **Golden Catalog Clone** | `e67d3b63-d32c-4332-8f78-bd991b93ecd3` (disposable, re-mintable) | identical catalog (17/85/86/609 + 125 availability), **empty board** — the generation target |

**Verified cycle (2026-07-12):** `supabase db reset` → seed regenerates Seed Plan A/B at their deterministic ids (E2E leftovers gone) → `data/golden-plan.sql` restores Golden Plan with **zero collisions** (its clone-re-minted ids are disjoint from the seed's) and passes its embedded integrity assertions (248 placements / 609 choices / 125 availability / 2435 grouping members / dp1 = 48 / dp2 = 47) → `select clone_plan('4bc9fe99-…', 'Golden Catalog Clone', false)` produces the identical-catalog empty board. Catalog counts clone-vs-golden matched exactly on all 8 catalog tables; board tables 0 on the clone; golden untouched.

### The snapshot artifact: `data/golden-plan.sql`

- Single transaction: delete-any-existing-copy → 15 explicit-column-list inserts (`json_populate_recordset`) → integrity `do` block that aborts on any count/slot mismatch. Idempotent, atomic, fails loudly. Frozen column lists tolerate future added-with-default columns; dropped/renamed columns fail instead of corrupting.
- **LOCAL-ONLY, gitignored (`/data/golden-plan*.sql`), never commit** — it contains raw production data (real student/teacher names, the school's actual timetable). The committed `data/*.csv` fixtures were PII-scrubbed (see the `/pii-scrub/` gitignore precedent); this dump was not. Author decision 2026-07-12. If the local file is lost, **prod is the backup of record** (runbook Methods 1–3); the future backup tool must target private storage.

### Comparison-workflow facts (verified, load-bearing for the analyzer design)

1. **Generation needs no persisted groupings.** The Generate button is gated only on blocking violations / plan-complete (`use-cohort-board-state.ts:159-164`), and the snapshot is assembled from the per-course catalog projection (courses + course_teachers + student_choices), never from `course_groupings`. A fresh catalog-only clone is generation-ready immediately — "Compute groupings" is a manual-workflow (palette) concern only.
2. **Availability constraints carry into the clone** (catalog block 2b of `clone_plan` is unconditional), so the generator faces the same strong/soft teacher constraints the expert faced — the comparison is fair on constraints, not just on courses.
3. **Golden-vs-generated joins must use composite identity** `(cohort, name, level, group_index)` — every clone re-mints UUIDs. Aggregate metrics need no join at all.
4. **Clone-fresh discipline**: the diff's validity rests on "catalog identical at generation time"; make the clone immediately before generating and treat it as disposable (re-mint per engine variant for A/B).
5. **The bench numbers are not the baseline.** dp1 = 49 / dp2 = 46 were measured on the stale seed catalog with **zero availability rows**; the first generation onto the Golden Catalog Clone — 125 availability constraints active — produces the real engine baseline, and it may differ materially.

### Immediate next step

Open `/plans/e67d3b63-d32c-4332-8f78-bd991b93ecd3`, hit Generate, and record the diagnostics (per-cohort slots, unplaced, elapsed, soft warns) — that is the first true engine-vs-expert data point, and the input to the verify-gold experiment (Implication 1 above) once the analyzer's Phase 1 extractor exists.

## Follow-up Research 2026-07-12T23:55+0200 — first real engine-vs-expert measurement (the diff speaks)

The author generated onto the Golden Catalog Clone in the app; the boards were then compared in SQL (these ad-hoc queries are effectively the analyzer's v0 — every T1 metric below took minutes in plain SQL, validating the extractor's scope).

### The measured comparison

| Metric | Golden dp1 | Generated dp1 | Golden dp2 | Generated dp2 |
|---|---|---|---|---|
| Occupied slots | **48** | 47 ⚠️ | **47** | 47 ⚠️ |
| Placement rows | 113 | 109 | 135 | 134 |
| Unplaced hours | 0 | **4** (Chemistry HL) | 0 | **1** (EE) |
| Interior holes | 0 | 0 | 0 | 0 |
| Free slots at day START | **0** | 2 | **0** | 1 |
| Free slots at day END | 2 | 1 | 3 | 2 |
| Soft availability hits | **0** | 3 (board-wide) | **0** | — |
| Strong availability hits | 0 | 0 | 0 | 0 |
| Same-course adjacent pairs (lane-expanded) | **101** | 8 | **125** | 18 |
| Same-course same-day SPLITS | **0** | 27 | **0** | 40 |

⚠️ Generated slot counts are **not comparable** — the board is incomplete (5 unplaced hours); an incomplete board trivially uses fewer slots. Analyzer design requirement confirmed: **never print a slot count without completeness beside it.**

### Findings, ranked

1. **Same-course adjacency is the missing dominant term — and it may be a hard rule.** Expert: 226 adjacent pairs, **zero** same-day splits across 248 placements. Engine: 26 pairs, **67 splits**. The expert's stated heuristic ("no gap between two of the same subject") is an invariant in the gold plan, and the `Objective` tuple has no notion of it. This single dimension plausibly explains most of "nothing close" and much of "not truly valid." Encoding candidates per the notes' layer map: same-day-split as a hard rule in `verify.ts` (zero observed violations support hard) or as the top soft tier; "prefer doubles" as a further soft term.
2. **The engine fails tier 1 (completeness) on the real inputs.** 5 hours unplaced: Chemistry HL dp1 4/6, EE dp2 0/1. The bench never showed this — the seed catalog has **zero** availability rows; the real catalog has 125. Case study: Chemistry HL's teacher (code OT) has 10 strong-blocked cells (20% of the 5x10 grid); the expert places all 6 hours as **three double periods across three days** (d1 P9–P10, d2 P1–P2, d4 P7–P8 — exactly 2/day cap × 3 days), the engine placed 2 scattered singles (d1 P7, d4 P4) and gave up. The expert *proves* the instance feasible — this is a pure search failure, and note the mechanism: **doubles are how the hard case gets solved** (packing 2 h/day means 3 days suffice against OT's blocked grid), so adjacency and completeness are coupled, not competing.
3. **The expert treats soft unavailability as inviolable.** Zero soft hits in the gold plan; the engine took 3 (oracle-legal warnings). Candidate: soft availability is effectively hard for the expert, or carries a far higher penalty than "warning."
4. **Day-shape rule sharpened**: the folklore was "free slots at the edges of days"; the measurement says **day STARTS are never free** (both cohorts, every day starts at P1) — free capacity is banked exclusively at day **ends**. The engine left 3 day-start slots free. Candidate: construction bias or objective term penalizing free-at-start specifically.
5. **Interior holes: both plans are at zero** — tier 2 is adequate as-is on this instance.
6. **Correction to Follow-up 2 / Implication 4**: the "engine out-minimizes the expert on dp2 (46 vs 47)" story was a **stale-catalog artifact**. On the gold catalog with availability active, the engine reaches dp2 = 47 *and is still incomplete*. The tuple-mis-prioritization evidence now rests on the adjacency findings (a dimension the tuple lacks entirely), not on slot counts. dp1 stands: the expert's complete 48 = the clique optimum; the engine has never produced a complete 48.

### What this changes for the expert session (§7)

Three questions got answered by measurement before the conversation even happens: adjacency is (at least near-)inviolable; soft unavailability is respected absolutely; day starts are never free. The session should now *confirm classifications* (hard vs top-soft) rather than discover the rules, and probe the boundary cases: is a same-day split EVER acceptable? is a soft-unavailability hit acceptable under duress? must every day start at P1 even on a light day?

## Follow-up Research 2026-07-12T23:54+0200 — latent patterns mined from the human plan

Deeper probes of the Golden Plan's internal structure (author asked what else the human plan reveals). Ten additional patterns, ranked by expected impact.

### Big unmodeled dimensions (both larger than expected)

1. **Teacher compactness — the largest unmeasured gap of the whole diff.** Total teacher gap-slots (lane-expanded span − occupancy): golden **74** vs generated **345** — **4.7×**. The expert also gives teachers denser days (3.46 vs 3.21 h/teaching-day) across slightly fewer days-in (4.12 vs 4.35). The `Objective` tuple has **no teacher term at all** (notes §7c flagged it as unmodeled; now it's measured). Candidate: a `teacherHoles` tier, likely above `studentHoles` given the magnitude.
2. **Student experience: tier 4 is a major human edge.** Golden student holes **900** vs generated **1374** (−35%), single-lesson student-days **0 vs 4**, avg 5.71 vs 5.54 h/student-day. The tuple *has* this tier, but it's dead last and no LNS operator hunts it (the deferred `studentHoles`-targeting move). The human wins it decisively.

### Structural fixtures (inputs in disguise — candidates for PINS, not objective terms)

3. **The Advisory anchor**: the whole-cohort Advisory hour sits at **day 3 period 7 in BOTH cohorts simultaneously** — a synchronized school-wide fixture. No objective term can derive this; it's an input the school dictates.
4. **SSSTS is a morning fixture with cross-cohort week-alternation**: all its hours sit strictly in P1–P2, and it occupies the *same cells* (d3 P1–P2) in both cohorts with **opposite week lanes** — dp1 gets week A, dp2 gets week B, i.e. one teacher alternates cohorts weekly in a shared slot. The engine would never construct this (and it's only cross-cohort-legal *because* the weeks differ).
5. **Biweekly courses live as paired cells**: every `a` row has a `b` partner in the same cell — CAS(a)+EE(b) share cells throughout (the `opposite_week` grouping flag made physical). The engine left EE **unplaced** — these delicate pairings are exactly what it fumbles.
   → **Workflow implication**: fixtures 3–5 could be **pre-pinned on the clone before generating** (the engine honors pins); that alone might fix part of the completeness failure and is worth an A/B run.

### Shape rules (sharpen earlier findings)

6. **Free capacity is banked at the WEEK's tail, not just day ends**: Friday is short for both cohorts (ends P8); golden dp1's only free slots are Friday P9–P10, dp2's are Friday P9–P10 + one day-3 P10. Every other day runs P1→P10 completely full. Sharper candidate term: free-slot position weighted by (day-of-week, lateness).
7. **Thin slots are deliberate edge doubles.** All 6 low-coverage slots (≤25% cohort) are adjacent pairs of small courses (2–8 students: Physics-HL, Biology-SL+CS-SL, …) at day edges (P1–P2, P9–P10, P7–P8). Combined with golden's *lower* median students-per-slot (14.5 vs 17.0 on dp1): **slot-coverage density is NOT an expert objective** — placement of thin slots is. (Refines the Follow-up-1 thin-slot metric: measure *where* thin slots sit, not how many exist.)

### Time-of-day gradient (expert-confirmable heaviness map)

8. Golden's per-subject mean period orders cleanly: SSSTS 1.5 → ESS 2.5 → Polish A 3.5 → Physics/English A 4.5 → … → BM 6.0 → Geography 6.2 → Chemistry 6.3 → TOK/CAS/EE 6.4. National-language and skills subjects in the morning; TOK/CAS/EE (self-directed/pastoral) and several content-heavy electives in the afternoon. This is the empirical input for §7d's "heavy subjects" question — bring the table, let the expert label it.

### Negative results (kill candidate metrics — equally valuable)

9. **Fixed-period consistency REFUTED**: only 5% of golden's multi-day courses repeat the same period signature across days (engine: 11%). The expert rotates course times freely — "same time every day" is not a quality dimension here. Drop it from the v1 metric set.
10. **`is_optional` is unused** in both boards (0 rows) — drop optional-placement metrics from v1.

Bonus structural note: golden has only 41 multi-day courses vs the engine's 64 — the expert *concentrates* course hours into doubles on fewer days, which is the adjacency finding viewed from the day-spread axis (§7e's tension resolves decisively toward "adjacent within a day, fewer days").

## Follow-up Research 2026-07-13T00:13+0200 — engine-capability assessment: can GRASP+LNS reach expert parity, and is CP-SAT viable now?

Author's question after the measurements: *can the current algorithm reach the same level of accuracy — and can CP-SAT?*

### Part 1 — GRASP+LNS: mostly yes, with one hard reservation

The measured gap splits into two kinds, with different prognoses:

**Representational gaps (fixable in the current architecture).** Adjacency/splits, teacher gaps, soft-availability weight, week shape, fixtures — the engine doesn't optimize these because *it cannot see them*. Each is a modest change (new tier in `objective.ts`, optional targeted operator, pins) — the payoff of the engine-agnostic refactor. Once encoded, the accept-if-better loop should grind them down: they have dense local improvement moves. Expected: splits, teacher gaps, and soft hits collapse quickly once visible.

Two structural accelerants make this more hopeful than "add terms and pray":
- **No-splits is structure, not just a constraint**: constructing double periods as atomic placement units shrinks the combinatorial space, and the Chemistry-HL case shows doubles are *how* the expert solves hard instances (2 h/day × fewer days beats a 20%-blocked teacher). A doubles-first construction bias may improve completeness, not just adjacency.
- **Pinned fixtures scaffold the grid**: Advisory/SSSTS/CAS-EE pins remove decisions and anchor board regions before search begins.

**The search-power gap (the reservation).** The engine failed tier 1 — completeness, already its top priority — on the real inputs, and has never produced a complete dp1 = 48 although the clique bound proves one exists and the expert built one by hand. No new term fixes this (completeness is already dominant) and more time doesn't either (7 s plateau, measured). It is a neighborhood problem: day/random destroy operators are too blind to find coordinated multi-course rearrangements. And the frontier tightens as rules are added — every new hard rule shrinks the feasible space. **Estimate: the enriched greedy reaches "clearly good, expert-shaped plans"; *simultaneous* parity (complete + 48/47 slots + zero splits + zero soft hits) is a near-unique combinatorial design, and hitting it with stochastic local search is uncertain. That frontier is exact-solver territory.**

### Part 2 — CP-SAT: the archived "no" is stale; the new problem is much friendlier

The 2026-07-11 spike failed on a **different problem**: open-ended slot minimization — maximally symmetric (period permutations equivalent), weak propagation, ~25.5k booleans, inputs without availability rows, single-threaded wasm, 60 s. Close to CP-SAT's worst case. The findings transform the model in CP-SAT's favor:

- **More hard constraints help CP-SAT** (prune + propagate): no-splits, availability, 2/day, fixtures. Pins anchor whole regions.
- **Block structure**: doubles model as length-2 intervals — roughly halving decision variables for double-heavy courses.
- **Satisfy, not optimize**: the expert plan is a *feasibility certificate*. "Any complete board, all hard rules, ≤48/47 slots, zero soft hits" is a satisfaction problem — CP-SAT's home turf — and the expert board doubles as a warm-start/model-validation hint.
- **Unchanged**: the deployment constraints (single-threaded wasm in a worker, ~20 s interactive budget, progress/cancel issues from the spike). CP-SAT's biggest wins come from parallelism the browser doesn't offer.

### The pragmatic architecture: hybrid, with a cheap first step

Keep the greedy for interactive generation; add **CP-SAT as an exact repair operator**: freeze ~95 % of the greedy board, hand CP-SAT only the failed residual (e.g. Chemistry HL's 4 hours + a small neighborhood of movable placements). The residual model is tiny (solves in ms–s even single-threaded wasm), attacks exactly what the greedy demonstrably cannot do, and slots in architecturally as just another LNS repair step behind the same shared objective.

### Sequencing (unchanged by engine choice)

Encode the rules first — both engines optimize whatever the objective says; swapping engines before the objective is fixed optimizes the wrong thing faster. Then A/B the enriched greedy against the comparison-report scoreboard; reach for the CP-SAT residual-repair spike only if completeness or the 48-slot frontier still resists. `comparison-report.md` is the acceptance test for whichever engine gets there.

## Follow-up Research 2026-07-13T00:25+0200 — cross-cohort patterns: how the expert weaves dp1 and dp2

Author's question: is there structure in the *relation* between dp1 and dp2 placements? Previous measurements touched this only twice (teacher gaps were computed cohort-merged; SSSTS's week-alternation). Dedicated probes found five patterns.

### 0. The premise: the cohorts are one staffing system

**16 of 17 teachers teach BOTH cohorts** (1 dp2-only). dp1 and dp2 are not two independent grids that merely avoid clashes — they are one tightly coupled system, and cross-cohort structure is a first-class quality dimension.

### 1. Cohort-pure teacher days
The expert keeps **49% of teacher-days cohort-pure** (34 of 70); the engine only 28% (21 of 74). Where possible, a teacher's day belongs to one cohort.

### 2. Switches are halved — and seamless when they happen
Cross-cohort switches within a teacher's day: golden **86** vs generated **180**. Of the expert's switches, **63% are back-to-back** (adjacent periods, no idle gap) vs the engine's 45% (99 of its 180 switches strand the teacher in a gap). The rule reads: *minimize cohort switching; when unavoidable, hand off seamlessly.* This is a sharper, mechanism-level refinement of the teacher-gaps finding (74 vs 345) — gapped switches are where many of the engine's teacher holes come from.

### 3. Anti-batching of subject editions (motive unknown → expert question)
For the 20 (teacher, subject) pairs taught in both cohorts, the expert schedules the dp1-edition and dp2-edition on the **same day less often** (37 shared days) than the engine (54). Not explained by a daily-load cap — the load distributions are identical (max 7 h/day, same 6+-hour day counts). Candidate motives to ask the expert: spreading a subject's prep, student-side weekly rhythm, or a side effect of doubles-packing. Also a negative result: **no teacher daily-hour cap differentiates the plans** — drop that hypothesis.

### 4. The synchronized school skeleton (mirrored cells = the fixture family, plus one NEW fixture)
All 10 cross-cohort mirrored cells (same course name+level, same day+period, both cohorts) in the golden plan belong to one family — the school's shared weekly skeleton:

| Cell(s) | Structure |
|---|---|
| **Polish A SL — d1 P1–P2** | **NEW fixture**: simultaneous in both cohorts, *parallel staffing* (KK teaches dp1, MD teaches dp2), both weeks — a school-wide "national language Monday morning" block |
| Advisory — d3 P7 | simultaneous whole-cohort hour (known) |
| CAS / EE — d3 P8 and d5 P7 | **cross-paired week alternation**: dp1 d3P8 = CAS(a)+EE(b) while dp2 d3P8 = EE(a)+CAS(b) — the coordinators swap cohorts weekly in the same cells |
| SSSTS — d3 P1–P2 | cross-cohort week alternation, one teacher (known) |

The engine produced exactly **1** mirrored cell (accidental). The skeleton is unknowable from the catalog — it must arrive as **pins**; this extends the pre-pinning experiment from 3 fixtures to the full skeleton (Monday Polish block, Wednesday SSSTS morning + pastoral afternoon, Friday CAS/EE).

### Analyzer implications
Add a **cross-cohort metric family** to the T1 catalog (all verified cheap in SQL): teacher cohort-coverage census, cohort-pure-day ratio, switch count + back-to-back share, subject-edition day-sharing, mirrored-cell census. The mirrored-cell census doubles as a **fixture detector** — run on any future gold plan, it finds the school skeleton automatically.
