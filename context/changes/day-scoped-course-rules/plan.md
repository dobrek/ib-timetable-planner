# Day-Scoped Course Rules Implementation Plan

## Overview

Capture the plan author's two remaining tacit rules as first-class domain rules in the
interactive validator: a new `finishes_early` course flag whose **blocking** edge-of-day
rule keeps flagged courses at the first/last occupied period of each enrolled student's
day, and a **warn-level** daily spread cap that flags a third same-day period of one
course. Both rules ship end-to-end for manual editing (board flags, drag hints, teacher
perspective, violation dialog) — independent of, and as the foundation for, the upcoming
plan generator (`context/changes/plan-generation/`).

## Current State Analysis

- The constraint core has exactly five **cell-scoped** constraints registered in
  `src/entities/timetable/model/collision/constraints/index.ts:10-16`; the registry is
  explicitly designed for additive extension ("adding a constraint touches only this
  array"), and `BoardContext` states board-only constraints add optional fields
  additively (`constraints/types.ts:15-19`).
- **No day-scoped rule exists**: `duplicate-course` is per-cell only, so nothing prevents
  placing 3+ periods of one course on the same day; the early-finish knowledge has **no
  representation anywhere** (schema, types, fixtures, PRD).
- Severity semantics have a single home: `buildCellCollisions` / `violationSeverity`
  (`collisions.ts:66-71,122-123`) — every kind blocks except `teacher-unavailable`,
  which carries its own severity. Warn renders amber (`tone-class.ts:12`), block renders
  destructive; prose per kind lives only in
  `src/entities/timetable/ui/CollisionDetailsDialog.tsx` (exhaustive `groupByKind`).
- `deriveCellViolations` has two production call sites: the editing board
  (`use-board-derivations.ts:46` ← `use-cohort-board-state.ts:199`) and the read-only
  teacher perspective (`TeacherPlanPage.tsx:203`). The student perspective derives no
  collisions.
- Drag hints do **not** call `explainCell` — `classifyCell` uses the ctx-free
  `violatesAny` fast path plus **explicit** wiring per board-only axis
  (`crossCohortFit`, `isStrongUnavailable` — `drop-hints.ts:204,215,241`). A constraint
  without `test` is invisible to hints unless wired explicitly. `findDuplicateTarget`
  reuses `deriveDropHints`, so it inherits any hint change (`duplicate-target.ts:47`).
- The courses CRUD chain has a clean precedent in `week_mode`: Zod `courseInput`
  (`src/_pages/courses/model/schemas.ts:33-50`) → `toCourseRecord`
  (`api/course-record.ts:7-16`) → `CourseFormDialog.tsx` (field + two default helpers)
  → `loader.ts:22-24,44-60` → `CourseRow` (`model/course.ts:14-33`) → inline badge in
  `CourseTable.tsx:56`.
- Generated DB types live at `src/shared/api/database.types.ts` (committed); no
  package.json regen script exists — the documented command is
  `pnpm exec supabase gen types typescript --local` (archived docs cite the old
  `src/lib/` path; the file has moved).

### Key Discoveries:

- Both new rules can be expressed as **per-cell evaluations over a day-occupancy
  index**, preserving the one-file-per-rule `CellConstraint` registry — no second
  registry or derivation pass needed (`constraints/types.ts:38-45`).
- `weekByCourseId` in `BoardContext` is the established side-map pattern for delivering
  course-scoped data the core needs without touching `GroupingCourse`
  (`constraints/types.ts:28-30`).
- `collectIdsBySeverity` (`collisions.ts:112-120`) handles any violation kind carrying
  `courseIds: string[]` without modification; only `violationSeverity` needs a new case.
- The informational perf test (`collisions.perf.test.ts`, <50 ms asserted, ~1 ms
  measured) gives ~50× headroom for the O(rows × students) index build.
- Integration tests seed the catalog via `src/test/factories/seed-plan-catalog.ts`; pure
  unit builders live at `src/entities/timetable/model/__fixtures__/builders.ts`.

## Desired End State

An author can mark a course "finishes early" in the catalog form (flag visible in the
courses table). On the board, any placement of a flagged course that is *not* at the
edge of an enrolled student's day shows a blocking (red) violation with a clear
explanation in the collision dialog; a third same-day period of any course shows a warn
(amber) violation. Drag previews classify target cells accordingly, auto-duplicate
placement avoids offending cells, and the teacher perspective shows the same flags. The
PRD registers both rules as FR-014/FR-015.

**Verification**: unit tests on the pure core (rule semantics matrix), CRUD integration
tests in the harness, and manual verification against the real dp1/dp2 plan.

## What We're NOT Doing

- **No generator work** — the `generatePlan()` port, engines, Web Worker, bulk RPC, and
  review UX all stay in `context/changes/plan-generation/`.
- **No PRD non-goal reversal** — reversing the auto-placement non-goal (`prd.md:463`)
  belongs to the generator change; this change only registers the two rules.
- **No `GroupingCourse` / catalog-hash changes** — the flag does not affect slot
  compatibility and must stay out of the staleness fingerprint (see Critical Details).
- **No grouping-enumeration participation** — both constraints omit `test`, so palette
  enumeration and `violatesAny` semantics are unchanged.
- **No board-chip badge for flagged courses** — the author assigned it to the
  generator's review UX; here the flag is visible in the catalog table and the
  violation dialog carries the explanation.
- **No warn on legal doubles** — the cap warns at ≥3 same-day periods in a shared week;
  2 periods/day stays silent.
- **No seed/fixture changes** — the column default covers generated seed rows; authors
  flag courses at runtime.
- **No new e2e (Playwright) coverage** — manual verification suffices for this scope.

## Implementation Approach

Additive extension of the existing registry pattern. Two new board-only
`CellConstraint` files evaluate per cell against a **week-aware day-occupancy index**
built once per derivation inside `deriveCellViolations` (both call sites inherit it for
free), plus a `finishesEarlyByCourseId` side-set threaded from the load paths — the same
delivery pattern as `weekByCourseId`. Drag hints get explicit `classifyCell` wiring
mirroring the cross-cohort axis. The CRUD chain copies the `week_mode` precedent
end-to-end. Phases follow FSD layer order: schema+CRUD first (standalone value), pure
core second, page-level delivery + PRD last.

## Critical Implementation Details

- **Keep `finishes_early` OUT of `GroupingCourse` and the catalog hash.** The flag does
  not change who can share a slot, and `GroupingCourse` is the catalog-hash staleness
  input (`src/shared/lib/catalog-hash/`): adding it would spuriously mark all existing
  groupings stale once and force palette recomputes on every toggle. Deliver it as a
  side-set in `BoardContext`, never as a `GroupingCourse` field.
- **Edge-rule semantics (the contract, week-aware).** For each placement `p` of a
  flagged course `F` and each student `s` enrolled in `F`: let `O` = the periods `s`
  occupies on `p.day` via courses *other than* `F`, restricted to placements whose week
  overlaps `p.week`. Violation unless `O` is empty, or `p.period ≤ min(O)`, or
  `p.period ≥ max(O)`. This is deliberately *per placement against other courses'
  periods* (not "first or last of all periods"), so a legal double at the edge — e.g.
  periods 1–2 before others at 3–5 — does not self-violate. Edge of the **student's
  day**, not the grid.
- **Stacking semantics (the contract, week-aware).** For a cell's course `c` on day
  `d` with week `w`: warn when the number of `c`'s placements on `d` whose weeks
  overlap a common concrete week (`a` or `b`; `both` counts in each) with `w` is ≥ 3.
  All participating cells of that day get the warn.
- **Existing plans may light up red the moment the rule lands.** Validation is advisory
  (accept-and-flag, never gating) — this is expected and by design; manual verification
  confirms flags on the real plan are accurate, not that none appear.
- **Drag hints require explicit wiring.** Constraints without `test` are invisible to
  `violatesAny` — and must stay so (compatibility is unaffected). Day-scoped drag
  feedback goes through explicit checks in `classifyCell` (the `crossCohortFit`
  pattern), and the what-if index must exclude the dragged origin placement on move
  (the existing exclude/origin machinery in `deriveDropHints`).
- **Types regen**: `pnpm exec supabase gen types typescript --local` writes
  `src/shared/api/database.types.ts` — archived docs cite the pre-FSD `src/lib/` path;
  don't recreate it there.

## Phase 1: Flag capture — schema + CRUD

### Overview

`courses.finishes_early` exists in the schema and flows through the full catalog CRUD
chain; authors can set and see it. Standalone value: the knowledge is captured even
before any validation consumes it.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_add_courses_finishes_early.sql` (via
`pnpm exec supabase migration new add_courses_finishes_early`)

**Intent**: Capture the early-finish attribute in the schema, additively.

**Contract**: `alter table public.courses add column finishes_early boolean not null
default false;` plus a column comment stating the business rule. No grant work (existing
table; default privileges carry). Existing rows and the generated seed behave
identically via the default.

#### 1b. Clone-plan carry-through

**File**: `supabase/migrations/<timestamp>_clone_plan_carry_finishes_early.sql`

**Intent**: `clone_plan` copies courses with an **explicit** column list — the latest live
definition (`20260707120004_clone_plan_carry_optional.sql:91-92`) inserts
`(id, plan_id, cohort, name, level, group_index, hours_per_week, week_mode, color)`. A new
`finishes_early` column absent from that list defaults to `false` on clone, so cloning a
plan silently resets the flag on every course. Re-create `clone_plan` adding
`finishes_early` to both the insert column list and the `select`.

**Contract**: Copy the body from the **latest live definition**, not an older migration
(per the lessons register — "Re-create SQL functions from the latest live definition"),
adding only `finishes_early` to the courses insert/select. A clone round-trip test asserts
a flagged course stays flagged after `clone_plan` (harness builders + teardown). If
clone-carry is intentionally deferred, say so explicitly with a rationale instead.

#### 2. Generated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Regenerate after `pnpm exec supabase db reset` so the new column is typed.

**Contract**: `pnpm exec supabase gen types typescript --local` — output path is the
FSD location above.

#### 3. Zod schema + record mapper

**File**: `src/_pages/courses/model/schemas.ts`, `src/_pages/courses/api/course-record.ts`

**Intent**: Add `finishesEarly` (boolean, default false) to `courseInput` next to
`weekMode`; `updateCourseInput` inherits. Map to `finishes_early` in `toCourseRecord`
so create and update both persist it.

**Contract**: shared schema is the single gate for form resolver and action input (per
the Actions lesson); mapper is the only camel→snake seam.

#### 4. Form field

**File**: `src/_pages/courses/ui/CourseFormDialog.tsx`

**Intent**: A checkbox/switch `FormField` labeled "Finishes early" (helper text: course
ends before year-end; placed at the edges of students' days), following the existing
field layout. Set the default in both `courseFormValues` (edit) and
`emptyCourseFormValues` (create).

**Contract**: react-hook-form + shared Zod resolver, `mode: "onTouched"` — unchanged.

#### 5. Read path + table indicator

**File**: `src/_pages/courses/api/loader.ts`, `src/_pages/courses/model/course.ts`,
`src/_pages/courses/ui/CourseTable.tsx`

**Intent**: Select `finishes_early`, expose `finishesEarly` on `CourseRow`, and render
an inline outline `Badge` ("Finishes early") in the Name cell next to the existing
Bi-weekly badge.

**Contract**: mirrors the `weekMode` read chain exactly.

#### 6. Tests

**File**: `src/_pages/courses/api/course-record.test.ts` (extend),
`src/_pages/courses/api/finishes-early.integration.test.ts` (new)

**Intent**: Unit-test the mapper includes the flag; integration-test create→read→update
round-trip of the flag through the real actions path (per the catalog-CRUD-integration
lesson — harness builders + teardown, not manual sign-off).

**Contract**: co-located `*.integration.test.ts`, run via `pnpm test:integration`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `pnpm exec supabase db reset`
- Type gate passes after types regen: `pnpm check`
- Lint + FSD structure pass: `pnpm lint` && `pnpm steiger`
- Unit suite passes: `pnpm test`
- Integration suite passes (flag round-trip included): `pnpm test:integration`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- Course form shows the "Finishes early" field; toggling it persists across reload
- Courses table shows the badge only for flagged courses

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Day-scoped rules in the constraint core

### Overview

The pure core learns both rules as registered constraints with correct severities and
dialog prose. Everything in this phase lives in `src/entities/timetable/` and is fully
unit-testable headlessly; no page delivers the new context yet.

### Changes Required:

#### 1. Day-occupancy index

**File**: `src/entities/timetable/model/day-occupancy-index.ts` (new, + test)

**Intent**: One O(rows × students) builder over `(placements, catalogById)` producing
the two views the rules need: per-student per-day occupied periods (with week + source
courseId) and per-course per-day placements (with week). Built once per derivation;
follows the `availability-index.ts` / `cross-cohort-index.ts` builder pattern (exported
empty constant included).

**Contract**: pure, week-carrying entries; consumers do week-overlap filtering via the
existing `weeksDisjoint` primitive (`model/week.ts:19`).

#### 2. Context + violation types

**File**: `src/entities/timetable/model/collision/constraints/types.ts`

**Intent**: Two additive optional `BoardContext` fields — `finishesEarlyByCourseId` and
the day-occupancy index — and two new `CollisionViolation` kinds.

**Contract**: `{ kind: "early-finish-edge"; courseIds: [string]; studentKeys: string[] }`
(blocking) and `{ kind: "course-day-stacking"; courseIds: string[]; count: number }`
(warn). **Both kinds carry `courseIds` (the flagged/stacked id[s]) — not a bare `courseId`.**
Three consumers walk `violation.courseIds` for every non-`duplicate-course` kind and would
break on a `courseId`-only shape: `collectIdsBySeverity` (`collisions.ts:117`),
`citedCourseIds` (`perspective.ts:72`, teacher-perspective narrowing), and the exhaustive
`groupByKind` dialog. `early-finish-edge` puts the single flagged id in `courseIds` (a
one-tuple) and carries `studentKeys` for the dialog. Ids stay opaque; names resolve at the
render edge.

#### 3. The two constraints

**File**: `src/entities/timetable/model/collision/constraints/early-finish-edge.ts`,
`.../course-day-stacking.ts` (new, one file per rule + tests), registered in
`constraints/index.ts` `CELL_CONSTRAINTS`

**Intent**: Implement the exact semantics from Critical Implementation Details as
board-only constraints (no `test`), each evaluating only the current cell's occupants
against the day-occupancy index. Blame lands on the flagged/stacked course's ids only —
surrounding courses are not flagged.

**Contract**: `explain(occupants, ctx)` returning `[]` when the new ctx fields are
absent (regression path — all existing callers keep today's behavior until Phase 3
delivers the context). Declarative style per the lessons register.

#### 4. Severity + derivation wiring

**File**: `src/entities/timetable/model/collision/collisions.ts`

**Intent**: `violationSeverity` maps `course-day-stacking` → `warn` (edge rule defaults
to `block`); `deriveCellViolations` gains one optional trailing param for the flag set,
builds the day-occupancy index internally from its existing inputs, and passes both via
ctx.

**Contract**: trailing optional param keeps all positional callers (perf/parity tests,
teacher perspective) compiling unchanged.

#### 5. Dialog prose

**File**: `src/entities/timetable/ui/CollisionDetailsDialog.tsx`

**Intent**: The exhaustive `groupByKind` forces two new sections — "Must be first or
last lesson" (blocking style, names the affected students) and "Same-day stacking"
(amber warn style, names the course and count), following the existing section idiom.

**Contract**: exhaustiveness is compiler-enforced; no other UI change in this phase.

#### 6. Fixtures + unit tests

**File**: `src/entities/timetable/model/__fixtures__/builders.ts` (extend), constraint
test files (new)

**Intent**: Builder helpers for flagged courses and day-occupancy contexts; a semantics
matrix covering: others-empty (no violation), interior placement (block), edge double
(prefix/suffix — no violation), interior double (block), week interplay (`both`/`a`/`b`,
opposite-week neighbors don't count), multi-student blame, stacking at 2 (silent) vs 3
(warn) vs mixed-week 3 (warn only where a concrete week stacks).

**Contract**: co-located `*.test.ts`, pure, no DOM.

### Success Criteria:

#### Automated Verification:

- Type gate passes (exhaustive union forces dialog + severity updates): `pnpm check`
- Lint + FSD structure pass: `pnpm lint` && `pnpm steiger`
- New constraint/index tests + full unit suite pass: `pnpm test`
- Informational perf test still well under threshold: `pnpm test` (collisions.perf)
- Production build stays clean: `pnpm build`

#### Manual Verification:

- None — pure model change; the context is not delivered to any page until Phase 3, so
  UI behavior is intentionally unchanged. Board-level verification happens in Phase 3.

**Implementation Note**: No pause needed after this phase if automated criteria pass
(no user-visible change); proceed to Phase 3.

---

## Phase 3: Board delivery, drag hints, PRD registration

### Overview

The flag set reaches both `deriveCellViolations` call sites and the drag-hint what-if
path; drag previews and auto-duplicate placement respect the rules; the PRD registers
FR-014/FR-015. This phase makes the rules visible to the author.

### Changes Required:

#### 1. Shared course load

**File**: `src/shared/api/load-cohort-courses.ts`

**Intent**: Select `finishes_early` and expose the flagged-course ids alongside the
`GroupingCourse[]` — **without adding a field to `GroupingCourse`** (catalog-hash
constraint above).

**Contract**: additive return shape (e.g. courses + `finishesEarlyCourseIds`); grouping
compute and catalog-hash inputs remain byte-identical.

#### 2. Plan-detail delivery

**File**: `src/_pages/plan-detail/api/load.ts`,
`src/_pages/plan-detail/model/cross-cohort/assemble-combined-props.ts`,
`src/_pages/plan-detail/model/use-cohort-board-state.ts`,
`src/_pages/plan-detail/model/use-board-derivations.ts`

**Intent**: Thread a per-cohort `finishesEarlyByCourseId` set through
`SharedBoardProps` into the `useCollisions` and `useDragHints` memos (dependency lists
updated), next to the availability index.

**Contract**: same plumbing seam as `availability` / `crossCohortOccupancy` props.

#### 3. Drag-hint classification

**File**: `src/_pages/plan-detail/model/drop-hints.ts`

**Intent**: Explicit day-scoped checks in `classifyCell`, mirroring `crossCohortFit`:
dragging a flagged course marks cells interior to any enrolled student's day as
**blocked**; dragging any course marks cells that would create a ≥3 same-day stack (in
a shared week) as **warn**. The what-if index must exclude the drag origin on move.
**Extend the candidate-seeding loop** (`drop-hints.ts:114-123`), not just `classifyCell`:
`deriveDropHints` only classifies cells present in its `candidates` map, and **empty**
cells enter that map solely through the teacher-unavailable/cross-cohort seeding branches.
Both new rules can offend *empty* cells the loop never adds today — an empty cell interior
to an enrolled student's day (edge rule), and an empty cell that would be a course's 3rd
same-day period (stacking). Add those empty cells to `candidates` (mirroring the existing
availability/cross-cohort branches) so they reach `classifyCell`; extending `classifyCell`
alone leaves them rendered free.
`findDuplicateTarget` inherits both via `deriveDropHints` — see item 3b below for the
threading it still needs (it is **not** a no-op change).

**Contract**: `deriveDropHints` signature gains the flag set; hint severity vocabulary
(free/warn/blocked/opposite-week) unchanged. Stays within the <200 ms drag budget
(index build is once per drag, sub-ms at this scale).

#### 3b. Auto-duplicate threading

**File**: `src/_pages/plan-detail/model/placement/duplicate-target.ts` (+ its caller)

**Intent**: `findDuplicateTarget` builds its **own** `deriveDropHints(...)` call
(`duplicate-target.ts:47`) from an explicit arg list (`FindDuplicateTargetArgs:12-23`), so
the new trailing flag-set param does **not** flow to it for free — left unthreaded it
defaults to empty and auto-duplicate ignores the edge rule (contradicting Desired End
State's "auto-duplicate placement avoids offending cells" and Testing step 4). Add
`finishesEarlyByCourseId?` to `FindDuplicateTargetArgs`, pass it into `deriveDropHints` at
line 47, and supply it from `findDuplicateTarget`'s caller (the same board state that owns
the flag set for the drag-hint memo).

**Contract**: classification *logic* is inherited via `deriveDropHints`; only the flag-set
*data* is threaded here — a small, mechanical plumb, not a no-op.

#### 4. Teacher perspective

**File**: `src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx` (+ its load path),
`src/entities/timetable/model/perspective.ts` (verify only)

**Intent**: Deliver the flag set into `deriveCohortView`'s `deriveCellViolations` call
(`TeacherPlanPage.tsx:203`) so the read-only perspective flags identically to the editing
board. `narrowViolationsToTeacher` (`perspective.ts:39-54`) is the narrowing layer behind
the teacher perspective; its `citedCourseIds` (`perspective.ts:72`) handles both new kinds
generically **because** they carry `courseIds` (per 2.2) — so no code change, but confirm
the narrowing keeps an `early-finish-edge`/`course-day-stacking` violation for the teacher
of the flagged/stacked course (add a narrowing unit case).

**Contract**: built inline next to the existing `crossIndex` construction; the view's
loader gains the flag data the same way plan-detail's does. `perspective.ts` stays untouched
if the `courseIds` shape from 2.2 holds; a `courseId`-only shape would break it at compile.

#### 5. Perf/parity coverage

**File**: `src/_pages/plan-detail/model/collision/collisions.perf.test.ts`,
`src/_pages/plan-detail/model/collision/collision-parity.test.ts`

**Intent**: Extend the perf scenario to pass a non-empty flag set (measurement reflects
real cost); add a parity case asserting a flagged interior placement blocks and a
3-stack warns through the committed-verdict boundary.

**Contract**: perf test stays informational (<50 ms assert unchanged).

#### 6. PRD registration

**File**: `context/foundation/prd.md`

**Intent**: New "Domain model: day-scoped placement rules" subsection under
`## Scope of Change` registering **FR-014** (early-finish edge placement, blocking,
week-aware, edge of the *student's* day) and **FR-015** (max 2 periods of one course
per day; warn at 3+), following the FR-001/FR-002 idiom; note the new `finishes_early`
course attribute. The auto-placement non-goal is **not** touched.

**Contract**: prose amendment only; `## Non-Goals` untouched.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Lint + FSD structure pass: `pnpm lint` && `pnpm steiger`
- Unit suite (incl. parity + perf) passes: `pnpm test`
- Integration suite passes: `pnpm test:integration`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- Flag a real DP2 course; an interior placement shows the red ring and the dialog
  explains "Must be first or last lesson" with the affected students
- Moving that placement to the edge of the affected students' days clears the flag
- Placing a 3rd same-day period of any course shows the amber warn; 2 stays silent
- During drag of a flagged course, interior cells preview as blocked; drag stays
  instant (<200 ms budget)
- Teacher perspective shows the same violations read-only
- The real manual plan renders with accurate (not spurious) flags

**Implementation Note**: After this phase passes automated verification, pause for
manual confirmation of the checklist above — it is the change's acceptance test.

---

## Testing Strategy

### Unit Tests:

- Edge-rule semantics matrix (Phase 2.6): others-empty, interior, edge double,
  interior double, week interplay, multi-student blame, multi-flagged interplay
- Stacking matrix: 2 silent / 3 warn / mixed-week counting (`both` counts in each week)
- Day-occupancy index builder correctness
- Severity projection (`course-day-stacking` → warn) via `buildCellCollisions`
- Drop-hint classification for both rules incl. origin-exclusion on move

### Integration Tests:

- `finishes_early` CRUD round-trip through real actions (create → read → update),
  harness builders + teardown (per the catalog-CRUD lesson)
- `clone_plan` carry-through: a flagged course stays flagged after clone (Phase 1 · 1b)

### Manual Testing Steps:

1. Flag a DP2 course in the catalog; verify badge + persistence
2. Place it mid-day for an enrolled student → red ring + dialog section; move to day
   edge → clears
3. Stack a course 3× on one day → amber; remove one → clears
4. Drag preview: flagged course shows interior cells blocked; duplicate-target skips them
5. Open the teacher perspective for an affected teacher → same flags
6. Load the real manual plan → confirm flags are accurate, drag feels instant

## Performance Considerations

The day-occupancy index is O(rows × students) ≈ 254 × ~15 per full derivation — orders
of magnitude inside the ~50× headroom the perf test documents (sub-ms full-board
validation). Drag hints build the what-if index once per drag start (set-once-per-drag
semantics preserved), leaving the <200 ms placement budget untouched.

## Migration Notes

Additive nullable-free column with a default — no backfill, no seed regeneration, no
grant changes. **One SQL-function migration is required beyond the column add**: `clone_plan`
re-created from its latest live definition to carry `finishes_early` (Phase 1 · 1b) — the
explicit courses column list drops it otherwise. Hosted rollout is the normal CI `deploy`
path (`supabase db push` before Worker deploy). A code rollback does not undo the column;
it is inert without the code (default `false`, no reads). Existing plans show new violations
only after an author flags a course or has a pre-existing 3-stack — advisory flags, never
gating.

## References

- Research (feasibility + rule capture, follow-ups):
  `context/changes/plan-generation/research.md`
- Frame (two-part boundary, Hypothesis 4): `context/changes/plan-generation/frame.md`
- Constraint registry pattern: `src/entities/timetable/model/collision/constraints/index.ts:10-27`
- Side-map ctx precedent: `src/entities/timetable/model/collision/constraints/types.ts:21-35`
- CRUD chain precedent (`week_mode`): `src/_pages/courses/model/schemas.ts:33-50`
- Convention precedents: `context/archive/2026-06-20-co-teaching-teacher-sets/`,
  `context/archive/2026-06-21-bi-weekly-week-aware-validation/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles.

### Phase 1: Flag capture — schema + CRUD

#### Automated

- [x] 1.1 Migration applies cleanly (`pnpm exec supabase db reset`) — 5eefb2f
- [x] 1.2 Type gate passes after types regen (`pnpm check`) — 5eefb2f
- [x] 1.3 Lint + FSD structure pass (`pnpm lint` && `pnpm steiger`) — 5eefb2f
- [x] 1.4 Unit suite passes (`pnpm test`) — 5eefb2f
- [x] 1.5 Integration suite passes incl. flag round-trip (`pnpm test:integration`) — 5eefb2f
- [x] 1.6 Production build stays clean (`pnpm build`) — 5eefb2f

#### Manual

- [x] 1.7 Form field toggles + persists across reload — 5eefb2f
- [x] 1.8 Courses table badge shows only for flagged courses — 5eefb2f

### Phase 2: Day-scoped rules in the constraint core

#### Automated

- [x] 2.1 Type gate passes with new kinds (`pnpm check`) — 4bfbc47
- [x] 2.2 Lint + FSD structure pass (`pnpm lint` && `pnpm steiger`) — 4bfbc47
- [x] 2.3 New constraint/index tests + full unit suite pass (`pnpm test`) — 4bfbc47
- [x] 2.4 Perf test remains under threshold (`pnpm test` — collisions.perf) — 4bfbc47
- [x] 2.5 Production build stays clean (`pnpm build`) — 4bfbc47

### Phase 3: Board delivery, drag hints, PRD registration

#### Automated

- [x] 3.1 Type gate passes (`pnpm check`) — 173b0a3
- [x] 3.2 Lint + FSD structure pass (`pnpm lint` && `pnpm steiger`) — 173b0a3
- [x] 3.3 Unit suite incl. parity + perf passes (`pnpm test`) — 173b0a3
- [x] 3.4 Integration suite passes (`pnpm test:integration`) — 173b0a3
- [x] 3.5 Production build stays clean (`pnpm build`) — 173b0a3

#### Manual

- [x] 3.6 Interior flagged placement blocks (red ring + dialog names the students) — 173b0a3
- [x] 3.7 Moving that placement to the day edge clears the flag — 173b0a3
- [x] 3.8 3-stack warns; 2/day stays silent — 173b0a3
- [x] 3.9 Drag preview blocks interior cells for flagged courses; drag stays instant — 173b0a3
- [x] 3.10 Teacher perspective shows identical flags — 173b0a3
- [x] 3.11 Real manual plan renders accurate, non-spurious flags — 173b0a3
