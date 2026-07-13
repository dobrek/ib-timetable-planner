# Plan-Quality Analyzer Implementation Plan

## Overview

Build the plan-quality analyzer: a pure, read-only feature extractor in `src/entities/timetable/model/analysis/` that measures any plan (expert or generated) across the validated T1 metric catalog, plus a dev-side two-plan runner (`pnpm analyze:plans`) that prints the expert-vs-generated comparison — automating the report that was hand-executed in SQL as v0 (`comparison-report.md`). The change closes with a recorded first real run: the verify-gold verdict (is the expert plan oracle-valid?) and the Golden-vs-generated diff, checked into this change folder.

## Current State Analysis

- The metrics core already exists as pure, exported, framework-free functions in `src/entities/timetable/model/generation/`: `countOccupiedSlots` (`occupied-slots.ts:5`), `countInteriorHoles` (`objective.ts:75`), `countStudentHoles` (`objective.ts:87` — the lane-expansion template), `deriveGenerationDeficits` (`deficits.ts:15`), `verifyGeneration` (`verify.ts:31`). The entity barrel (`src/entities/timetable/index.ts:18-26`) already exports all of it; the analyzer is the first external consumer of the objective-style extractors.
- Every metric in the target report was already computed manually in SQL against the real Golden Plan (research.md Follow-ups 2–7, consolidated in `comparison-report.md`) — the catalog is validated, including negative results that *remove* metrics.
- The comparison rig is operational locally: Golden Plan `4bc9fe99-33ae-4c58-9b66-9b8477dad33f` (expert reference, dp1 = 48 / dp2 = 47, restored from the gitignored `data/golden-plan.sql`) + disposable catalog-only clones via `clone_plan`.
- `bench/generation.bench.ts:73` looks the seed plan up **by name** ("Seed Plan A"), which breaks whenever the original-id golden import is in place — the recorded design cue is "plans by id, never name."
- No expert-vs-generated tooling exists; the report is hand-made and not reproducible without re-running ad-hoc SQL.

## Desired End State

- `analyzePlan(input) → PlanQualityFeatures` lives in `src/entities/timetable/model/analysis/`, pure and Workers-safe, covering the full T1 catalog (board, course, student, teacher, and cross-cohort lenses, incl. the mirrored-cell fixture detector and subject roll-ups keyed provisionally by `name`).
- `pnpm analyze:plans` loads one or two plans **by id** from the local Supabase stack and prints: a rule-verdict block per plan (`verifyGeneration` — the verify-gold experiment), then side-by-side feature tables with completeness always printed beside slot counts.
- `pnpm bench:generation` resolves its plan by id (env-overridable), so it works regardless of plan renames and can be pointed at any catalog for future A/B runs.
- A recorded first run exists in this change folder: verify-gold verdict + full analyzer output for Golden Plan vs a generated board on the identical catalog, with golden-side placement-derived numbers matching `comparison-report.md`.

### Key Discoveries:

- **One primitive powers ~80% of the catalog** (research.md Follow-up 1): expand rows → `(entity, day, weekLane)` lanes (`both` fans into `a`+`b`, mirroring `objective.ts:94`), then fold per-lane stats (span, holes, max streak, first/last, count). Each published metric is a thin fold over this.
- **Adjacency/split metrics need no subject identity** — a student takes at most one course per subject, so they are same-`courseId` phenomena. Subject identity (`courses.name`/`level`/`group_index`, `load-cohort-courses.ts:104-115`) is needed only for roll-up labels (time-of-day gradient) and the mirrored-cell census join.
- **Verify-gold needs no new machinery**: build a `GeneratorSnapshot` with `pins: []` from the plan's catalog and feed the whole board as `generated` — `verifyGeneration` then answers exactly "would the engine be allowed to ship this board."
- **Both plan kinds reduce to one input shape**: `placements` rows + the course projection; `loadCohortCourses` + `loadPlacements` (`src/shared/api/`) already load both, and `bench/generation.bench.ts:69-95` shows the snapshot assembly pattern in a vitest-config runner.
- **Refuted metrics stay out of v1** (Follow-up 5): fixed-period consistency, `is_optional` placement. Slot-density metrics survive only as *position* measurements (where thin slots sit), not counts-as-quality.
- **Counting conventions are pinned by the report** (`comparison-report.md` Scoreboard preamble): gaps/adjacency lane-expanded; student/teacher joins via the same projection for both plans.

## What We're NOT Doing

- **No in-app surface** (KPI strip / comparison page — Options B/C): explicitly deferred until after the expert session validates which features matter.
- **No markdown or JSON report emission** — console tables only (author decision; the durable artifact for this change is the recorded Phase-4 run).
- **No persistence of feature vectors** (Option D) and no schema changes of any kind.
- **No objective/engine changes** — no new tiers, no operators, no pre-pin experiment, no CP-SAT work. This change measures; the tuning change consumes the measurements.
- **No `GroupingCourse` extension** — the analyzer takes its own richer projection; the catalog hash is untouched.
- **No backup/export script** (Method-3 formalization) — separate candidate change.
- **No final subject-key decision** — roll-ups key by `name` provisionally; the expert confirms the grouping later (one `keyFn` change).
- **No T3 metrics** (heaviness weights, subject-pair rules) — they require expert classification that doesn't exist yet.
- **No prod access** — the runner targets the local stack only.

## Implementation Approach

Pure extractor first, following the objective's own design lesson: the analyzer is a **feature vector, not a comparator** — it reports per-feature numbers and never scalarizes (the weighted-scalar tier-bleed bug is the cautionary tale). It lives beside the generation module, takes its own input shape (`rows` + a course projection extended with subject identity — never `GeneratorSnapshot`), and reuses the shipped counting functions rather than reimplementing them. The runner composes extractor + `verifyGeneration` + console rendering, mirroring the bench precedent (vitest config, env-gated, real local catalog). Ride-alongs: the bench id-lookup fix and committing the `.gitignore` rule for `data/golden-plan*.sql`.

## Critical Implementation Details

- **Report-parity has two grades.** Placement-only and `course_teachers`-derived metrics (slots, holes, edge profile, adjacency, splits, mirrored cells, cohort-pure days, switches) must reproduce `comparison-report.md`'s golden columns **exactly**. Student-lens metrics may differ slightly: the SQL v0 joined **direct enrollments only**, while `GroupingCourse.studentKeys` unions overlap-dependents and merge-children (`load-cohort-courses.ts:60-84`). The projection is identical for both plans, so the diff stays fair — Phase 4 records any delta with this explanation rather than chasing exact student-gap parity.
- **Slot counts must never render without completeness beside them** — an incomplete board trivially uses fewer slots (the stale-bench trap). This is a rendering-layer invariant in the runner, not just a report convention.
- **Plans are addressed by id, never by name** — everywhere: the runner's env inputs, the bench fix, error messages.
- **Grid dimensions come from `plans.slot_grid_preset`** parsed via `src/shared/lib/grid/grid.ts` — the runner must not hardcode 5×10 (the bench does; don't copy that).
- **Week-lane semantics split by metric family**: gap/adjacency/streak metrics are lane-expanded (`both` → both lanes); slot-census metrics (students-per-slot, parallelism, occupied slots) count distinct `(day, period)` cells week-agnostically. Both conventions already exist in the code (`countStudentHoles` vs `countOccupiedSlots`); the lane primitive must make the choice explicit per metric.
- **Builders' `hours: 4` default is inert for constraint tests but load-bearing for completeness/daily-load metrics** — analyzer tests must set `hours` explicitly where it matters.
- **Verify-gold semantics**: with `pins: []`, every board row is "generated," so the 2/day stacking cap applies to the whole board — that is the intended question. Map DB rows to `GeneratedPlacement` (dropping `is_optional`; both boards carry 0 optional rows).

## Phase 1: Analysis Module Foundation

### Overview

Create `src/entities/timetable/model/analysis/` with the input projection types, the lane-expansion primitive, and the board/course-lens metrics — the scoreboard core. Wire the barrel.

### Changes Required:

#### 1. Analysis types

**File**: `src/entities/timetable/model/analysis/types.ts`

**Intent**: Define the analyzer's own input shape so it never depends on engine types it doesn't need, and the output vector shape.

**Contract**: `AnalyzerCourse = GroupingCourse & { name: string; level: string; groupIndex: number }`; `AnalyzerRow = { cohort, courseId, day, period, week }` (structurally assignable from `GeneratedPlacement`); `PlanAnalysisInput = { days, periods, courses: Record<Cohort, AnalyzerCourse[]>, rows: AnalyzerRow[], availability: BoardAvailabilityCell[], parkedCourseIds: Record<Cohort, string[]> }`; `PlanQualityFeatures` — the nested per-lens output assembled by `analyzePlan` (grows in Phase 2). Distribution-shaped values report `{ min, p10, median, max, variance }`-style stats plus worst-case identity where the lens has one (the report-validated "distributions and worst cases, not totals" principle).

#### 2. Lane primitive

**File**: `src/entities/timetable/model/analysis/lanes.ts`

**Intent**: The shared expansion + per-lane stats every gap/adjacency/streak metric folds over — the ~80% primitive.

**Contract**: `expandLanes(rows, keyFn)` groups rows into `(entityKey, day, weekLane)` lanes with `both`-week fan-out mirroring `objective.ts:94`; `laneStats(periods)` returns `{ count, first, last, span, holes, maxStreak }` from a lane's period set. Declarative composition per lessons.md; entity keys are opaque strings supplied by the caller's `keyFn` (courseId, studentKey, teacherKey, cohort).

#### 3. Board-lens metrics

**File**: `src/entities/timetable/model/analysis/board-shape.ts` (+ `daily-load.ts`, `slot-census.ts`, `week-symmetry.ts`)

**Intent**: Per-cohort board shape: edge-free profile (free slots at day start vs end, first/last occupied period, day span — the "packed mornings, short Friday" finding), daily load balance (hours/slots per day variance), students-per-slot distribution + thin-slot census **with positions** (edge vs interior — Follow-up 5 refinement), courses-per-slot parallelism, and A-vs-B week-lane symmetry (slot delta, differing cells).

**Contract**: Each file exports pure functions over `(courses, rows, days, periods)` subsets; occupied slots and interior holes are **reused** from `occupied-slots.ts` / `objective.ts`, not reimplemented. Slot-census metrics count distinct `(day, period)` cells week-agnostically.

#### 4. Course-lens metrics

**File**: `src/entities/timetable/model/analysis/course-adjacency.ts` (+ `course-spread.ts`)

**Intent**: The headline findings: same-course adjacent pairs and same-course same-day splits (lane-expanded, per cohort — expert invariant: 0 splits), days-spread per course, and multi-day course count.

**Contract**: `courseId`-grain folds over the lane primitive; no subject identity involved.

#### 5. Completeness wrapper

**File**: `src/entities/timetable/model/analysis/completeness.ts`

**Intent**: Per-cohort unplaced hours (total + per-course list) so the runner can always print completeness beside slots.

**Contract**: Thin wrapper over `deriveGenerationDeficits(placements, courses, parkedCourseIds)` — same meaning of "unplaced" as the generator's.

#### 6. Assembly + barrel

**File**: `src/entities/timetable/model/analysis/analyze-plan.ts`, `src/entities/timetable/model/analysis/index.ts`, `src/entities/timetable/index.ts`

**Intent**: `analyzePlan(input) → PlanQualityFeatures` composes the Phase-1 metrics; the analysis barrel is pure re-exports; the entity barrel gains one `export * from "./model/analysis"` line (or per-file lines matching the existing style).

**Contract**: `analyzePlan` is a pure function; no Node/DOM globals anywhere in the module (Workers-safe like the rest of the entity core).

### Success Criteria:

#### Automated Verification:

- Unit tests for lanes, board, course, completeness metrics pass: `pnpm test`
- Type check passes: `pnpm check` (after `pnpm exec astro sync` if types are stale)
- Lint + FSD structure pass: `pnpm lint` && `pnpm steiger`
- Build stays clean (Workers-safety): `pnpm build`

#### Manual Verification:

- None for this phase (pure functions, fully covered by tests).

---

## Phase 2: Entity Lenses + Cross-Cohort Family

### Overview

Add the student, teacher, cross-cohort, and subject-roll-up metric families; complete the `PlanQualityFeatures` vector.

### Changes Required:

#### 1. Student lens

**File**: `src/entities/timetable/model/analysis/student-lens.ts`

**Intent**: The tier-4 human-edge metrics: student gap-slots (total + per-student distribution + worst student), span efficiency, max consecutive hours, single-lesson student-days, late finishes / early starts, days on campus, fairness spread (variance/max across students).

**Contract**: Folds over `expandLanes(rows, studentKey)` joining `course.studentKeys` — same join as `countStudentHoles`; the gap **total** must equal `countStudentHoles`'s result on identical input (parity test pins this).

#### 2. Teacher lens

**File**: `src/entities/timetable/model/analysis/teacher-lens.ts`

**Intent**: The biggest unmodeled numeric gap (74 vs 345): teacher gap-slots, teaching days per teacher, day span, max consecutive teaching, and per-teacher soft-availability hits (localizing `softWarnCount`).

**Contract**: Lanes keyed by `teacherKey` from `course.teacherKeys` (a set — co-taught courses count for every teacher); teacher lanes span **both cohorts** (teachers are one staffing system). Soft-hit localization indexes `availability` via `buildAvailabilityIndex` (`model/availability-index.ts`).

#### 3. Cross-cohort family

**File**: `src/entities/timetable/model/analysis/cross-cohort.ts`

**Intent**: The Follow-up-7 family: teacher cohort-coverage census, cohort-pure teacher-day ratio, within-day cohort switch count + back-to-back (seamless) share, same-day cross-cohort subject-edition sharing, and the mirrored-cell census — the automatic fixture detector.

**Contract**: Mirrored-cell join key is `(name, level, day, period)` across cohorts (subject identity from `AnalyzerCourse`); switch metrics fold over per-teacher-day period sequences tagged with cohort.

#### 4. Subject roll-ups

**File**: `src/entities/timetable/model/analysis/subject-rollup.ts`

**Intent**: The time-of-day gradient (mean period per subject — the expert's heaviness-labeling input) and per-subject aggregation of course-grain metrics.

**Contract**: Grouping key is `AnalyzerCourse.name` — **provisional** until the expert confirms (`name` vs `name+level`); the key function is a single injectable/replaceable point, documented as such.

#### 5. Assembly

**File**: `src/entities/timetable/model/analysis/analyze-plan.ts`

**Intent**: Extend `PlanQualityFeatures` and the assembly with the Phase-2 families.

**Contract**: Vector shape final for v1; refuted metrics (fixed-period consistency, `is_optional`) absent.

### Success Criteria:

#### Automated Verification:

- Unit tests pass incl. the `countStudentHoles` parity pin and a synthetic mirrored-cell fixture-detector case: `pnpm test`
- `pnpm check` && `pnpm lint` && `pnpm steiger` && `pnpm build` stay green

#### Manual Verification:

- None for this phase.

---

## Phase 3: Dev Runner + Ride-Alongs

### Overview

The `pnpm analyze:plans` runner (load two plans by id → rule verdicts → side-by-side console tables), the bench id-lookup fix, and the `.gitignore` commit.

### Changes Required:

#### 1. Runner config + script

**File**: `vitest.analyze.config.ts`, `package.json`

**Intent**: A dedicated vitest config so the analyzer and `bench:generation` never trigger each other.

**Contract**: Mirrors `vitest.bench.config.ts` (node env, `./src/test/load-test-env.ts` setup, the `astro:env/server` / `astro:actions` aliases) with `include: ["bench/**/*.analyze.ts"]`; script `"analyze:plans": "vitest run --config vitest.analyze.config.ts"`.

#### 2. Plan loader

**File**: `bench/load-plan-analysis-input.ts`

**Intent**: Load one plan by id into `PlanAnalysisInput` + a pins-empty `GeneratorSnapshot` for verification.

**Contract**: Fetches the `plans` row (name + `slot_grid_preset` → days/periods via the `grid.ts` parser), `loadCohortCourses` per cohort (GroupingCourse projection) joined by id with one extra `courses` query for `name/level/group_index` (the shared loader stays untouched), `loadPlacements` per cohort, `teacher_availability`, and shelf tables → `parkedCourseIds`. Fails loudly with the plan id in the message when the plan is missing.

#### 3. Runner

**File**: `bench/plan-quality.analyze.ts`

**Intent**: The two-plan comparison entry point: for each supplied plan print the rule-verdict block (`verifyGeneration` ok/reasons/softWarnCount — the verify-gold experiment when pointed at the Golden Plan), then the side-by-side feature tables.

**Contract**: Plan ids via env — `ANALYZE_PLAN_A` (required), `ANALYZE_PLAN_B` (optional → single-plan mode); missing Supabase env or `ANALYZE_PLAN_A` skips with a printed usage line (bench precedent). Rendering is `console.log` tables; **every slot-count line includes that cohort's unplaced-hours count**. No assertions on metric values — the runner reports, it doesn't judge (it asserts only that loading and extraction succeed).

#### 4. Bench id-lookup fix

**File**: `bench/generation.bench.ts`

**Intent**: Resolve the bench plan by id instead of the name "Seed Plan A", so the bench survives plan renames and can target any catalog.

**Contract**: `const PLAN_ID = process.env.BENCH_PLAN_ID ?? "fefd03e5-fc72-4706-8a12-524811c9cf3f"` (Seed Plan A's deterministic seed id); lookup becomes `.eq("id", PLAN_ID)`; error message names the id and the env override.

#### 5. Gitignore rule

**File**: `.gitignore`

**Intent**: Commit the already-present `/data/golden-plan*.sql` rule (closes the change.md TODO; the rule carries no data).

**Contract**: The working-tree modification is included in this change's commits.

### Success Criteria:

#### Automated Verification:

- `pnpm test` unaffected (runner excluded from the unit suite); `pnpm check` && `pnpm lint` && `pnpm build` green
- `pnpm analyze:plans` without env/ids skips gracefully with a usage message

#### Manual Verification:

- With the local stack up and the golden snapshot restored: `ANALYZE_PLAN_A=4bc9fe99-33ae-4c58-9b66-9b8477dad33f pnpm analyze:plans` prints the golden plan's rule verdict and feature tables (single-plan mode)
- `pnpm bench:generation` still passes against the seed state (id-based lookup verified)

---

## Phase 4: First Real Run Recorded

### Overview

Execute the analyzer against the real data and record the artifacts this change exists to produce: the verify-gold verdict and the golden-vs-generated diff.

### Changes Required:

#### 1. Prepare the rig

**File**: (no code — local DB state)

**Intent**: Ensure Golden Plan `4bc9fe99-…` is present (restore `data/golden-plan.sql` if a reset intervened; assertions in the dump self-verify dp1 = 48 / dp2 = 47). Locate the generated counterpart: if the Golden Catalog Clone `e67d3b63-d32c-4332-8f78-bd991b93ecd3` with the 2026-07-12 generated board still exists, use it (exact report parity expected); otherwise `clone_plan(golden, …, false)` a fresh clone, generate in-app (default budget), and treat its numbers as a fresh data point.

**Contract**: The runbook in `gold-plan-import.md` is the procedure; nothing new is written to the repo.

#### 2. Run and record

**File**: `context/changes/plan-quality-analyzer/analysis-run-1.md`

**Intent**: Capture the full runner output (both rule-verdict blocks + all tables), the plan ids, the date, and the parity check against `comparison-report.md` — including the verify-gold answer (oracle-valid gold ⇒ hidden-rules world (a); oracle-failing gold ⇒ mis-specified-rules world (b), with the failing reasons named).

**Contract**: Placement-only + `course_teachers`-derived golden metrics must match the report exactly (dp1: 48 slots/0 unplaced/0 holes/101 pairs/0 splits/day-start 0; dp2: 47/0/0/125/0/0; teacher gaps 74; mirrored cells 10; switches 86). Student-lens deltas, if any, are recorded with the projection-difference explanation (Critical Implementation Details). Mismatches outside that tolerance are extractor bugs — fix before closing the phase.

#### 3. Close the loop

**File**: `context/changes/plan-quality-analyzer/change.md`

**Intent**: Note the verify-gold verdict and the run record in the change notes; set `status` forward when wrapping up.

**Contract**: Notes only; no schema/status invention beyond the existing change.md conventions.

### Success Criteria:

#### Automated Verification:

- Full local gate green before closing: `pnpm check` && `pnpm lint` && `pnpm steiger` && `pnpm test` && `pnpm build` (or the `/verify` skill)

#### Manual Verification:

- `analysis-run-1.md` exists with the complete runner output, both verdicts, plan ids, and date
- Verify-gold verdict recorded: gold passes the oracle (world a) or the failing reasons are listed (world b)
- Golden-side parity confirmed against `comparison-report.md` per the two-grade tolerance
- change.md notes updated with the outcome

---

## Testing Strategy

### Unit Tests:

- **Lane primitive**: `both`-week fan-out (one row → two lanes), single-row lanes (span 1, holes 0), streak boundaries, empty input.
- **Board lens**: edge-free profile on a synthetic short-Friday board; thin-slot positions (edge double vs interior); week-symmetry on a biweekly-heavy fixture.
- **Course lens**: adjacent pair vs split discrimination (P3+P4 = pair; P3+P5 = split); `both` vs `a`/`b` lane counting; days-spread.
- **Student/teacher lenses**: parity pin — student-gap total equals `countStudentHoles` on identical input; co-taught course counts for every teacher; cross-cohort teacher lanes merge both cohorts.
- **Cross-cohort**: mirrored-cell detector finds a synthetic Advisory-style fixture and ignores single-cohort cells; seamless vs gapped switch classification.
- **Completeness**: wrapper matches `deriveGenerationDeficits` incl. parked coverage; explicit `hours` values (not the builder default).
- Builders come from the entity barrel (`course`, `biweekly`, `coTaught`, `placement`), extended with a local `AnalyzerCourse` wrapper adding `name/level/groupIndex`.

### Integration Tests:

- None — the runner is a dev tool outside the CI suites; DB-loading correctness is proven by the Phase-4 parity check against the SQL-derived report.

### Manual Testing Steps:

1. `pnpm exec supabase start` → restore `data/golden-plan.sql` → confirm the dump's assertions pass.
2. `ANALYZE_PLAN_A=4bc9fe99-33ae-4c58-9b66-9b8477dad33f pnpm analyze:plans` — single-plan mode: golden verdict + features render.
3. Add `ANALYZE_PLAN_B=<clone-id>` — two-plan mode: side-by-side columns; slot lines carry unplaced counts.
4. `pnpm bench:generation` against seed state — id lookup works.
5. Phase-4 parity check against `comparison-report.md`.

## Performance Considerations

Extraction is linear folds over ≤ ~500 placement rows per plan — trivially fast; the runner is dev-side, so the <200 ms drag budget is untouched. The analysis module must stay Workers-safe (no Node/DOM globals) so future in-app surfaces (B/C) can reuse it verbatim in SSR/worker/island contexts.

## Migration Notes

No schema changes. Nothing in this change touches prod. The golden snapshot (`data/golden-plan.sql`) remains local-only and gitignored; if lost, prod is the backup of record (runbook Methods 1–3).

## References

- Research: `context/changes/plan-quality-analyzer/research.md` (main body + Follow-ups 1–7)
- Target report / acceptance numbers: `context/changes/plan-quality-analyzer/comparison-report.md`
- Rig runbook: `context/changes/plan-quality-analyzer/gold-plan-import.md`
- Parent discovery notes: `context/changes/generation-quality-tuning/discovery-notes.md` (§6 analyzer spec, §7 expert session)
- Metric functions: `src/entities/timetable/model/generation/objective.ts:75-110`, `occupied-slots.ts:5`, `deficits.ts:15`, `verify.ts:31`
- Runner precedent: `bench/generation.bench.ts` + `vitest.bench.config.ts`
- Loaders: `src/shared/api/load-cohort-courses.ts`, `src/shared/api/load-placements.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Analysis Module Foundation

#### Automated

- [x] 1.1 Unit tests for lanes, board, course, completeness metrics pass: `pnpm test` — 7ed0f52
- [x] 1.2 Type check passes: `pnpm check` — 7ed0f52
- [x] 1.3 Lint + FSD structure pass: `pnpm lint` && `pnpm steiger` — 7ed0f52
- [x] 1.4 Build stays clean (Workers-safety): `pnpm build` — 7ed0f52

### Phase 2: Entity Lenses + Cross-Cohort Family

#### Automated

- [x] 2.1 Unit tests pass incl. `countStudentHoles` parity pin and mirrored-cell fixture-detector case: `pnpm test` — 6b932d0
- [x] 2.2 `pnpm check` && `pnpm lint` && `pnpm steiger` && `pnpm build` stay green — 6b932d0

### Phase 3: Dev Runner + Ride-Alongs

#### Automated

- [x] 3.1 `pnpm test` unaffected; `pnpm check` && `pnpm lint` && `pnpm build` green — 2122c93
- [x] 3.2 `pnpm analyze:plans` without env/ids skips gracefully with a usage message — 2122c93

#### Manual

- [x] 3.3 Single-plan run against the Golden Plan renders verdict + feature tables — 2122c93
- [x] 3.4 `pnpm bench:generation` passes against seed state with id-based lookup — 2122c93

### Phase 4: First Real Run Recorded

#### Automated

- [x] 4.1 Full local gate green before closing: `pnpm check` && `pnpm lint` && `pnpm steiger` && `pnpm test` && `pnpm build`

#### Manual

- [x] 4.2 `analysis-run-1.md` recorded with full output, both verdicts, plan ids, date
- [x] 4.3 Verify-gold verdict recorded (world a or b, with reasons if b)
- [x] 4.4 Golden-side parity confirmed against `comparison-report.md` (two-grade tolerance)
- [x] 4.5 change.md notes updated with the outcome
