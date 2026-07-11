---
date: 2026-07-11T13:30:52+02:00
researcher: Claude (Fable 5)
git_commit: 088401719f99409a7d85811fb01364f2bb0aff2c
branch: feat/plan-generation
repository: ib-timetable-planner
topic: "Feasibility of an automatic plan-generation process (auto-placing course groupings onto the two-cohort grid, author reviews/tweaks)"
tags: [research, codebase, plan-generation, solver, cp-sat, constraint-core, grouping-algorithm, entities-timetable, cloudflare-workers, feasibility]
status: complete
last_updated: 2026-07-11
last_updated_by: Claude (Fable 5)
last_updated_note: "Resolved all open questions with the author + captured a new domain rule: early-finishing DP2 courses must sit at the edges of students' days (new course flag required)"
---

# Research: Feasibility of automatic plan generation

**Date**: 2026-07-11T13:30:52+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: `088401719f99409a7d85811fb01364f2bb0aff2c`
**Branch**: `feat/plan-generation`
**Repository**: `dobrek/ib-timetable-planner`

## Research Question

Check the feasibility of introducing a plan-generation process: the app generates a (near-)optimal complete plan and the author only reviews and makes minor changes. The current implementation (domain model, grouping algorithm, automated validations) may serve as the base, but should be treated as a reference, not a blocker — external techniques/technologies that solve this problem are in scope.

## Summary

**Feasible — and smaller than it looks, but the risk is not where the original non-goal assumed.** Auto-placement was ruled out at product inception as "the NP-hard scheduling problem" (`context/foundation/archive/2026-06-18-shape-notes.md:213`) and has been carried forward as a PRD non-goal ever since (`context/foundation/prd.md:463`, `context/foundation/roadmap.md:212`). That asymptotic argument does not survive contact with the actual instance size: **~39–45 courses per cohort, 50 slots, 18 shared teachers, 26–35 students, 116–138 course-hour placements per cohort**. Problems of this size are solved in seconds by modern CP solvers and in minutes by classic heuristics; the codebase's own validator evaluates a **full board in ~0.2–0.3 ms** (measured), and the full grouping enumeration for both cohorts completes in **under 100 ms** (measured).

Three pillars of the verdict:

1. **The evaluation infrastructure already exists and is excellent.** The pure constraint core (`src/entities/timetable/`) is a deterministic, workerd-proven, requirements-anchored feasibility oracle. The grouping enumeration is *exhaustive* (all maximal compatible sets, 173/495 per cohort — not top-N/lossy), fingerprinted for staleness, and shares its compatibility predicate with the validator so candidates can't drift from placement-time legality. The objective's raw material (`deriveHours`/`deriveUnplaced`) and a literal single-bundle auto-placer (`findDuplicateTarget`) already exist. Roughly: **candidate generation, feasibility checking, progress measurement, and persistence machinery are done; only the search loop in the middle is missing.**

2. **Two engine options fit the deployment envelope.** (A) A **pure-TypeScript constructive heuristic + local search** (most-constrained-first placement over the existing grouping pool, polished by simulated annealing/tabu, scored by the existing validator) — zero dependencies, runs in a browser Web Worker *and* on Workers (paid-plan CPU is raisable to 5 min via `limits.cpu_ms`), and is the same architecture UniTime chose explicitly for human-in-the-loop friendliness. (B) **CP-SAT compiled to WASM** (`or-tools-wasm` npm, Apache-2.0, ~2 MB gzip for the cp_sat module) running client-side in a Web Worker — gives provable optimality/infeasibility *with explanations* and native warm-start/pinning, at the cost of a young dependency (v0.9.x, single maintainer) and COOP/COEP header setup. Timefold-in-a-Cloudflare-Container (GA since 2026-04) is the held-in-reserve heavy option. LLM-direct generation is **not** credible for hard-constraint satisfaction (verified against 2025–26 benchmarks).

3. **The real gaps are domain/product, not algorithmic.** (a) There is **no objective function beyond completeness** — nothing in the domain says what makes one complete plan *better* (teacher gaps, student compactness, day balance). (b) There is **no spread/pattern constraint class at all**: nothing today prevents placing all 4 hours of one course into four periods of the same day — a human author avoids this instinctively, a generator will not, so without new "spread across days / max per day" rules the output will be *valid but unusable*. (c) A generated plan of ~254 placements has **no bulk persistence path** (writes are one `place_course` RPC per course-hour). (d) The PRD non-goal must be formally reversed. These are decisions and modest engineering, not research risks.

**Recommended shape** (detailed in Architecture Options below): define a swappable `generatePlan(snapshot, pins, budget) → placements[]` port; verify every generated board through `deriveCellViolations` regardless of engine; start with the pure-TS greedy + repair baseline (nearly assemblable from existing tested parts) and spike `or-tools-wasm` early to kill its unknowns; ship generate-then-review with pinning, warm-started from the current board.

## Detailed Findings

### 1. Prior decisions: what history actually says

- The workflow the product replaced — "algorithm output + manual Excel" — used a **standalone Bun/TypeScript grouping recommender**, not a plan generator. It emitted ranked *groupings* (which courses can share a slot) as CSV; a human always did the placement half in a spreadsheet (`context/foundation/archive/2026-06-18-prd.md:24,156,174`). Its outputs survive as golden fixtures (`data/out/dp1-variants-2.csv`, `data/out/dp2-variants-2.csv`); its logic was ported deterministically in `2026-06-04-port-grouping-algorithm`.
- Auto-placement has been an explicit non-goal in every PRD and roadmap revision: `context/foundation/prd.md:463`, `context/foundation/roadmap.md:212` ("Why parked: PRD §Non-Goals"), `context/foundation/archive/2026-06-18-prd.md:174`, with the stated rationale being NP-hardness (`archive/2026-06-18-shape-notes.md:213`). **No attempt was ever made and abandoned** — there is no "we tried and it was too slow" note anywhere; the boundary was drawn on scope grounds at inception.
- Two "door left open" signals: the grouping compute was deliberately architected as a separate, cached, off-hot-path engine (`context/archive/2026-06-04-port-grouping-algorithm/research.md:39,95,140`), and ranking was kept precisely so algorithm output is *usable by a human placer* (`archive/2026-06-18-prd.md:118`) — a generator inherits both.
- This change therefore **reverses a standing non-goal**; the PRD/roadmap should be amended as part of it (routed to Open Questions).

### 2. The problem to generate, precisely

**Decision variables.** For each course `c` with `hours_per_week = h_c`: choose `h_c` distinct `(day, period)` cells (one placement row = one hour — `supabase/migrations/20260611180006_plans_as_domain_root.sql:93-99`); for each placement a week tag `week ∈ {both, a, b}` where `week_mode = 'agnostic'` forces `both` and `'biweekly'` forces `a|b` (app-enforced invariant only — `supabase/migrations/20260621130000_bi_weekly_week_columns.sql:11-12`, `src/_pages/plan-detail/model/placement/placement-transitions.ts:25-31`). Merge parents are single placeable virtual courses (union of children's students); 0-hour merge-children need no placements (`src/shared/api/load-cohort-courses.ts:70-84,191-192`).

**Hard constraints** (exactly the five registered cell constraints, `src/entities/timetable/model/collision/constraints/index.ts:10-16`):
- `duplicate-course` — same course twice in one cell (also the only DB-enforced rule, via `placements_unique`).
- `teacher-conflict` — teacher *sets* (co-teaching junction `course_teachers`) intersect among week-overlapping occupants.
- `student-conflict` — shared student among week-overlapping occupants (opposite-week `a`/`b` pairs are legal).
- `teacher-availability` — `strong` severity blocks; `soft` warns; week-agnostic, cohort-independent (`supabase/migrations/20260613130000_teacher_availability.sql:12-27`).
- `cross-cohort-teacher` — symmetric week-aware teacher occupancy across DP1/DP2 (`src/entities/timetable/model/collision/constraints/cross-cohort-teacher.ts:18-37`). **This couples the two cohorts: generation is a joint two-cohort problem** (18 teachers shared across both).

**Completion objective.** All courses reach `placed ≥ required` (`deriveHours`/`deriveUnplaced`, `src/entities/timetable/model/hours.ts:14-60`) with zero blocking violations. Note: completeness is advisory today — "the finalize gate is deferred" (`hours.ts:12-13`); there is no `isPlanComplete()` predicate, but it's two trivial reads.

**Scale (measured from fixtures + live run of the actual code):**

| | dp1 | dp2 |
|---|---|---|
| Courses (GroupingCourse projection) | 39 | 42 |
| Students / choices | 26 / 233 | 35 / 315 |
| Teachers (union across cohorts: 18) | 16 | 18 |
| Σ course-hours to place | 116 | 138 |
| Conflict-graph density | 0.73 | 0.60 |
| Distinct maximal compatible sets | 173 | 495 |
| `computeGroupings` wall time | 6 ms | 82 ms |
| Avg parallelism needed (hours/50 slots) | ≥2.3 | ≥2.8 |
| Biweekly (A/B) courses | 4 | 3 |

Grid: presets `5x6 | 5x8 | 5x10`, default 5×10 = 50 slots (`src/shared/config/grid-presets.ts:10-24`); DB bounds day ≤ 7, period ≤ 12; breaks are cosmetic only (`src/entities/timetable/lib/period-breaks.ts:10`). A direct CP model is roughly `courses × slots × week` ≈ 4–9k Booleans — firmly in CP-SAT's "seconds" territory; the literature's NP-hardness applies to asymptotics and to far larger XHSTT instances with rooms and split lessons, none of which exist here.

### 3. Existing assets a generator can stand on

**Feasibility oracle (the crown jewel).** `deriveCellViolations(placements, catalogById, availability?, occupiedByTeacher?) → Map<cellKey, CellCollisions>` (`src/entities/timetable/model/collision/collisions.ts:33-58`) is pure, node-tested, workerd-proven (imported during SSR), and fast: the repo's own perf test (2 cohorts × 40 placements, `src/_pages/plan-detail/model/collision/collisions.perf.test.ts:53-76`) measured **0.97 ms for four full derivations** — one full-board validation ≈ 0.2–0.3 ms, one `violatesAny` pairwise check ≈ microseconds. A search algorithm can afford thousands of full-board evaluations per second *without any incremental machinery*. Supporting cast: `explainCell` (single-cell verdict), `violatesAny` (ctx-free fast path), index builders `buildAvailabilityIndex` / `buildCrossCohortIndex` / `projectFromPlacements` (all O(rows)).

**Candidate pool.** `computeGroupings` (`src/_pages/plan-detail/model/grouping/compute-groupings.ts:7-25`) enumerates **all** maximal compatible sets per seed (deterministic, deduped, fail-loud caps at 10k sets / 10M visits per seed → `EnumerationCapError`, `enumerate.ts:6-28`), persisted atomically with a catalog-hash staleness fingerprint (`replace_cohort_groupings` RPC; `src/_pages/plan-detail/api/staleness.ts:14-33`). Any feasible slot content is a subset of some enumerated maximal set.

**What-if sweep + first-valid-slot scan (the generator's ancestors).**
- `deriveDropHints` classifies *every* grid cell free/partial/blocked/warn/opposite-week for an arbitrary member set, including availability and cross-cohort — headless, sub-ms (`src/_pages/plan-detail/model/drop-hints.ts:95-136`).
- `findDuplicateTarget` is a literal find-first-valid-slot: column-major scan, wrapping, two-tier preference (strictly-free > non-blocking), built on `deriveDropHints` so it cannot drift from drag-time validity (`src/_pages/plan-detail/model/placement/duplicate-target.ts:37-72`).
- Week auto-assignment on drop exists: `resolveDropWeek` / `oppositeWeekAssignment` (`src/_pages/plan-detail/model/placement/board-writes.ts:157,195-202`).
- The palette's default leading-course ordering is already **fewest-groupings-first = most-constrained-first** (`src/_pages/plan-detail/model/grouping/leading-course-options.ts:39-41`) — the classic MRV variable-ordering heuristic, in production as UX.

**Objective raw material.** `deriveHours` / `deriveUnplaced` / `deriveOverplaced` (clamped, never netted; 0-hour merge-children never over-placed) — `src/entities/timetable/model/hours.ts:14-60`.

**Mutation, undo, and orchestration.** Every board mutation is Action → domain fn → **one atomic idempotent RPC** (`place_course`, `move_bundle_members`, `remove_bundle_members`, `shelve_*` — `src/_pages/plan-detail/api/placements.ts:67-118`); a full plan's editable state is a few KB, snapshot-restorable, and restoring re-triggers pure re-validation for free (`context/archive/2026-06-28-editing-undo-redo/research.md:35-36,90-101`). `useCombinedBoardState` already owns both cohorts plus the live cross-cohort index and was designed as the single orchestration seat (`src/_pages/plan-detail/model/use-cohort-board-state.ts:26-90`). The accept-and-flag philosophy (validation advises, never gates — `src/_pages/plan-detail/model/cross-cohort/drop-dispatch.ts:33-85`) means a generated board can land even if partial/imperfect, with violations flagged in the UI the author already knows. The `GroupingStalePanel` recompute flow is the ready-made UX precedent for a long-press "Generate" compute.

### 4. Gaps the generator must fill (and own)

1. **The search loop itself.** No solver, no batch endpoint, no multi-placement search exists — `findDuplicateTarget` places exactly one bundle. This is the genuinely new core.
2. **Hour multiplicity / subset closure.** A grouping says "these courses *can* share a slot," not "schedule this set k times." Members of one maximal set have heterogeneous hours, so repeatedly stamping a maximal set over-places short members (the UI even has an over-placed guard, `hours.ts:42-45`). Either close the pool under subsetting, or use a direct `course × slot × week` model where groupings aren't the backbone at all (see §6).
3. **Joint two-cohort scheduling.** Groupings are strictly per-cohort; the cross-cohort teacher constraint exists only at placement time. A generator must solve DP1 and DP2 against a shared teacher-occupancy index.
4. **Week-awareness beyond pairs.** Opposite-week enumeration is v1 pairs-only (`enumerate.ts:68-87`); a generator exploiting A/B splits needs to make the week choice itself (7 biweekly courses total — small but real).
5. **Objective function.** `score`/`coverageCount` are palette-sorting signals; `rank` is computed and discarded (`score.ts:23` vs `persist.ts:7-12`). Nothing encodes plan *quality*: teacher gaps, student day compactness, day balance, early/late-period preferences. **Must come from the author** (Open Questions).
6. **Spread/pattern constraints — a new constraint class.** Nothing forbids the same course in multiple periods of the same day (duplicate-course is per-cell only). Real timetables spread a 4-hour course across ≥3–4 days, sometimes want double periods. Without this, generated output will be valid-but-absurd. Needs domain rules (hard "max N periods of a course per day" and/or soft spread scoring) — none exist in the schema, core, or PRD.
7. **Invariants the core does not check** (generator must maintain): `week_mode ↔ week` consistency; per-plan grid preset bounds (Zod checks only global 7×12 — `src/_pages/plan-detail/api/placements.ts:10-23`); cohort-catalog membership — a placement whose course is missing from the catalog is **silently skipped** by validation, not flagged (`collisions.ts:93`).
8. **FSD relocation.** The cell classifier (`deriveDropHints`/`classifyCell`) lives in `_pages/plan-detail/model/` — a generator in `entities/` or its own slice cannot legally import it (steiger-enforced layer direction). The ~250-line file has no page dependencies beyond `drag.ts` types and would move down cleanly; per the port-the-mechanism lesson, model the generator on `GroupingCourse`/`PlannerPlacement`, not new parallel shapes.
9. **No bulk persistence.** Fresh placement writes are one `place_course` RPC per course-hour (`src/_pages/plan-detail/api/placements.ts:64-66`) — ~254 calls for a full two-cohort plan. A generator wants one atomic "apply generated plan" RPC following the `replace_cohort_groupings` delete+reinsert-in-one-transaction template (that pattern exists precisely because PostgREST has no client-side transactions — `context/archive/2026-06-04-port-grouping-algorithm/plan.md:260-268`).

### 5. External techniques & runtime fit (web research, July 2026)

**Hardness at this scale:** general high-school timetabling is NP-hard, but the canonical XHSTT benchmark instances (full schools, rooms, split lessons) are solved optimally-or-near by generic MIP and heuristic solvers in minutes; this instance is smaller and structurally simpler than nearly all of them. CP-SAT treats problems of this size (~8–10k Booleans) as sub-second-to-seconds material; time is spent on soft-objective *optimization*, so fix a time budget (10–30 s) and take best-found.

| Option | Verdict | Key facts |
|---|---|---|
| **`or-tools-wasm` (CP-SAT via WASM)** | **Primary candidate, client-side** | npm v0.9.1 (2026-06-08), Apache-2.0; per-solver code-split — cp_sat module 7.45 MB raw / **~2 MB gzip** (verified from tarball). Browser needs COOP/COEP headers (WASM threads); asyncify single-thread fallback exists. **Not viable in workerd** (no threads/SharedArrayBuffer). Buys: optimality, *infeasibility explanations* (assumption sets), warm-start hints = pinning/repair for free. Risk: young package, single maintainer → pin version, wrap behind port, spike day one. |
| **Pure-TS heuristic (constructive + local search)** | **Baseline / complement — lowest risk** | MRV placement over the existing grouping pool + SA/tabu polish scored by the existing validator. Zero deps, runs in browser Web Worker *and* on Workers (paid CPU default 30 s, **raisable to 5 min via `limits.cpu_ms`**). Same architecture as UniTime's ITC2007-winning Iterative Forward Search — chosen there explicitly because feasible-partial solutions suit human-in-the-loop planning. Risk: no proofs; local-search tuning tail. |
| **Timefold (Java) in Cloudflare Container** | Reserve | Apache-2.0; school timetabling is its canonical quickstart; best pinning/replanning ergonomics (`@PlanningPin`, `ProblemChange`). No JS/WASM build → JVM container (Containers GA 2026-04-13, scale-to-zero). High effort; justified only if TS/WASM routes disappoint or scope grows (rooms, multi-school). |
| z3-solver (SMT WASM) | Dominated | Works in browser but ~34 MB, slow Chrome load, weak optimization vs CP-SAT. |
| highs-js / glpk.js (MILP WASM) | Fallback only / exclude | highs is small+maintained but timetabling encodes clumsily in .lp; glpk is GPL + weak MILP. |
| clingo-wasm (ASP) | Viable, not recommended | Niche encoding skillset, coarser optimization control. |
| Hosted solver SaaS | Not worth it | No school-timetabling hosted model exists (Timefold Platform sells routing/shift models); a single-school app can solve client-side for free. |
| **LLM-direct generation** | **Not credible** | 2025–26 benchmarks (R-ConstraintBench; WorldTravel: GPT-5.2 at 32.67% feasible) show hard-constraint feasibility collapsing as constraints couple. Legitimate LLM role = NL front-end over a real solver, later nicety. |

**Human-in-the-loop pattern (all engines):** generate-then-review with **pinning** — author locks placements, solver fills/repairs the rest, warm-started from the current board; the drag-drop board remains the editor of record. This is the documented industry pattern (Timefold continuous planning; CP-SAT hinting) and matches the app's accept-and-flag philosophy.

### 6. Architecture options

**Model shape — two routes:**
- **(a) Direct assignment model** (recommended for CP-SAT): variables over `course × slot × (week)`; constraints encoded directly from `GroupingCourse` data (student/teacher sharing, availability, cross-cohort, spread rules). Groupings are then *not* the model backbone — they serve warm-start, verification, and palette UX. Simpler, and the model can express hour-multiplicity and spread natively.
- **(b) Column/exact-cover over the enumerated grouping pool** (fits the TS heuristic): treat the 173/495 maximal sets (closed under subsetting as hours exhaust) as candidate slot-contents; place greedily most-constrained-first, repair with local search. Nearly assemblable from existing parts today: leading-course MRV order (`leading-course-options.ts:39-41`) + `deriveDropHints` sweep + `findDuplicateTarget`-style scan + `deriveHours` progress + `resolveDropWeek`.

**Where it runs:**
- **Client-side Web Worker** — recommended seat for both engines. Unlimited wall-clock, zero server cost, the full snapshot is already client-side on the board, and progress/cancel UX is natural. CP-SAT WASM additionally requires COOP/COEP response headers from the Worker serving the app (no OAuth popups in this app, so cross-origin isolation is low-risk).
- **Server-side Astro Action on workerd** — viable for the pure-TS engine only (CP-SAT WASM needs threads). Follows the existing `computeGroupings` Action precedent; paid-tier CPU raisable to 5 min. Right choice if generation should also run headlessly (e.g., "generate on plan creation").
- **Container (Timefold)** — only if requirements outgrow the above.

**Integration contract (engine-agnostic):**
1. `generatePlan(snapshot, pins, config, budget) → { placements, diagnostics }` port interface; engines swappable behind it.
2. **Trust-but-verify:** every generated board is re-judged by `deriveCellViolations` before presentation — the parity-harness-anchored oracle stays the single source of truth regardless of engine.
3. Output lands as ordinary optimistic placements in `useCombinedBoardState` (accept-and-flag renders any imperfection); "discard generation" = one snapshot restore, consistent with the undo design.
4. Persistence via a new atomic `apply_generated_placements`-style RPC (delete-unpinned + bulk-insert in one transaction, `replace_cohort_groupings` template), not 254 `place_course` calls.

**Suggested phasing** (for a later `/10x-plan`, not binding):
- **Phase 0 — spike (risk-kill):** load `or-tools-wasm` in a Web Worker behind COOP/COEP, encode the direct model from a real snapshot, measure load+solve; in parallel wire the greedy TS baseline over existing parts. Both behind the port interface.
- **Phase 1 — "complete this plan":** fill-the-gaps generation respecting all current placements as pins; review UX + one-click discard; spread constraints as config.
- **Phase 2 — optimize/repair:** soft objectives (once defined), repair mode for hand-edited plans, infeasibility explanations surfaced ("these constraints conflict").

## Code References

- `src/entities/timetable/model/collision/constraints/index.ts:10-27` — the five-constraint registry, `explainCell`, `violatesAny`
- `src/entities/timetable/model/collision/collisions.ts:33-58,86-108` — `deriveCellViolations` (the oracle), `bucketByCell` (note :93 silent skip of catalog-missing courses)
- `src/entities/timetable/model/collision/constraints/cross-cohort-teacher.ts:18-37` — the two-cohort coupling constraint
- `src/entities/timetable/model/week.ts:19` — `weeksDisjoint`, the single fortnight primitive
- `src/entities/timetable/model/hours.ts:14-60` — `deriveHours`/`deriveUnplaced` (objective raw material; finalize gate deferred at :12-13)
- `src/entities/timetable/model/availability-index.ts:32-40`, `cross-cohort-index.ts:24-61` — O(rows) index builders
- `src/_pages/plan-detail/model/collision/collisions.perf.test.ts:53-76` — perf harness (50 ms assert; ~1 ms measured)
- `src/_pages/plan-detail/model/grouping/compute-groupings.ts:5-25`, `enumerate.ts:6-87`, `score.ts:4-33` — grouping enumeration, caps, scoring
- `src/_pages/plan-detail/model/grouping/leading-course-options.ts:39-41` — most-constrained-first ordering already in production
- `src/_pages/plan-detail/model/drop-hints.ts:95-136,161-187` — full-grid what-if classifier (needs FSD relocation for reuse)
- `src/_pages/plan-detail/model/placement/duplicate-target.ts:37-72` — `findDuplicateTarget`, the single-bundle auto-placer ancestor
- `src/_pages/plan-detail/model/placement/placement-transitions.ts:25-39` — `resolveDropWeek` (weekMode↔week invariant lives here, app-only)
- `src/_pages/plan-detail/model/use-cohort-board-state.ts:26-90` — combined-board orchestration seat + live cross-cohort index
- `src/_pages/plan-detail/api/load.ts:50-159` — `loadCombinedPlannerData`, the one-shot problem snapshot
- `src/_pages/plan-detail/api/placements.ts:10-23,64-118` — Zod bounds, RPC write surface (no bulk path)
- `src/shared/api/load-cohort-courses.ts:20-99` — `GroupingCourse` assembly (overlaps absorb students; merge parents virtual)
- `src/shared/lib/catalog-hash/types.ts:18-25` — `GroupingCourse`, the projection a generator should consume
- `src/shared/config/grid-presets.ts:10-24`, `src/shared/lib/grid/grid.ts:10,27-39` — grid topology and bounds
- `supabase/migrations/20260604141213_replace_cohort_groupings_fn.sql:15-51` — the atomic batch-replace RPC template
- `supabase/migrations/20260621130000_bi_weekly_week_columns.sql:11-22` — week columns + app-enforced invariant comment
- `data/out/dp1-variants-2.csv`, `data/out/dp2-variants-2.csv` — the original (grouping-only) algorithm's golden outputs

## Architecture Insights

- **The system was accidentally designed for this.** Purity of the constraint core, opaque-id domain projections (`GroupingCourse`), off-hot-path cached compute (grouping Action), accept-and-flag rendering of imperfect states, snapshot-cheap board state, and atomic idempotent RPCs — every one of these choices, made for other reasons, is exactly what a generate-then-review feature needs.
- **Validation is advisory, never gating** — a generator doesn't need a perfect solution to ship value; a 95%-complete board with flagged residuals is a legitimate, renderable outcome the author finishes by hand.
- **Two cadences, one oracle.** The codebase already distinguishes the expensive cached compute (groupings) from the <200 ms interactive validator. Generation slots into the first cadence; the 200 ms budget is *not* a constraint on the solver — only on re-validating its output, which costs ~1 ms.
- **Keep one source of truth.** Whatever engine is chosen, its output must be judged by `deriveCellViolations` (the parity-anchored oracle), never by the engine's own model — this is the same "port the mechanism, verify against the app's types" lesson from the original algorithm port (`context/foundation/lessons.md:5-10`).
- **Density, not count, is the scaling knob.** The naive maximal-set enumeration wastes 4–40× work re-discovering sets and is exponential worst-case; fine at 40 courses/0.6–0.7 density with ~300× CPU headroom, but a pivoted Bron–Kerbosch rewrite is warranted before ~2–3× catalog growth.

## Historical Context (from prior changes)

- `context/archive/2026-06-04-port-grouping-algorithm/` — origin story: legacy Bun recommender → deterministic in-app enumeration; auto-placement explicitly a non-goal of the port (`research.md:94`); atomic-replace RPC pattern born here (`plan.md:260-268`); Workers-CPU escape hatches documented (`research.md:111-118`).
- `context/archive/2026-06-05-first-valid-drop-with-validation/research.md:37-42` — accept-and-flag policy; course-hour as placement unit; "no auto-spreading — the author places each hour manually (matches the no-auto-placement non-goal)".
- `context/archive/2026-06-13-collision-free-slots/research.md:33-34,64,172` — whole-grid what-if sweep costs single-digit ms; "which of the many valid boards is best is the actual product question".
- `context/archive/2026-06-22-parity-harness-enriched-validators/research.md:33-135` — `deriveCellViolations` is the committed-verdict boundary; requirements-anchored false-positive guard.
- `context/archive/2026-06-28-editing-undo-redo/research.md:35-36,87-116` — snapshot restore is cheap and re-validates free; `useCombinedBoardState` reserved as the op-log/orchestration home; business-key identity for placement reconciliation.
- `context/archive/2026-07-01-courses-left-info/research.md:35-49,104-120` — `deriveHours` semantics (clamped, never netted; over-placed = complete); headless `deriveDropHints` noted as machinery for future auto-suggest.
- `context/archive/2026-06-24-grouping-refresh-stale-version/` — groupings and placements fully decoupled (no FK); catalog-hash staleness; manual-only refresh.
- `context/foundation/prd.md:463` + `context/foundation/roadmap.md:212` — the standing non-goal this change reverses.

## Related Research

- `context/archive/2026-07-10-batch-xlsx-export/research.md` — closest precedent in spirit: "feared server limit turned out irrelevant; do it client-side" (also documents `limits.cpu_ms` raisable to 5 min).
- `context/archive/2026-06-04-port-grouping-algorithm/research.md` — the algorithm-porting feasibility study this one builds on.

## Open Questions

> All questions resolved 2026-07-11 with the author (see Follow-up section below for detail).

1. ~~**What makes a complete plan *good*?**~~ **Resolved 2026-07-11 — all four soft criteria adopted** (course spread across days, student day compactness, teacher day compactness, balanced daily load) **plus a new primary objective from the author: slot-count minimization** — the grid offers 50 slots (5×10), manual planning's best plans occupy 48 distinct slots, and any plan occupying fewer is better.
2. ~~**Spread/pattern constraints**~~ **Resolved 2026-07-11 — flat hard cap: max 2 periods of one course per day** (allows the doubles that 6-hour courses require). Whether the interactive validator should also warn on 3+ same-day stacking is deferred to the plan.
3. ~~**Pinning/repair semantics**~~ **Resolved 2026-07-11 — fill-the-gaps only**: existing placements are always pinned; an empty board is full generation. Shelf: **skip parked courses** — the generator fills only deficits not covered by parked bundles (matches courses-left semantics).
4. ~~**Engine + seat decision**~~ **Resolved 2026-07-11 — spike both** (or-tools-wasm and pure-TS greedy baseline) behind one `generatePlan()` port; decide on results. **Budget: 10–30 s with progress + cancel** — which favors the client-side Web Worker seat.
5. ~~**Infeasibility UX**~~ **Resolved 2026-07-11 — staged**: v1 ships best-effort board + unplaced-courses list (both engines can); solver-proven minimal-conflict explanations later, if/when CP-SAT is the engine.
6. ~~**Persistence path**~~ **Resolved 2026-07-11 (by recommendation)** — one atomic `apply_generated_placements`-style RPC (delete-unpinned + bulk insert in a single transaction, `replace_cohort_groupings` template); the whole generation is a single undo history entry.
7. ~~**PRD/roadmap amendment**~~ **Resolved 2026-07-11 (process)** — reverse the auto-placement non-goal (`prd.md:463`, `roadmap.md:212`) during `/10x-frame` before `/10x-plan`.
8. **`or-tools-wasm` viability spike** — remains the first implementation action (Phase 0): load time, COOP/COEP interplay with the Astro/Workers setup, and a real solve on the dp1+dp2 snapshot; pin the version and wrap behind the port interface before committing.

**Residual detail for framing:** confirm slot-count minimization is measured per cohort (assumed), and whether freed slots should sit in preferred positions (e.g. last periods of the day so days end early).

## Follow-up Research 2026-07-11T14:10+02:00 — open questions resolved with the author

All seven author-facing questions were answered in a structured Q&A; two more resolved by recommendation. Consolidated decisions:

### Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Soft objectives | All four: course spread across days, student day compactness, teacher day compactness, balanced daily load |
| 1b | **Primary objective (new)** | **Minimize occupied slots.** 50 theoretical (5×10); manual best = 48; fewer is better |
| 2 | Spread rule | Flat hard cap — max 2 periods of one course per day |
| 3 | Generation mode | Fill-the-gaps only (existing placements always pinned; empty board = full generation) |
| 4 | Engine | Spike both (or-tools-wasm + pure-TS greedy) behind one `generatePlan()` port |
| 5 | Solve budget | 10–30 s, with progress indicator + cancel |
| 6 | Infeasibility UX | Staged: v1 best-effort + unplaced list; CP-SAT conflict explanations later |
| 7 | Shelf bundles | Skip parked courses — generator fills only deficits not covered by parked bundles |
| 8 | Persistence | Atomic `apply_generated_placements` RPC; one undo entry per generation (recommendation) |
| 9 | PRD non-goal | Reversed as part of this change, formalized during `/10x-frame` (process) |

### Implications for the plan

- **Slot-count minimization reframes the feature from feasibility to genuine optimization.** "Complete the plan" is now the entry bar; "beat 48 slots" is the prize. This materially strengthens the CP-SAT track: minimizing Σ slot-used booleans is a global objective that greedy constructive heuristics chase poorly and can never prove optimal, while CP-SAT proves bounds ("46 is optimal for this catalog") within the 10–30 s budget at this scale. The TS heuristic remains the guaranteed-shippable baseline and the best-effort fallback engine.
- **The benchmark is concrete and testable:** generated plans should occupy ≤ 48 distinct slots on the real dp1/dp2 catalog, else the objective encoding is wrong or the engine underperforms. This belongs in the plan's success criteria.
- **The 2/day cap is a new hard-constraint class** to encode in the generator model (it does not exist in schema, core, or PRD today). Whether `deriveCellViolations` should also learn a warn-level "same course 3+ times in one day" rule for manual editing is a small, separable decision for the plan.
- **Fill-the-gaps-only simplifies v1 significantly**: no clear-and-regenerate flow, no selective-pin UI; pinning = "whatever is on the board stays". Combined with skip-parked-courses, the generator's input is exactly `deriveUnplaced` minus parked-covered deficits — both derivations already exist (`hours.ts:31`, courses-left parked-deficit rule).
- **10–30 s with progress + cancel confirms the client-side Web Worker seat**: wall-clock is unlimited there, progress/cancel are natural (`postMessage`/`terminate`), and neither engine needs the server. The Workers-side Action seat is off the critical path for v1.

## Follow-up Research 2026-07-11T14:12+02:00 — new domain rule: early-finishing courses (edge-of-day placement)

The author surfaced an additional rule that today lives only in the plan author's head:

**The rule.** Some DP2 courses end earlier in the school year than the rest (they stop being taught at some point and disappear from the weekly grid). When building the plan, the author deliberately places these courses as the **first or last lessons of the students' day**, so that once the course stops running mid-year, its students simply **start later or finish earlier** — instead of inheriting a mid-day hole in their schedule.

**Current state.** This knowledge has **no representation anywhere** — not in the schema, not in `GroupingCourse`, not in the fixtures, not in the PRD. It is tacit planner knowledge, which means a generator (and any other author) cannot honor it. Capturing it requires a domain-model change.

### Required model change

- **New course attribute** — additive migration per the project convention, e.g. `courses.finishes_early boolean not null default false` (name to settle at plan time; a boolean suffices for the known case — an enum/date would be speculative). Existing plans behave identically via the default.
- **Course CRUD**: Zod schema + form field in the courses catalog so the author can set the flag per course (plan-owned catalog, so per-plan/per-year naturally).
- **Snapshot delivery — keep it OUT of `GroupingCourse` and the catalog hash.** The flag does not affect *compatibility* (who can share a slot is still decided by teachers/students/weeks), so it does not belong in the grouping enumeration input. Since `GroupingCourse` is also the input to the catalog-hash staleness fingerprint (`src/shared/lib/catalog-hash/`), adding the flag there would (a) spuriously mark all existing groupings stale once, and (b) force palette recomputes whenever the flag is toggled, despite groupings being unaffected. Deliver it instead as a side map in the generator snapshot — `finishesEarlyByCourseId: Set<courseId>` — exactly the pattern `BoardContext` already uses for `weekByCourseId` (`src/entities/timetable/model/collision/constraints/types.ts:28-30`).

### Generator semantics (soft objective, weighted high)

The author "tries to" achieve this — it is a preference, not a hard rule (hard would risk infeasibility on dense days). Precise formalization: for each student enrolled in a flagged course, on each day where that course occupies one of the student's periods, that period should be the **first or the last of that student's occupied periods that day** (week-aware). Note this is *edge of the student's day*, not edge of the grid — if a student's day runs periods 3–8, a flagged course at period 3 or 8 satisfies the rule.

- **CP-SAT encoding**: per (student, day): reified `flaggedPeriod ≤ min(otherPeriods)` OR `flaggedPeriod ≥ max(otherPeriods)`; penalize violations in the objective. Cheap at this scale (26–35 students × 5 days).
- **TS heuristic encoding**: a scoring term on candidate cells for flagged courses (prefer edges of currently-affected students' days) + a local-search move class (push flagged placements outward).
- **Objective interaction**: aligns with student day compactness (while the course runs there is still no hole; the hole would only appear after it ends — edge placement is what removes it). Mild tension with slot-count minimization and balanced load; the weighting order needs to be decided during planning (suggested: completeness > hard constraints > slot count > edge-of-day for flagged > compactness/balance).

### Scope notes

- Currently applies to **some DP2 courses** in practice, but the flag is generic (any course, either cohort).
- Optional (plan-time decision): a small badge on flagged course chips/cells so the review UX explains *why* the generator pushed them to day edges; a warn-level hint for manual editing is possible later but out of v1 scope.
- Affects framing: this is a **new PRD-level business rule** (like co-teaching/bi-weekly were), so the `/10x-frame` pass that reverses the auto-placement non-goal should also register this rule and the new course attribute.
