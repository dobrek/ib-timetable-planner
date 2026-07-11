<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Day-Scoped Course Rules

- **Plan**: context/changes/day-scoped-course-rules/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-07-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 5 observations

## Summary

Faithful, high-quality implementation. Every planned item is present and correct; the
`clone_plan` re-creation (the highest-risk item) copied the latest live definition exactly;
`finishes_early` is correctly kept out of `GroupingCourse` and the catalog hash; the flag set
is threaded through all four consumers (committed collisions, drag hints, auto-duplicate,
teacher perspective). All five findings are polish-level observations. Fast CI gate verified
green (`pnpm check` 0 errors, `pnpm lint`, `pnpm steiger`, `pnpm test` 1131 passing, `pnpm build`).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING (3 observations, all now fixed) |
| Success Criteria | PASS |

## Findings

### F1 — Week-blind drag preview over-blocks flagged bi-weekly courses

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/model/drop-hints.ts:275 (edgeFit)
- **Detail**: `edgeFit` was week-agnostic and only returned fit/hard — never a soft opposite-week
  escape — while the committed rule (`early-finish-edge.ts:isInterior`) is week-aware and the
  sibling `crossCohortFit` grants a bi-weekly opposite-week escape. A flagged bi-weekly course
  dragged onto a cell interior only on the opposite week previewed as red "blocked" though the
  committed rule (and the actual drop) wouldn't flag it.
- **Fix**: Made `edgeFit` week-aware, mirroring `crossCohortFit`: bi-weekly member interior on
  exactly one concrete week → `soft` (opposite-week); interior on both → `hard`; agnostic member
  → hard on any interior cell. Extracted a shared `isInterior` helper; added 2 drag-hint tests
  (opposite-week escape + both-weeks block). Seeding stays a week-agnostic superset (harmless
  over-seed; `classifyCell` refines).
- **Decision**: FIXED

### F2 — Duplicated `distinctById` helper across the two new constraint files

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: early-finish-edge.ts:62 / course-day-stacking.ts:53
- **Detail**: Byte-identical private `distinctById` helper defined in both new constraint files.
- **Fix**: Extracted to `constraints/distinct-by-id.ts`; both constraints import it. Removed the
  now-unused `GroupingCourse` import from both.
- **Decision**: FIXED

### F3 — Imperative accumulators in the two new `explain` bodies (vs lesson)

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: early-finish-edge.ts:31 / course-day-stacking.ts:27
- **Detail**: Both `explain` bodies used `const violations = []` + `for…push`, where the closest
  board-only sibling `cross-cohort-teacher.ts` uses declarative `flatMap`. Accepted lesson
  "Prefer declarative pipelines over imperative accumulator loops" applies (precedent mixed).
- **Fix**: Rewrote both bodies as `distinctById(occupants).filter(...).flatMap(...)` pipelines,
  matching `cross-cohort-teacher.ts`.
- **Decision**: FIXED

### F4 — Delivery routed via a plan-scoped union, not the per-cohort threading the plan named

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — no action expected; documented deviation
- **Dimension**: Plan Adherence
- **Location**: src/_pages/plan-detail/model/use-board-derivations.ts:41
- **Detail**: Phase 3.2 listed `assemble-combined-props.ts` and a per-cohort set; the
  implementation delivers a single plan-scoped union on `SharedBoardProps.finishesEarlyByCourseId`,
  indexed once by `useFinishesEarlySet`, feeding both memos. Functionally equivalent because course
  ids are DB primary keys (globally unique across cohorts). `assemble-combined-props.ts` untouched.
- **Fix**: Added a "Post-implementation notes" addendum to the plan recording the simpler route.
- **Decision**: NOTED (plan addendum)

### F5 — Day-occupancy index built on every derivation (always-on stacking rule)

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — no action; verified within budget
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/entities/timetable/model/collision/collisions.ts:48
- **Detail**: `course-day-stacking` applies to ALL courses (FR-015, by design), so
  `deriveCellViolations` unconditionally builds the O(rows × students) day-occupancy index every
  derivation, even with zero flagged courses. Built once per derivation (not per cell), memoized,
  and measured under the <50ms informational ceiling (~50× headroom, inside the <200ms drag budget).
- **Decision**: ACCEPTED (informational; within budget)
