# Student Plan View Implementation Plan

## Overview

Build the read-only, **schedule-only** student perspective view at `/plans/[id]/students/[studentId]` — a single-cohort mirror of the shipped teacher plan view (grid + course list + switcher; no collision badges, no collision dialog, no availability shading). The change also executes the two structural moves the teacher-view work pre-committed to: generalizing the perspective domain in `entities/timetable`, and standing up the `src/widgets/timetable-board/` layer for the shared grid + course card (refactoring the teacher view onto it). It closes with the entity-audit cleanup: moving `lens.ts` back to `_pages/plan-detail`.

## Current State Analysis

From `context/changes/student-plan-view/research.md` (complete, on `main` at `348f190`), verified against the code:

- **The data chain fully exists.** `students.cohort` is a `NOT NULL` enum — a student belongs to exactly one cohort. `loadCohortCourses` already computes `studentKeys` per course as the overlap+merge union (`src/shared/api/load-cohort-courses.ts:60-84`), so the student membership predicate is a one-line mirror of `teacherCourses` (`src/entities/timetable/model/teacher-perspective.ts:18-19`). No schema, auth, or Action work.
- **The teacher view is architecturally ready to be subsetted.** `TeacherScheduleGrid.tsx` is a pure data-in component (imports only `shared/*` + `entities/timetable`); its teacher-only decorations (`unavailable` shading, `onInspect` badges, per-chip cohort tag) are additive. `groupCellOccupants` tolerates an empty collisions map (`cell-occupants.ts:57-59`), so a no-collision grid needs no new domain code.
- **`buildTeacherCourseItems`** (`src/_pages/teacher-plan-view/model/course-list.ts:32-88`) is persona-specific in only three places: the membership predicate, `coTeacherKeys`, and the `studentKeys` roster. Merge resolution, occurrences, and hours are persona-agnostic.
- **`src/widgets/` does not exist.** Two `_pages/*` slices cannot cross-import (steiger `forbidden-imports`), so sharing the grid forces the layer into existence.
- **`StudentTable.tsx` has no navigation to a student** — rows carry only Edit/Delete; `StudentCatalog` already holds `planId`.
- **Entity audit**: `lens.ts` is board-only view-state with one consumer (`_pages/plan-detail`, via `use-board-derivations.ts` and the `ui/lens/*` files) and zero collision coupling — a move-back candidate. The `fsd/insignificant-slice` override for `entities/timetable` (`steiger.config.ts:7-15`) is stale: the entity now has two production consumers.
- **Gates**: pre-commit runs `pnpm run steiger` (`steiger src --fail-on-warnings`) — a slice with one referencing slice trips `insignificant-slice` and blocks the commit. `pnpm check` (astro check) is the only valid type gate (lessons.md).

## Desired End State

- `/plans/[id]/students/[studentId]` renders a student's single-cohort static timetable (named `role="grid"`), a course list with occurrence times, hours, and a **Teachers** roster per card, and a header switcher (cohort dp1/dp2 toggle + single-cohort dropdown of anchor links, browsing both cohorts).
- The students table links each student's name (and a "View plan" row action) to their view.
- `src/widgets/timetable-board/` holds the shared `ScheduleGrid` + course list/card, consumed by both the teacher and student pages; the teacher view is refactored onto it with no behavior change (existing teacher e2e passes unmodified).
- `entities/timetable` exposes `studentCourses` and the generalized `buildPerspectiveCourseItems`; `lens.ts` lives back in `_pages/plan-detail/model/`; the stale steiger override is gone.
- Full CI gate green: `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build`, `pnpm test:integration`, `pnpm test:e2e` (including a new student-plan-view spec).

### Key Discoveries:

- `courses.filter(c => c.studentKeys.includes(studentKey))` is the exact student mirror of the teacher predicate — the file docstring pre-announces it (`teacher-perspective.ts:8-15`).
- `TeacherPlanPage`'s complexity (deriveCohortView, mergeCohortOccupants, availability, dialog — `TeacherPlanPage.tsx:41-77,110-179`) all vanishes for the student page; what remains is filter → `groupCellOccupants(…, new Map())` → grid.
- The student switcher **diverges** from the teacher switcher (cohort dimension) — it stays page-slice-local; only grid + card are shared widgets. Locked in research (Finding 5): cohort toggle is **client state** (the `StudentCatalog.tsx:66-96` state-`Tabs` idiom, not the `CohortSwitcher` anchor variant), initialized to the current student's cohort; toggling re-scopes the dropdown without navigating; picking a student navigates via a plain `<a>` (shareable URLs, middle-click).
- Nav highlight is free: `planNavItems` lists `/plans/${planId}/students` and `SidebarLayout` prefix-matches non-exact hrefs, so the nested detail route keeps **Students** lit.
- The route ladder to mirror: `src/pages/plans/[id]/teachers/[teacherId].astro` (503 no-supabase / 404 not-found / `PlanScopedError`).
- E2E helpers exist: `createStudent`/`createCourse`/`createPlan`/`deletePlan`/`gotoStable` (`e2e/support/`), modeled by `e2e/specs/teacher-plan-view.spec.ts`.

## What We're NOT Doing

- **No collision/clash surface for students**: no badges, no dialog, no `narrowViolationsToStudent`. Schedule-only, per the research scope decision.
- **No student availability** (no such table exists) — no empty-slot shading.
- **No searchable combobox switcher** — the cohort-scoped plain dropdown suffices; the vendored `command`/cmdk combobox remains a documented scale-only fallback.
- **No shared switcher widget** — each persona keeps its own (cohort asymmetry).
- **No print/PDF feature** — only the print-viability *design rules* carry over (no zoom, no sticky headers, no overflow-auto dependency, all content always in the DOM).
- **No schema changes, no new Astro Actions, no auth changes.**
- **No changes to the editing board's behavior** — `plan-detail` is touched only by the `lens.ts` move-back (imports, no logic).

## Implementation Approach

Four phases, each independently committable (pre-commit runs steiger + eslint):

1. Generalize the pure domain in `entities/timetable` (predicate + course-item builder), with the teacher view as the consumer proving no behavior change.
2. Extract the shared UI into `src/widgets/timetable-board/` and refactor the teacher view onto it (decision: **extract + refactor**, not duplicate). Docs that cite the layer layout update in the same phase (lessons.md doc-coupling rule).
3. Build the student slice: loader, page, switcher, route, students-table entry point.
4. E2E spec + entity-audit cleanup (`lens.ts` move-back).

Persona logic is kept **out** of the shared builder: `buildPerspectiveCourseItems` is parameterized only on a membership predicate and returns items carrying the raw `teacherKeys` + `studentKeys`; each persona's card decides what to render (teacher: co-teachers line + student roster; student: Teachers roster). This makes the builder a pure filter/reshape with zero persona branching.

## Critical Implementation Details

- **Steiger one-consumer window (Phase 2 → 3).** Pre-commit runs `steiger src --fail-on-warnings`; after Phase 2 the new `widgets/timetable-board` slice has one referencing slice (`teacher-plan-view`) and `fsd/insignificant-slice` will warn, blocking the commit. Add a scoped override for `./src/widgets/timetable-board/**` in `steiger.config.ts` with a comment naming the window (exact precedent: the entity's own override), and **remove it in Phase 3** when the student slice becomes the second consumer. Never `--no-verify`.
- **The course-item builder needs FULL cohort placements, not the student's.** `occurrencesOf` resolves a merge child's schedule through its *parent's* placements; pre-filtering placements to the student's courses would drop them. Only the grid's occupants are built from the narrowed placement set.
- **Cohort toggle is state, not navigation.** A bare cohort has no URL; the toggle re-scopes the dropdown list only. The current student is check-marked only while their own cohort is selected.
- **Widget grid must stay print-viable and behavior-identical for the teacher.** Teacher decorations become optional props (`unavailable?`, `onInspect?`, per-occupant `cohort?` tag); when absent, nothing about the markup contract changes (`role="grid"` tree, cells named when empty, break bands, semantic tokens only). The teacher e2e spec is the regression gate and must pass **unmodified**.

## Phase 1: Entity groundwork — perspective predicates + generalized course-item builder

### Overview

Make the pure domain persona-agnostic inside `entities/timetable`, with the teacher view consuming the generalized pieces (behavior unchanged). Drop the stale steiger override.

### Changes Required:

#### 1. Perspective module rename + student predicate

**File**: `src/entities/timetable/model/teacher-perspective.ts` → `src/entities/timetable/model/perspective.ts`

**Intent**: The module already documents itself as "generic timetable viewed through one person; the student view will mirror this shape" — rename it to match, and add the student predicate.

**Contract**: Keep `teacherCourses`, `narrowViolationsToTeacher`, `teacherUnavailableCells` (names and signatures unchanged — the latter two stay teacher-specific by design). Add `studentCourses(courses, studentKey)` filtering by `studentKeys` membership. Rename `teacherPlacements` → `perspectivePlacements` (it already takes an opaque course-id set; both personas use it). Update the entity barrel (`src/entities/timetable/index.ts`) and the sole consumer (`TeacherPlanPage.tsx`). Update the module docstring: derive-then-narrow guidance applies to the *collision* helpers; predicates are persona-symmetric.

#### 2. Generalized course-item builder moves into the entity

**File**: `src/_pages/teacher-plan-view/model/course-list.ts` → `src/entities/timetable/model/perspective-course-list.ts` (test moves alongside)

**Intent**: The builder's merge resolution, occurrence sorting, and hours attachment are persona-agnostic; only the membership filter and the "people" fields differ. Generalize so the student view reuses it without a parallel implementation.

**Contract**: `buildPerspectiveCourseItems({ cohort, courses, placements, merges, hours, memberOf })` where `memberOf: (course: GroupingCourse) => boolean` is the only persona input. Returns `PerspectiveCourseItem` = the current `TeacherCourseItem` shape with `coTeacherKeys` replaced by the raw `teacherKeys: string[]` (full set; a child falls back to its parent's, as today) — persona UIs derive "co-teachers" (exclude self) or "Teachers" (show all) at render. Keep `mergedIntoId`, occurrence union + `byDayThenPeriod` sort, and the child-with-direct-choices skip exactly as they are. `TeacherPlanPage` calls it with `memberOf = (c) => teacherCourses([c], teacher.id).length > 0` — or more directly a key-membership closure; `TeacherCourseList` derives `coTeacherKeys` locally. Adapt `course-list.test.ts` to the new home/API (assertions unchanged in substance).

#### 3. Stale steiger override removed

**File**: `steiger.config.ts`

**Intent**: The "one-consumer window" the override guarded is closed — `entities/timetable` has two referencing production slices (`plan-detail`, `teacher-plan-view`). Remove the override block; keep the file as `defineConfig([...fsd.configs.recommended])`.

**Contract**: `pnpm steiger` stays clean after removal (verifies the premise).

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Unit tests pass (moved builder test included): `pnpm test`
- Lint + FSD structure pass: `pnpm lint && pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- Teacher view at `/plans/[id]/teachers/[teacherId]` renders identically (grid, badges, course list with co-teachers + roster) against local seed data

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: `widgets/timetable-board` — shared grid + course card, teacher view refactored onto it

### Overview

Create the first `src/widgets/` slice holding the shared read-only board UI; refactor the teacher view to consume it with zero behavior change. Update every doc that states the FSD layer chain.

### Changes Required:

#### 1. New widget slice

**File**: `src/widgets/timetable-board/` (new slice: `ui/ScheduleGrid.tsx`, `ui/PerspectiveCourseList.tsx`, `model/course-info.ts` or equivalent, `index.ts` barrel)

**Intent**: House the composed read-only UI shared by the perspective views. FSD layer position: `_pages` → `widgets` → `entities` → `shared`.

**Contract**:
- `ScheduleGrid` — generalized from `TeacherScheduleGrid.tsx`. Props: `days`, `periods`, `gridLabel`, `occupantsByCell: Map<string, GridOccupant[]>` where `GridOccupant = CellOccupant & { cohort?: Cohort }`, plus optional `unavailable?: Map<string, AvailabilitySeverity>` and `onInspect?: (cohort: Cohort, target: CollisionInspectionTarget) => void`. Chip renders the cohort tag only when the occupant carries one; the collision/unavailable badge renders only when `(blocking || warning) && onInspect` is provided. All ARIA/markup, break bands, tone precedence, and print-viability rules preserved verbatim.
- `PerspectiveCourseList` — generalized from `TeacherCourseList.tsx`: same section/empty-state/card frame, title via `formatCourseBadgeLabel` with the same degrade-don't-crash fallback, cohort badge, merged-into note, hours, occurrence lines (through the `periodTimeRange` seam). Persona variation enters through props: `emptyMessage: string`, per-card `inlineNote?` (the teacher's "Co-teachers: …" line) and `roster: { label: string; names: string[] }` (teacher: "Students (N)"; student: "Teachers (N)") — computed by the page, so the widget stays name-resolution-free. Items are `PerspectiveCourseItem[]` from the entity.
- `CourseInfo` type moves here (widget-owned prop shape); the teacher loader imports it from the widget barrel (downward import, allowed).

#### 2. Teacher view refactor

**File**: `src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx` (+ delete `TeacherScheduleGrid.tsx`, `TeacherCourseList.tsx`)

**Intent**: Consume the widget; keep every derivation and the collision dialog exactly as-is. The page computes `inlineNote` (co-teachers) and `roster` (student names) per item and passes cohort-tagged occupants.

**Contract**: Rendered output is unchanged — the existing `e2e/specs/teacher-plan-view.spec.ts` passes without edits.

#### 3. Temporary steiger window for the new slice

**File**: `steiger.config.ts`

**Intent**: Until Phase 3 lands, `widgets/timetable-board` has one referencing slice and `fsd/insignificant-slice` would fail the pre-commit gate.

**Contract**: Scoped `"fsd/insignificant-slice": "off"` for `./src/widgets/timetable-board/**` with a comment naming the one-consumer window and its removal in this change's Phase 3.

#### 4. Doc-coupling updates (layer chain)

**File**: `CLAUDE.md`, `README.md`

**Intent**: Both docs state the layer import direction (`app` → `_pages` → `entities` → `shared`) and the project-structure tree; the new layer makes them stale (lessons.md: a doc that names a mechanism is coupled to it).

**Contract**: Layer chain becomes `app` → `_pages` → `widgets` → `entities` → `shared`; README's `src/` tree gains `widgets/ # Composed read-only UI shared across page slices (timetable-board)`; CLAUDE.md's Project Structure sentence mentions `widgets/`. Grep `context/foundation/ui-conventions.md` and `src/**` docblocks for other layer-chain citations and update any found.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Unit tests pass: `pnpm test`
- Lint + FSD structure pass: `pnpm lint && pnpm steiger`
- Build stays clean: `pnpm build`
- Teacher e2e passes unmodified: `pnpm test:e2e` (teacher-plan-view spec)

#### Manual Verification:

- Teacher view is pixel-equivalent to before (grid shading, badges, dialog, course cards) against local seed data

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Student slice — loader, page, switcher, route, entry point

### Overview

Stand up `src/_pages/student-plan-view/` mirroring the teacher slice, minus everything schedule-only scoping removes; wire the route and the students-table entry point; close the steiger window.

### Changes Required:

#### 1. Loader

**File**: `src/_pages/student-plan-view/api/loader.ts` (+ `api/index.ts`, slice `index.ts`)

**Intent**: One SSR load mirroring `loadTeacherPlanView` but single-cohort and schedule-only: plan identity, the plan's students (both cohorts, for the switcher), the student's cohort catalog + placements + merges + course info, and teacher names for the card rosters. No availability, no student names.

**Contract**: `loadStudentPlanView(supabase, planId, studentId): Promise<Result<StudentPlanViewData, StudentViewError>>` with the same error taxonomy (`not-found` / `unavailable`). `fetchPlanStudents` stays loader-local (mirrors `fetchPlanTeachers`, `loader.ts:143-155`): `students` select `id, full_name, cohort`, name-ordered, `limit(500)` → `StudentSummary = { id; fullName: string; cohort: Cohort }`. Data: `{ planId, planName, days, periods, student, students, courses, courseDisplay (Record), placements (full cohort, mapped to PlannerPlacement), teacherNames, courseInfo, merges }` — all plain serializable. `teacherNames` via `loadTeacherNames` over the cohort catalog's `teacherKeys` union; `courseInfo` fetch may be narrowed to the student's cohort (`.eq("cohort", …)`) since no cross-cohort rendering exists.

#### 2. Page island

**File**: `src/_pages/student-plan-view/ui/StudentPlanPage.tsx`

**Intent**: The slimmed single-cohort page: header (student name; "planName — student schedule" subtitle) + `StudentSwitcher` + widget `ScheduleGrid` + widget `PerspectiveCourseList`. Static after hydration; plain render-time calls into entity functions.

**Contract**: `studentCourses(courses, student.id)` → id set → `perspectivePlacements(placements, ids)` → `groupCellOccupants(studentPlacements, courseDisplay, new Map())` (no cohort tags, no `unavailable`, no `onInspect`). Items via `buildPerspectiveCourseItems` with the student membership predicate, `hours = deriveHours(placements, courses)` over the FULL cohort inputs. Card roster: `{ label: "Teachers (N)", names: item.teacherKeys.map(k => teacherNames[k] ?? k).sort(...) }`; no `inlineNote`. Empty message: "This student has no courses in this plan."

#### 3. Switcher

**File**: `src/_pages/student-plan-view/ui/StudentSwitcher.tsx`

**Intent**: The locked design — cohort dp1/dp2 toggle (client state, `Tabs`/`TabsList` as in `StudentCatalog.tsx:66-78`, initialized to the current student's cohort) beside a dropdown of anchors for the selected cohort's students (the `TeacherSwitcher.tsx` idiom: `DropdownMenuItem asChild → <a>`, check-mark via `aria-current`, `max-h-80 overflow-y-auto`).

**Contract**: Props `{ planId, students: StudentSummary[], current: StudentSummary }`. Toggling cohort re-scopes the list only (no navigation); the current student is check-marked only while their own cohort is selected; anchors go to `/plans/${planId}/students/${id}`. Trigger labeled "Switch student".

#### 4. Route

**File**: `src/pages/plans/[id]/students/[studentId].astro`

**Intent**: Near-verbatim copy of `src/pages/plans/[id]/teachers/[teacherId].astro` — same 503/404/`PlanScopedError` ladder, `loadPlanSummary` for the sidebar, `client:load` island, title from student name.

**Contract**: Nav highlight for **Students** comes free via the sidebar's prefix matching; no nav config change.

#### 5. Students-table entry point

**File**: `src/_pages/students/ui/StudentTable.tsx` (+ `StudentCatalog.tsx` threading)

**Intent**: Mirror the teachers-table pattern (`TeacherTable.tsx:235-248`): the name cell becomes a `StudentViewLink`, and the row-actions menu gains a "View plan" item via `studentViewHref(planId, id)`.

**Contract**: `StudentTable` gains a `planId: string` prop (passed from `StudentCatalog`, which already holds it). Students have no `code` column — only the name links.

#### 6. Close the steiger window

**File**: `steiger.config.ts`

**Intent**: The student slice is the widget's second referencing slice — remove the Phase-2 override; config returns to bare `fsd.configs.recommended`.

#### 7. Loader integration test

**File**: `src/_pages/student-plan-view/api/student-plan-view.integration.test.ts`

**Intent**: Mirror `teacher-plan-view.integration.test.ts` with the `src/test/factories/` builders: happy path (student found, cohort-scoped catalog/placements, teacher names present), `not-found` for unknown student/plan, and cohort scoping (a course from the other cohort never appears).

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Unit tests pass: `pnpm test`
- Lint + FSD structure pass (override removed): `pnpm lint && pnpm steiger`
- Build stays clean: `pnpm build`
- Integration tests pass: `pnpm test:integration`

#### Manual Verification:

- Students table name link and "View plan" action open the student's view
- Grid shows exactly the student's placed courses (spot-check against the board, incl. a merged course resolving through its parent's block and week A/B labels)
- Course cards list the right Teachers, hours, and occurrence times
- Switcher: toggle re-scopes to the other cohort without navigating; picking a student navigates; check-mark only on own cohort; URLs shareable/middle-clickable
- Unknown student id → 404 page; **Students** nav item stays highlighted on the detail route

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: E2E coverage + entity-audit cleanup (`lens.ts` move-back)

### Overview

Lock the student view's role-based contract in the browser, then execute the audit's relocation: `lens.ts` returns to `_pages/plan-detail`.

### Changes Required:

#### 1. Student plan view e2e spec

**File**: `e2e/specs/student-plan-view.spec.ts`

**Intent**: Full mirror of `teacher-plan-view.spec.ts` per the locked decision, plus the one novel interaction — the cohort-toggle re-scope. Reuse `e2e/support/` helpers; follow `e2e/CLAUDE.md` (role-based locators, state waits, plan-delete teardown, unique ids).

**Contract**: One journey: create plan + teacher + DP1 course + DP1 student (choosing the course) + a DP2 student; place the course on the board; students-table name link → student view; assert `role="grid"` named `${student} timetable` with the chip in the named `gridcell`; course card's `Teachers of …` list contains the teacher and Occurrences carries the slot; switcher toggle to DP2 re-scopes the menu (DP1 student absent, DP2 student present) and navigating to the DP2 student renders their empty view ("This student has no courses in this plan." + full grid). Single-cohort — no dp1/dp2 merge assertions.

#### 2. `lens.ts` move-back

**File**: `src/entities/timetable/model/lens.ts` → `src/_pages/plan-detail/model/lens.ts` (with `lens.test.ts`)

**Intent**: The audit's verdict — board-only view-state, single consumer, zero collision coupling; the entity boundary returns to the 2+-consumer bar.

**Contract**: Remove the barrel export (`entities/timetable/index.ts:9`) and update the barrel's docstring (drop "lenses"). Update every `plan-detail` import of lens symbols (`deriveLensMatches`, `LensCriterion`, `criterionId`, `buildLensOptions`, `mergeEffectiveCriteria`, `combineLensCounts`, `pruneCriteria`, `buildLensUniverse`, types) from `@/entities/timetable` to the slice-internal module per the intra-slice relative-import convention (`ui-conventions.md`: relative within a slice). No logic changes. Grep docs/docblocks for citations of the module's old home and update any found (lessons.md doc-coupling rule).

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Unit tests pass (lens test in its new home): `pnpm test`
- Lint + FSD structure pass: `pnpm lint && pnpm steiger`
- Build stays clean: `pnpm build`
- Full e2e suite passes (new student spec + unmodified teacher spec): `pnpm test:e2e`

#### Manual Verification:

- Board lens (search/highlight) works unchanged after the move (pick a course/teacher/student criterion; chips highlight; counts render)

**Implementation Note**: After completing this phase and all automated verification passes, the change is done — run `/verify` to mirror the full CI gate before merging.

---

## Testing Strategy

### Unit Tests:

- `perspective-course-list.test.ts` (moved + adapted): membership filtering via `memberOf`, merge-parent resolution to children, occurrence union + sort, hours fallback child→parent, child-with-direct-choices skip, raw `teacherKeys`/`studentKeys` passthrough.
- `perspective.ts`: `studentCourses` membership; `perspectivePlacements` filtering (existing teacher tests renamed/extended).
- Student switcher list-scoping logic if extracted as a pure helper (cohort filter + current-marking); otherwise covered by e2e.

### Integration Tests:

- `student-plan-view.integration.test.ts`: happy path, unknown student/plan → `not-found`, cohort scoping (other-cohort course excluded), teacher-name resolution.

### Manual Testing Steps:

1. `pnpm exec supabase db reset && pnpm dev`; open a seeded plan's Students page; click a student name.
2. Compare the student's grid against the board for the same cohort (placements, week labels, merged sessions).
3. Exercise the switcher: same-cohort navigation, cohort toggle re-scope, cross-cohort navigation, browser back/forward.
4. Verify the teacher view still renders with shading + collision badges + dialog (regression).

## Performance Considerations

The page is static after hydration; all derivations are render-time pure calls over one cohort's data (strictly less than the teacher view's two-cohort load). No memoization needed — same conclusion as the teacher page's docblock. The <200ms constraint budget is untouched (no constraint-path changes).

## Migration Notes

No schema or data migrations. Module moves (`course-list` → entity, grid/card → widget, `lens` → plan-detail) are source-only; each phase leaves the tree steiger-clean via the scoped-override window described in Phase 2/3.

## References

- Related research: `context/changes/student-plan-view/research.md`
- Parent change: `context/archive/2026-07-05-teacher-plan-view/` (plan + research)
- Teacher route: `src/pages/plans/[id]/teachers/[teacherId].astro`
- Grid to generalize: `src/_pages/teacher-plan-view/ui/TeacherScheduleGrid.tsx`
- Builder to generalize: `src/_pages/teacher-plan-view/model/course-list.ts:32-88`
- Switcher idioms: `src/_pages/teacher-plan-view/ui/TeacherSwitcher.tsx:12-44`, `src/_pages/students/ui/StudentCatalog.tsx:66-96`
- Entry-point pattern: `src/_pages/teachers/ui/TeacherTable.tsx:235-248`
- E2E model: `e2e/specs/teacher-plan-view.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Entity groundwork

#### Automated

- [x] 1.1 Type check passes: `pnpm check` — 51f16f4
- [x] 1.2 Unit tests pass (moved builder test included): `pnpm test` — 51f16f4
- [x] 1.3 Lint + FSD structure pass: `pnpm lint && pnpm steiger` — 51f16f4
- [x] 1.4 Build stays clean: `pnpm build` — 51f16f4

#### Manual

- [x] 1.5 Teacher view renders identically against local seed data — 51f16f4

### Phase 2: widgets/timetable-board + teacher-view refactor

#### Automated

- [x] 2.1 Type check passes: `pnpm check` — a0e2367
- [x] 2.2 Unit tests pass: `pnpm test` — a0e2367
- [x] 2.3 Lint + FSD structure pass: `pnpm lint && pnpm steiger` — a0e2367
- [x] 2.4 Build stays clean: `pnpm build` — a0e2367
- [x] 2.5 Teacher e2e passes unmodified: `pnpm test:e2e` (teacher-plan-view spec) — a0e2367

#### Manual

- [x] 2.6 Teacher view pixel-equivalent (grid shading, badges, dialog, course cards) — a0e2367

### Phase 3: Student slice — loader, page, switcher, route, entry point

#### Automated

- [x] 3.1 Type check passes: `pnpm check` — 0707e8d
- [x] 3.2 Unit tests pass: `pnpm test` — 0707e8d
- [x] 3.3 Lint + FSD structure pass (override removed): `pnpm lint && pnpm steiger` — 0707e8d
- [x] 3.4 Build stays clean: `pnpm build` — 0707e8d
- [x] 3.5 Integration tests pass: `pnpm test:integration` — 0707e8d

#### Manual

- [x] 3.6 Students table name link and "View plan" action open the student's view — 0707e8d
- [x] 3.7 Grid shows exactly the student's placed courses (incl. merged course + week labels) — 0707e8d
- [x] 3.8 Course cards list the right Teachers, hours, and occurrence times — 0707e8d
- [x] 3.9 Switcher: toggle re-scopes without navigating; picking navigates; check-mark only on own cohort — 0707e8d
- [x] 3.10 Unknown student id → 404; Students nav stays highlighted — 0707e8d

### Phase 4: E2E + lens.ts move-back

#### Automated

- [x] 4.1 Type check passes: `pnpm check`
- [x] 4.2 Unit tests pass (lens test in its new home): `pnpm test`
- [x] 4.3 Lint + FSD structure pass: `pnpm lint && pnpm steiger`
- [x] 4.4 Build stays clean: `pnpm build`
- [x] 4.5 Full e2e suite passes (new student spec + unmodified teacher spec): `pnpm test:e2e`

#### Manual

- [x] 4.6 Board lens works unchanged after the move
