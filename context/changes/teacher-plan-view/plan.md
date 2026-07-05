# Teacher Plan View Implementation Plan

## Overview

Build a read-only, print-viable page showing the plan from one teacher's perspective at `/plans/[id]/teachers/[teacherId]`: a static timetable grid filtered to the courses that teacher conducts (with availability shading and inspectable collision badges), plus a course list below with occurrence times, always-visible student rosters, hours placed/required, co-teachers, and cohort/level badges. The page is the first of a planned family of read-only perspective views (student view next), so the pure read-side scheduling domain is first extracted into a new FSD `entities/timetable` slice that both `plan-detail` and this page consume.

## Current State Analysis

- **All data exists** — `course_teachers` (co-teaching sets), `student_choices` (with overlap/merge unions computed in `loadCohortCourses`, `src/shared/api/load-cohort-courses.ts:60-84`), `placements` (`day`, `period`, `week a/b/both`), `teacher_availability`. No schema work needed. There are **no wall-clock times** anywhere; "occurrence time" is `(day, period, week)` plus a new cosmetic in-code period→time map.
- **The collision core is 100% pure** and decoupled from editing state: `deriveCellViolations(placements, catalogById, availability, occupiedByTeacher)` (`src/_pages/plan-detail/model/collision/collisions.ts:33`) runs a constraint registry (`constraints/index.ts:10`) covering duplicate-course, teacher double-booking, student overlap, teacher-availability (strong→block / soft→warn), and cross-cohort teacher conflicts — all week-aware where relevant. Only thin `useMemo` wrappers (`use-board-derivations.ts:27-31`) touch React.
- **Availability data is already loaded** by `loadCombinedPlannerData` (`src/_pages/plan-detail/api/load.ts:76`) and indexed by `buildAvailabilityIndex` (`model/cross-cohort/availability-index.ts:32`) — but today availability only surfaces through *occupied-cell* violations; there is no empty-slot shading derivation.
- **No read-only board rendering exists.** `SlotCell`/`PlacedChip` call dnd-kit hooks unconditionally; the grid frame is print-hostile (zoom, sticky headers, `overflow-auto` shell). A dedicated static grid is the sanctioned path (research §3).
- **`src/entities/` does not exist.** `steiger.config.ts` is plain `fsd.configs.recommended` — an entities layer is accepted with zero config changes. No ESLint import-boundary rules; steiger is the only boundary enforcement.
- **Entanglement that forces the extraction boundary:** `cell-occupants.ts` value-imports `cellKey` and type-imports `CellCollisions` from the collision core, and `week.ts` is imported by three constraint files — so a partial move of the read-side modules would create a forbidden `entities → _pages` import. The teacher view needs collision derivation (scope decision #5), making it a genuine second consumer of the collision core: **the whole pure read-side core moves** (decided during planning).
- **Docs pin the moved code** (lessons.md doc-coupling rule): `CLAUDE.md:10` and `README.md:91` say the constraint core lives in `src/_pages/plan-detail/model/`; `src/shared/lib/catalog-hash/types.ts:14` names `plan-detail model/course-display.ts`. All must be updated in the same change.
- **Route/nav mechanics:** `src/pages/plans/[id]/teachers.astro` is the canonical SSR route template (`isPlanId` guard → `Promise.all` loaders → 404/503 → island `client:load`). `SidebarLayout` highlights nav by path prefix, so nesting under `/teachers/` highlights the Teachers item for free. `CohortSwitcher` (`ui/chrome/CohortSwitcher.tsx:16-42`) establishes link-navigation switchers via `asChild` anchors.

## Desired End State

An authenticated author can open `/plans/<planId>/teachers/<teacherId>` (from a row action or the teacher's name in the teachers table) and see:

1. A **static, print-friendly grid** (no zoom/sticky/drag) showing only that teacher's placed courses — week A/B aware, merged composites as one block, the teacher's blocked slots shaded (strong/soft), and collision badges on conflicted cells that open the existing collision details dialog.
2. A **course list** below: every course the teacher conducts (merge composites resolved to real child courses), each with occurrence times ("Mon P3 · 09:55–10:40 · Week A"), hours placed/required, co-teachers, cohort/level badges, and a compact always-visible multi-column student roster.
3. A **teacher switcher** in the page header navigating between teachers' URLs.

Verify by: unit + integration + e2e suites green (`pnpm test`, `pnpm test:integration`, `pnpm test:e2e`), full CI gate green, and manual walkthrough of the page against a seeded plan.

### Key Discoveries:

- `deriveCellViolations` and the whole constraint registry are pure and directly reusable (`collisions.ts:33`, `constraints/index.ts:19`); violations carry `teacherKey`/`courseIds`, so narrowing to one teacher needs no new core logic
- `CollisionDetailsDialog` (`ui/overlay/CollisionDetailsDialog.tsx:33`) is a pure declarative view over `CollisionViolation[]` — it moves to the entity's `ui/` so both slices can use it
- Placement types (`PlannerPlacement`/`LocalPlacement`) live in `model/placement/placement.ts` and must move with the domain (imported by hours/lens/cell-occupants)
- `GroupingCourse`/`CourseDisplay` types already live in `shared/lib/catalog-hash` — no promotion needed
- The teachers loader (`src/_pages/teachers/api/loader.ts:16-59`) shows the per-teacher course-grouping pattern; `TeacherTable.tsx` shows badge (`formatCourseBadgeLabel`) and row-action (`TeacherRowActions` dropdown) conventions
- E2e conventions: role-based locators only, `*.spec.ts` under `e2e/specs/`, state-based waits, teardown via `deletePlan` (`e2e/CLAUDE.md`)

## What We're NOT Doing

- **Print CSS / PDF export** — deferred to a follow-up change that also owns the PRD Non-Goal amendment. This page only *preserves print viability* (design rules below).
- **Per-plan editable period times** — the period→time map is a hardcoded const behind a `periodTimeRange()` seam; schema + editing UI is future work.
- **Student plan view** — the architecture prepares for it (entity extraction, URL pattern), but nothing student-specific is built.
- **`widgets/` extraction** — the read-only board UI stays in the page slice until the second consumer (student view) exists.
- **Moving the editing machinery** — drag state, optimistic placements (`usePlacements`), undo/redo, drop dispatch, grouping enumeration, `assemble-combined-props.ts`, and all hooks stay in `plan-detail`.
- **Teacher-facing auth/roles** — the page is for signed-in plan authors; middleware is untouched.
- **Wall-clock times in the database** — display-only, in code.

## Implementation Approach

Four phases: (1) a **mechanical, zero-behavior-change extraction** of the pure read-side domain into `entities/timetable`, proven by the full green gate; (2) **new pure model** — the period-time seam and teacher-perspective derivations, TDD-able; (3) the **page itself** — promoted read fetchers, loader, route, static grid + course list UI, integration test; (4) **entry points and e2e**. Each phase lands independently green so CI never sees a broken intermediate state.

## Critical Implementation Details

- **Collision derivation input ordering:** per-teacher conflicts must be derived from the **full cohort placements** (plus availability index and the sibling cohort's cross-cohort index), *then* narrowed to cells/violations involving the teacher's courses. Deriving from pre-filtered teacher placements silently drops student-overlap and cross-cohort conflicts with other teachers' courses.
- **Island serialization boundary:** Astro island props must be plain serializable data — pass `Record`s/arrays (the board already serializes `courseDisplay` via `Object.fromEntries`, `load.ts:110`) and rebuild `Map`s/`Set`s inside the island by calling the pure entity functions at render time. The page is static; no memoization needed.
- **Print-viability design rules (scope decision #2, binding now):** static grid — no `zoom`, no sticky headers, no `overflow-auto` ancestor dependency; all content always in the DOM (no conditional-render disclosure; the collision *dialog* is the sanctioned exception — its indicators stay visible); semantic theme tokens only; the page must SSR-render fully at its stable URL (keeps Cloudflare Browser Rendering batch-PDF viable later).
- **Steiger slice mechanics:** the entity needs a public-API `index.ts`; cross-layer imports use the `@/entities/timetable` alias (import-style convention), intra-entity imports stay relative. Steiger's recommended `insignificant-slice` rule warns when a slice has exactly **one** referencing slice — true for the entity until `teacher-plan-view` lands in Phase 3 — and CI runs `--fail-on-warnings`, so Phase 1 ships a files-scoped override disabling that rule for `src/entities/timetable` (see Phase 1 §5; removable in Phase 3, or kept while the perspective-view family grows).

## Phase 1: Extract `entities/timetable` (mechanical move, zero behavior change)

### Overview

Create the `entities/timetable` slice and move the pure read-side scheduling domain into it; retarget all `plan-detail` import sites; tests travel with their modules; update the coupled docs. No logic changes of any kind.

### Changes Required:

#### 1. New entity slice — moved modules

**Files**: `src/entities/timetable/{model,lib,ui}/**`, moved from `src/_pages/plan-detail/`

**Intent**: Relocate the pure domain so a second page slice can legally consume it (FSD: `_pages → entities → shared`). Move, don't rewrite.

**Contract**: File moves (git `mv`; co-located `*.test.ts(x)` move alongside):

| From (`_pages/plan-detail/`) | To (`entities/timetable/`) |
|---|---|
| `model/placement/placement.ts` | `model/placement.ts` |
| `model/week.ts` (+ test) | `model/week.ts` |
| `model/course-display.ts` | `model/course-display.ts` |
| `model/hours.ts` (+ test) | `model/hours.ts` |
| `model/lens.ts` (+ test) | `model/lens.ts` |
| `model/collision/cell-key.ts` | `model/collision/cell-key.ts` |
| `model/collision/collisions.ts` (+ unit test; parity/perf tests stay — see closure notes) | `model/collision/collisions.ts` |
| `model/collision/constraints/*` (+ tests) | `model/collision/constraints/*` |
| `model/collision/intersects.ts` (+ test if present) | `model/collision/intersects.ts` |
| `model/collision/cell-occupants.ts` (+ test) | `model/collision/cell-occupants.ts` |
| `model/cross-cohort/availability-index.ts` (+ test if present) | `model/availability-index.ts` |
| `model/cross-cohort/cross-cohort-index.ts` (+ test if present) | `model/cross-cohort-index.ts` |
| `model/__fixtures__/builders.ts` | `model/__fixtures__/builders.ts` |
| `lib/period-breaks.ts` (+ test) | `lib/period-breaks.ts` |
| `ui/overlay/CollisionDetailsDialog.tsx` (+ test if present) | `ui/CollisionDetailsDialog.tsx` |

What **stays** in `plan-detail/model/`: `drag.ts`, `placement/placement-transitions.ts`, `grouping/`, `cross-cohort/assemble-combined-props.ts`, all `use-*` hooks, drop-hints/duplicate-target, **`collision/cell-tone.ts` (+ test)** — it consumes the editing-only `DropHint` type from `drop-hints.ts` and stays with the editing machinery, importing `CellCollisions` from the entity — and the whole `ui/` except the dialog. `lens-session.ts` and the `ui/lens/` components stay (they import lens *types* from the entity).

**Import-closure notes** (what makes the moved set legal for `entities/`):

- ~9 moved files (`hours.ts`, `lens.ts`, `collisions.ts`, `constraints/*`, `intersects.ts` + their tests) import `GroupingCourse` from staying-behind `../grouping/grouping` — which is itself a pure re-export of `@/shared/lib/catalog-hash` (`grouping.ts:4`). Retarget these imports to `@/shared/lib/catalog-hash` directly (same symbol, no code change).
- `collision-parity.test.ts` and `collisions.perf.test.ts` value-import `deriveDropHints` from staying-behind `drop-hints.ts` — they span both sides of the boundary and **stay** in `plan-detail/model/collision/`, importing the entity like any other plan-detail test.
- `model/__fixtures__/builders.ts` moves with the entity (its own imports are shared/move-set only); staying tests that use it (e.g. `drop-hints.test.ts`, the parity/perf tests) retarget to the entity fixture.

#### 2. Entity public API

**File**: `src/entities/timetable/index.ts`

**Intent**: Single import surface for consumers, satisfying steiger's public-API rule.

**Contract**: Pure barrel re-exporting every public symbol of the moved modules (types and functions). No `astro:*` imports exist in any moved module, so the barrel is Vitest-safe.

#### 3. Import-site retargeting in `plan-detail`

**Files**: ~68 staying files under `src/_pages/plan-detail/` (~49 source + ~19 test; model: `use-board-derivations.ts`, `use-cohort-board-state.ts`, `drag.ts`, `placement-transitions.ts`, `grouping/*`, `cross-cohort/assemble-combined-props.ts`, `lib/lens-session.ts`; ui: `PlannerBoard.tsx`, `PlannerGrid.tsx`, `slot-cell/*`, `palette/*`, `shelf/*`, `overlay/*`, `chrome/*`, `lens/*`). Note the `ui/overlay/index.ts` barrel re-exports `CollisionDetailsDialog` + `CollisionInspectionTarget`, and four files deep-import `CollisionInspectionTarget` from it (`PlannerGrid.tsx`, `SlotCell.tsx`, `PlacedChip.tsx`, `chrome/board-inspection.ts`) — all retarget to the entity.

**Intent**: Replace relative imports of moved modules with the entity barrel; behavior identical.

**Contract**: `../model/week` → `@/entities/timetable` (etc.). Where a file imported multiple moved modules, collapse to one barrel import. `api/load.ts` type imports retarget likewise.

#### 4. Coupled documentation updates

**Files**: `CLAUDE.md:10`, `README.md:91`, `src/shared/lib/catalog-hash/types.ts:14`

**Intent**: The doc-coupling lesson makes these updates part of this refactor's definition of done.

**Contract**: Both docs now state: the pure two-cohort constraint/validation core lives in `src/entities/timetable/` (shared by the board and perspective views); editing orchestration (drag state, optimistic placements, hooks) stays in `src/_pages/plan-detail/model/`; the <200ms placement-validation budget statement is preserved. The `types.ts` comment points at `entities/timetable/model/course-display.ts`.

#### 5. Steiger override for the one-consumer window

**File**: `steiger.config.ts`

**Intent**: The recommended `insignificant-slice` rule warns when a slice has exactly one referencing slice; until Phase 3 the entity's only consumer is `plan-detail`, and CI runs steiger `--fail-on-warnings`. A scoped override keeps Phases 1–2 independently green.

**Contract**: Files-scoped entry disabling `fsd/insignificant-slice` for `src/entities/timetable/**`, with a comment naming the one-consumer window and the planned second consumer (`teacher-plan-view`, Phase 3). Optionally removed in Phase 3 once the second consumer imports the entity.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm exec astro sync && pnpm check`
- Lint passes: `pnpm lint`
- FSD structure passes with the new layer: `pnpm steiger`
- Unit suite green with tests in moved locations: `pnpm test`
- Production build clean: `pnpm build`

#### Manual Verification:

- Board smoke test: drag-drop placement, collision badge + details dialog, lens highlight, week toggle, undo — all behave exactly as before
- `CLAUDE.md`/`README.md` constraint-core pointers read correctly against the new tree

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Perspective model + period times (pure domain, TDD)

### Overview

Add the new pure functions the page needs: the period→time seam and the teacher-perspective derivations (course/placement filtering, violation narrowing, empty-slot availability shading). All in the entity — generic "timetable viewed through one teacher" domain the student view will later mirror — and all unit-tested.

### Changes Required:

#### 1. Period→time map behind a seam

**File**: `src/entities/timetable/lib/period-times.ts` (+ `period-times.test.ts`)

**Intent**: Cosmetic display times for occurrence listings, following the `BREAK_AFTER_PERIODS` precedent (scope decision #1). Single lookup seam so a future per-plan timetable replaces the const without touching consumers.

**Contract**: `periodTimeRange(period: number): { start: string; end: string } | null` over a module const. Placeholder schedule (45-min periods, breaks after P2/P5 aligned with `BREAK_AFTER_PERIODS`): P1 08:00–08:45, P2 08:50–09:35, P3 09:55–10:40, P4 10:45–11:30, P5 11:35–12:20, P6 12:50–13:35, P7 13:40–14:25, P8 14:30–15:15, P9 15:20–16:05, P10 16:10–16:55. Out-of-range periods → `null`. Export via the entity barrel. Do not scatter time literals through the UI.

#### 2. Teacher-perspective derivations

**File**: `src/entities/timetable/model/teacher-perspective.ts` (+ `teacher-perspective.test.ts`)

**Intent**: The pure filtering/narrowing layer between full board data and the teacher page. Declarative pipelines (lessons.md), named predicates, no mutable accumulators.

**Contract**: Functions over existing entity types (`GroupingCourse`, `PlannerPlacement`, `CellCollisions`, `AvailabilityIndex`):
- `teacherCourses(courses, teacherKey)` — `teacherKeys` membership (same predicate the lens proved)
- `teacherPlacements(placements, teacherCourseIds)` — the teacher's occupied cells
- `narrowViolationsToTeacher(violations: Map<string, CellCollisions>, teacherKey, teacherCourseIds)` — keep only cells/violations involving the teacher's courses or naming their `teacherKey`; preserves the `blocking/warning/unavailable` semantics
- `teacherUnavailableCells(index: AvailabilityIndex, teacherKey): Map<cellKey, "strong" | "soft">` — the **new** empty-slot shading derivation (today availability only manifests on occupied cells)

Tests cover: co-teaching (course appears for each teacher in the set), week A/B disjointness in narrowing, merge composites (identical teacher sets), a student-overlap violation involving the teacher's course being kept, an unrelated violation being dropped, strong vs soft shading.

### Success Criteria:

#### Automated Verification:

- New unit tests pass: `pnpm test`
- Type gate passes: `pnpm check`
- Lint + structure pass: `pnpm lint && pnpm steiger`

#### Manual Verification:

- Placeholder bell-schedule values reviewed (one-const edit later if the real schedule differs)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Teacher view page — loader, route, UI

### Overview

Promote the plain read fetchers to `shared/api`, build the `_pages/teacher-plan-view` slice (loader + static grid + course list + switcher), wire the route, and cover the loader with an integration test.

### Changes Required:

#### 1. Promote plain read fetchers to `shared/api`

**Files**: `src/shared/api/load-placements.ts`, `src/shared/api/load-teacher-names.ts`, `src/shared/api/load-teacher-availability.ts` (extracted from `src/_pages/plan-detail/api/load.ts`), `src/shared/api/load-course-merges.ts` (same `course_merges` select `load-cohort-courses.ts` already runs internally — see loader contract below); retarget `load.ts` to consume them

**Intent**: CRUD-without-business-meaning reads belong in `shared/api` beside `load-cohort-courses.ts` (research follow-up); both loaders then compose the same primitives.

**Contract**: Same queries as today (`placements` select per plan+cohort; `teachers` select id/full_name/code; `teacher_availability` select teacher_id/day/period/severity — `load.ts:76,202-209`). Plain async fetchers taking `(supabase, planId, …)`, returning rows/records; error handling stays with the composing loader (`assertNoQueryErrors` convention). `loadCombinedPlannerData` behavior unchanged.

#### 2. Teacher-view loader

**File**: `src/_pages/teacher-plan-view/api/loader.ts` (+ `api/index.ts` barrel)

**Intent**: One SSR load returning everything the page needs, following the detail-page `Result` variant (ui-conventions §Loaders).

**Contract**: `loadTeacherPlanView(supabase: SupabaseClient | null, planId: string, teacherId: string): Promise<Result<TeacherPlanViewData, TeacherViewError>>` where `TeacherViewError = { kind: "not-found" } | { kind: "unavailable"; message: string }`. Not-found when the plan is missing, `teacherId` fails the UUID guard, or the teacher isn't in the plan. `TeacherPlanViewData` (all serializable — Records/arrays, no Maps): plan name + grid preset dims; `teacher { id, code, fullName }`; `teachers[]` (id/code/fullName, for the switcher); per cohort: courses (full catalog from `loadCohortCourses` — full, because collision derivation needs it; it already carries the overlap/merge-unioned `studentKeys`), `courseDisplay` record, placements; availability cells; `studentNames` record (for rosters); merge parent→children relations via a dedicated `loadCourseMerges` fetcher — `loadCohortCourses` queries `course_merges` internally (`fetchMerges`, `load-cohort-courses.ts:159-168`) but its returned `CohortCatalog` does **not** expose the mapping, so the loader issues its own select of the same relation. The course list resolves composites to real child courses with their own rosters; a merge child absent from the catalog (no direct student choices) still renders in the list with an empty roster rather than being dropped.

#### 3. Page island — static grid + course list + switcher

**Files**: `src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx` (island root), `ui/TeacherScheduleGrid.tsx`, `ui/TeacherCourseList.tsx`, `ui/TeacherSwitcher.tsx`, `src/_pages/teacher-plan-view/index.ts`; supporting pure helpers in `model/` as needed

**Intent**: The read-only surface. Derivations run at render by calling entity functions over props (full-cohort `deriveCellViolations` → `narrowViolationsToTeacher`; `buildAvailabilityIndex` → `teacherUnavailableCells`; `deriveHours` for the list). Simpler chips in the board's design language — shared `subjectChipClass` tokens, `weekLabel` for A/B, merged composite renders as the one block that is actually placed.

**Contract**:
- Grid: role-based ARIA contract per ui-conventions — `role="grid"` + `aria-label`, `columnheader`/`rowheader` via `dayLabel`/`periodLabel`, `gridcell`s named even when empty; `breaksAfterPeriod` spacing; availability shading via semantic warning/destructive-tinted tokens (never palette classes); collision badge on affected cells opens `CollisionDetailsDialog` (entity ui) with that cell's violations; `aria-invalid` on blocking cells. Static: no zoom, no sticky, no drag, fixed layout that lays out fully without an `overflow-auto` ancestor.
- Course list: one card/section per **real** course (composites resolved to children), showing occurrence times composed from placements + `periodTimeRange` ("Mon P3 · 09:55–10:40 · Week A"; biweekly courses show their week), hours `placed/required` via `deriveHours`, co-teachers (other names in the course's teacher set), cohort/level badges via `formatCourseBadgeLabel` conventions, and an always-visible compact multi-column roster (CSS columns; never conditional-rendered). Empty state: a teacher with no placed courses still renders the full grid (availability shading applies) with an explicit empty-list message below.
- Switcher: link-navigation like `CohortSwitcher` but as a dropdown of anchors (teacher count exceeds Tabs scale) — shadcn `DropdownMenu` with `DropdownMenuItem asChild` anchors to sibling teacher URLs, labeled with code + name, current teacher marked.
- Island mounts `client:load` (dialog + dropdown need hydration); page header shows plan name + teacher name/code.

#### 4. Route file

**File**: `src/pages/plans/[id]/teachers/[teacherId].astro`

**Intent**: Copy the `teachers.astro` template, guarding both params; nesting under `/teachers/` gives the sidebar nav highlight by prefix for free.

**Contract**: `createClient` → `isPlanId(Astro.params.id)` + teacher-id guard → `Promise.all([loadPlanSummary, loadTeacherPlanView])` → `Astro.response.status` 404/503 on `result.error.kind` → `<SidebarLayout plan={…}>` + island with serialized props. Note: `src/pages/plans/[id]/teachers.astro` and the new `teachers/[teacherId].astro` coexist fine in Astro routing.

#### 5. Loader integration test

**File**: `src/_pages/teacher-plan-view/api/teacher-plan-view.integration.test.ts`

**Intent**: Assert the roster/merge/co-teaching edges against a real database (lessons.md: listed integration tests must be implemented).

**Contract**: Factories harness (`createPlan`, `seedPlanCatalog`, `addMerge`, `addStudentWithChoices`, `placeCourse`, `addAvailability`, `teardown`); env-gated like `teachers-catalog.integration.test.ts`. Asserts: teacher not in plan → not-found; courses filtered by junction membership; merged parent resolves to children with separate rosters; availability cells present; placements carry week.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Lint + structure pass: `pnpm lint && pnpm steiger`
- Unit suite green: `pnpm test`
- Integration test green: `pnpm test:integration` (local Supabase running)
- Production build clean: `pnpm build`

#### Manual Verification:

- Page renders for a teacher with placed courses: grid shows only their courses; blocked slots shaded (strong vs soft distinguishable); a deliberately-created conflict shows a badge and the details dialog opens with the correct explanation
- Merged composite: one block on the grid; child courses listed separately below with their own rosters
- Course list shows occurrence times with the period time ranges, hours placed/required, co-teachers, cohort/level badges, dense multi-column rosters
- Switcher navigates between teachers; URL is stable/shareable; Teachers nav item is highlighted
- Bad `teacherId` or teacher from another plan → 404 page; signed-out access redirects to `/auth/signin`
- Dark mode renders correctly (tokens only)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Entry points + e2e

### Overview

Link the page from the teachers catalog and lock the behavior with a Playwright spec.

### Changes Required:

#### 1. Teachers table links

**File**: `src/_pages/teachers/ui/TeacherTable.tsx`

**Intent**: Both selected entry points: the teacher's code/name cell becomes a direct anchor to the view (master→detail), and `TeacherRowActions` gains a "View plan" item.

**Contract**: Name/code cell wraps its text in an `<a href={/plans/${planId}/teachers/${teacher.id}}>` with link styling consistent with tokens; `TeacherRowActions` adds a `DropdownMenuItem asChild` anchor to the same URL (idiom already used for `DropdownMenuTrigger asChild`). `TeacherTable` already receives `planId`.

#### 2. E2E spec

**File**: `e2e/specs/teacher-plan-view.spec.ts`

**Intent**: One authenticated spec locking the page's role-based contract end to end.

**Contract**: Follows `cohort-switching.spec.ts` conventions — `createPlan`/`createTeacher`/`createCourse` (+ a second teacher for the switcher), place a course via the existing board support helpers, then: navigate from the teachers table link → assert the grid (`getByRole("grid")`) shows the course chip and the course list shows the roster/occurrence line → use the switcher → `waitForURL` the sibling teacher → assert their (empty) view renders. Role-based locators only, state-based waits, `deletePlan` teardown.

### Success Criteria:

#### Automated Verification:

- Full local gate green: `pnpm check && pnpm lint && pnpm steiger && pnpm test && pnpm build`
- E2E suite green including the new spec: `pnpm test:e2e`

#### Manual Verification:

- Both entry points (name/code link, row action) navigate correctly from `/plans/[id]/teachers`
- Quick final walkthrough of the whole flow on the local stack

---

## Testing Strategy

### Unit Tests:

- Moved entity modules keep their existing co-located tests (moved verbatim in Phase 1)
- `period-times.test.ts`: range mapping, breaks alignment, out-of-range → null
- `teacher-perspective.test.ts`: co-teaching membership, week-aware narrowing, merge composites, kept vs dropped violations, strong/soft shading

### Integration Tests:

- `teacher-plan-view.integration.test.ts` (Phase 3): loader against real Postgres via the factories harness — junction filtering, merge resolution, rosters, availability, not-found

### Manual Testing Steps:

1. `pnpm exec supabase db reset` for seeded data; open a plan's teachers page; click a teacher with several placed courses
2. Verify grid filtering, availability shading (set some availability first via the existing dialog), and a forced conflict's badge + dialog
3. Verify the course list details (times, hours, co-teachers, badges, rosters) against Studio data
4. Switch teachers; verify a courseless teacher shows a sensible empty grid + empty list message
5. Verify 404s (garbage teacherId, teacher from another plan) and the signed-out redirect

## Performance Considerations

None material: the page loads the same board dataset the author already loads on `/plans/[id]`, derivations are pure O(placements) passes over ≤ a few hundred rows, and the page is static after hydration. The <200ms drag-drop budget is untouched — Phase 1 moves files without changing any code path.

## Migration Notes

No schema changes. Phase 1 is a pure code move — reviewable as `git mv` + import retargets; if anything smells behavioral in review, it's wrong. Docs move with the code (CLAUDE.md, README, `catalog-hash/types.ts` comment).

## References

- Related research: `context/changes/teacher-plan-view/research.md` (incl. resolved Scope Decisions §2026-07-05)
- Route template: `src/pages/plans/[id]/teachers.astro`
- Collision core: `src/_pages/plan-detail/model/collision/collisions.ts:33`, `constraints/index.ts`
- Availability index: `src/_pages/plan-detail/model/cross-cohort/availability-index.ts:32`
- Switcher idiom: `src/_pages/plan-detail/ui/chrome/CohortSwitcher.tsx:16`
- Badge/row-action conventions: `src/_pages/teachers/ui/TeacherTable.tsx`
- Loader conventions: `context/foundation/ui-conventions.md` §Loaders & the Result convention

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract `entities/timetable` (mechanical move, zero behavior change)

#### Automated

- [x] 1.1 Type gate passes: `pnpm exec astro sync && pnpm check`
- [x] 1.2 Lint passes: `pnpm lint`
- [x] 1.3 FSD structure passes with the new layer: `pnpm steiger`
- [x] 1.4 Unit suite green with tests in moved locations: `pnpm test`
- [x] 1.5 Production build clean: `pnpm build`

#### Manual

- [x] 1.6 Board smoke test — drag-drop, collision badge + dialog, lens, week toggle, undo all unchanged
- [x] 1.7 CLAUDE.md/README constraint-core pointers read correctly

### Phase 2: Perspective model + period times (pure domain, TDD)

#### Automated

- [ ] 2.1 New unit tests pass: `pnpm test`
- [ ] 2.2 Type gate passes: `pnpm check`
- [ ] 2.3 Lint + structure pass: `pnpm lint && pnpm steiger`

#### Manual

- [ ] 2.4 Placeholder bell-schedule values reviewed

### Phase 3: Teacher view page — loader, route, UI

#### Automated

- [ ] 3.1 Type gate passes: `pnpm check`
- [ ] 3.2 Lint + structure pass: `pnpm lint && pnpm steiger`
- [ ] 3.3 Unit suite green: `pnpm test`
- [ ] 3.4 Integration test green: `pnpm test:integration`
- [ ] 3.5 Production build clean: `pnpm build`

#### Manual

- [ ] 3.6 Grid filtering, availability shading, conflict badge + dialog verified
- [ ] 3.7 Merged composite: one grid block, resolved children in the list
- [ ] 3.8 Course list details (times, hours, co-teachers, badges, rosters) verified
- [ ] 3.9 Switcher navigates; Teachers nav item highlighted; URL shareable
- [ ] 3.10 404s and signed-out redirect verified
- [ ] 3.11 Dark mode renders correctly

### Phase 4: Entry points + e2e

#### Automated

- [ ] 4.1 Full local gate green: `pnpm check && pnpm lint && pnpm steiger && pnpm test && pnpm build`
- [ ] 4.2 E2E suite green including the new spec: `pnpm test:e2e`

#### Manual

- [ ] 4.3 Both teachers-table entry points navigate correctly
- [ ] 4.4 Final end-to-end walkthrough on the local stack
