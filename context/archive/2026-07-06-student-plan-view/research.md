---
date: 2026-07-06T11:45:52+0200
researcher: Dobromir Kropielnicki
git_commit: 348f190aafcd76ad377b7123c0fab9d6f0db2143
branch: main
repository: 10xdev3 (ib-timetable-planner)
topic: "Feasibility of a read-only Student plan view (mirror of the Teacher plan view), plus an audit of what should live in entities/timetable"
tags: [research, codebase, student-plan-view, teacher-plan-view, entities-timetable, fsd, widgets]
status: complete
last_updated: 2026-07-06
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Switcher locked: cohort-toggle + single-cohort dropdown, toggle browses both cohorts; combobox is a scale-only fallback"
---

# Research: Student Plan View feasibility + `entities/timetable` audit

**Date**: 2026-07-06T11:45:52+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `348f190aafcd76ad377b7123c0fab9d6f0db2143`
**Branch**: `main`
**Repository**: 10xdev3 (ib-timetable-planner)

## Research Question

Three questions about a new read-only **student plan view** that mirrors the just-shipped **teacher plan view** (`context/archive/2026-07-05-teacher-plan-view/`), but from a student's perspective:

1. **Feasibility** of implementing the mirroring feature from a student perspective.
2. Are there **other elements that could be promoted to `entities/`** (or a shared layer) to support it?
3. Do the elements **already promoted to `entities/timetable` still hold** — are they all validly there?

**Scope decisions taken during this research** (via interactive Q&A):

- **Student view is _schedule-only_**: grid + course list + switcher. **No** collision/clash badges, **no** collision dialog, **no** availability shading. (Students have no availability table, and per-student clash QA is out of scope.)
- **Switcher scaling is in scope**: investigate how an in-page picker should handle many students vs. the teacher switcher's plain dropdown.

## Summary

**Highly feasible — the cheapest persona view yet, because it is a strict _subset_ of the teacher view.** The teacher-plan-view work was deliberately architected as "the first of a family of read-only perspective views," and both `entities/timetable/index.ts` and `teacher-perspective.ts:8-15` explicitly state *"the student view will mirror this shape."* Schedule-only scoping removes the three things that make the teacher view complex — collisions, availability shading, and two-cohort merging — so **most of the work is deletion, not addition.**

Six findings shape the answer:

1. **The data chain already exists and is single-cohort-clean.** `students.cohort` is a `NOT NULL` enum (`plans_as_domain_root.sql:46-51`) — a student belongs to exactly one cohort. `loadCohortCourses` already computes `studentKeys` per course as the overlap+merge **union** (`load-cohort-courses.ts:67,82`), so `courses.filter(c => c.studentKeys.includes(studentKey))` is the exact mirror of the teacher predicate. No schema work, no new Actions, no auth work.

2. **The student view is a strict subset of the teacher view.** Single-cohort + schedule-only collapses `TeacherPlanPage`'s two-cohort/collision/availability machinery to almost nothing (`deriveCohortView`, `mergeCohortOccupants`, `buildAvailabilityIndex`, `narrowViolationsToTeacher`, the dialog — all vanish). What remains: filter the student's courses → their placements → `groupCellOccupants(…, /* empty collisions */)` → grid; one course-list build; header + switcher.

3. **Q2 — two genuine promotions, on two different layers.** Pure domain: generalize `buildTeacherCourseItems` → `buildPerspectiveCourseItems` and add a one-line `studentCourses` predicate, both into **`entities/timetable`**. Composed UI: the static grid (and the course-card + switcher shell) must move into a **new `widgets/timetable-board` layer** — this is the extraction the teacher-view research pre-named as *"forced the moment the student view lands, since two `_pages/*` slices cannot cross-import."*

4. **Q3 — the entity boundary mostly holds, with one clear reconsideration.** Of 17 modules, 11 have two real production consumers and clearly earn their place. The single-consumer outliers: **`lens.ts` is board-only, has zero collision coupling, and is clean to move _back_ to `_pages/plan-detail`** (the schedule-only student view won't use it) — the strongest "no longer earns entity residency" call. `teacher-perspective.ts` and `period-times.ts` are single-consumer today but are exactly what the student view turns into 2-consumer, so they stay. The `fsd/insignificant-slice` override on the entity (`steiger.config.ts:13`) is **now removable** — there are already two referencing slices.

5. **Switcher: a cohort toggle next to the student picker simplifies it to a plain dropdown.** Pairing a dp1/dp2 segmented control with the student picker scopes it to one cohort (~26–35 names), where the existing flat `TeacherSwitcher` dropdown-of-anchors is already comfortable — so **no searchable combobox is needed** (and the `CommandItem` anchor-vs-`onSelect` wrinkle disappears). This reuses two shipped idioms verbatim: the students catalog's **cohort-`Tabs`-as-client-filter** (`StudentCatalog.tsx:66-96`) and the `TeacherSwitcher` anchor dropdown. The vendored `command`/cmdk combobox (`src/shared/ui/command.tsx`, proven in `LensPicker`) stays a **fallback** only if a single cohort ever grows into the hundreds. Add a per-row link on the students table too (it has _no_ navigation to a student today).

6. **One consequence to decide up front.** Extracting the grid to `widgets/` correctly means **refactoring the existing teacher view onto the shared widget** in the same change (so the widget has two consumers and there's no duplicate grid). That is more than "just build the student page" — it touches shipped teacher-view code. The archived plan already committed to this path; the alternative (duplicate the grid into the student slice) is DRY-hostile and discouraged.

**Net feasibility read: high.** Structural work is (1) stand up `src/widgets/timetable-board/` and move grid+card+switcher there (mechanical, forced), (2) generalize the course-list builder + add `studentCourses` in `entities/timetable` (mechanical), (3) new single-cohort loader + slimmed page + route + students-table entry link + e2e (mechanical copies). The only real design decision is the switcher control.

---

## Detailed Findings

### 1. Student data model — everything exists, and it's single-cohort-clean

**Schema (current, re-baselined by `supabase/migrations/20260611180006_plans_as_domain_root.sql`):**

- `students` is plan-owned with a **`NOT NULL` native `cohort` enum** (`'dp1' | 'dp2'`) — column at `:46-51`, enum type created at `:28`. **A student belongs to exactly one cohort.** This is *the* asymmetry vs. teachers, who span both cohorts via the `course_teachers` M:N junction (`20260620120000_course_teachers.sql`).
- `student_choices` carries denormalized `plan_id` + composite FKs `(plan_id, student_id)` and `(plan_id, course_id)` (`:55-63`). The FK pins a choice to the same **plan** but not the same **cohort** at the DB level.
- The **same-cohort-choice invariant is app-enforced**, not DB-enforced: `src/_pages/students/api/assert-choices-in-cohort.ts:12-29` rejects any course whose `cohort ≠` the student's, called from both write paths (`create-student.ts:12`, `update-student.ts:19`).
- **Caveat (non-blocking for this view):** `update-student.ts:8-17` documents a non-atomic window on a *cohort change* — the row's new cohort can commit before choices are reconciled, so a stray old-cohort choice can transiently attach. A student view scoped to the student's single cohort **sidesteps this**: `loadCohortCourses` fetches courses by `(plan_id, cohort)` and choices by those course ids, so an out-of-cohort choice simply never enters the loaded catalog.

**`studentKeys` is the fully-resolved roster** (`src/shared/api/load-cohort-courses.ts`):

- Cohort-scoped fetch: `fetchCourses` filters `.eq("plan_id", planId).eq("cohort", cohort)` (`:112-121`); choices/overlaps/merges fetched by those course ids only (`:134-168`).
- Regular courses: `studentKeys = unique([...own choices, ...overlap-dependents' choices])` (`:60-68`).
- Virtual merge-parent courses: `studentKeys = unique([...parent choices, ...each child's choices])` (`:70-84`).
- ⇒ `courses.filter(c => c.studentKeys.includes(studentKey))` is the **exact mirror** of `teacherCourses` (`entities/timetable/model/teacher-perspective.ts:18-19`). No `studentCourses` helper exists yet — but the file header (`:8-15`) explicitly anticipates it.

**No student-availability analog — confirmed.** The only availability table is `teacher_availability` (`20260613130000_teacher_availability.sql:14`); a repo-wide grep for `student_availability`/`studentAvailability` returns zero hits. The teacher view's empty-slot shading (`teacherUnavailableCells`, `teacher-perspective.ts:56-64`) has **no student equivalent** — the feature drops out entirely.

**Teacher vs. Student asymmetries:**

| Dimension | Teacher | Student |
|---|---|---|
| Cohort scope | Spans **both** cohorts → view loads dp1 + dp2 | Exactly **one** cohort (`students.cohort` NOT NULL) → view loads a single cohort |
| Availability | `teacher_availability` → shading + unavailable-cell conflicts | **None** — feature removed |
| Conflict semantics | Narrows by course-set OR `teacherKey`-kinds | **Out of scope** (schedule-only); would only ever be course-set/student-overlap kinds |
| Roster direction | Course card lists **students** (`studentKeys`) + co-teachers | Course card lists **teachers** (`teacherKeys`); no student roster |
| Entry point | `TeacherTable` gets `planId`, links `/plans/[id]/teachers/[teacherId]` | `StudentTable` gets **no** `planId`, has **no** detail link — must be added |
| Switcher fetcher | `fetchPlanTeachers` → `{id,code,full_name}[]` (`teacher-plan-view/api/loader.ts:143-155`) | No mirror; needs a cohort-scopable `fetchPlanStudents` |
| Switcher scale (seed) | ~16–18 per cohort | ~26–35 per cohort (~61 plan-wide) — still dozens |

### 2. The student view is a strict subset — what's reused, dropped, and new

`TeacherScheduleGrid.tsx` is a **pure static data-in grid**: it imports only `@/shared/*` and `@/entities/timetable` (`:1-13`), zero `_pages` imports. For a schedule-only single-cohort student grid, the teacher-only decorations **drop out** and become optional props:

- `unavailable` shading (`:25,84,114-127`) — gone (no student availability).
- `onInspect` + collision/unavailable badge, `aria-invalid`, `hasBlocking` (`:26,113,122,156-192`) — gone (no clash QA).
- per-chip `cohortLabel(cohort)` and `TeacherGridOccupant`'s `{ cohort }` tag (`:16,170`) — gone (single cohort).

What survives is the whole frame + the plain chip (name + `subjectChipClass(color)` + week label). `groupCellOccupants` already accepts an **empty** collisions map and emits all-`false` flags (`cell-occupants.ts:57-59`), so a no-collision student grid needs no new domain code.

`TeacherPlanPage.tsx` collapses dramatically. **Vanishes:** `deriveCohortView` (`:140-161`, incl. `buildCrossCohortIndex`/`projectFromPlacements`/`deriveCellViolations`/`narrowViolationsToTeacher`), `mergeCohortOccupants` (`:163-172`), `buildAvailabilityIndex`+`teacherUnavailableCells` (`:43-44`), the `inspection` state + `inspectedWeeks` + `CollisionDetailsDialog` block (`:110-121,174-179`), and the dual course-list builds collapse to one (`:52-69`).

**Course list** (`model/course-list.ts` + `TeacherCourseList.tsx`): the whole builder skeleton is shared (merge resolution `childrenOf`/`parentOf` `:44-50`, `occurrencesOf` sorted `:52-53`, hours attachment). Only three lines are persona-specific — the membership predicate (`:42`), `coTeacherKeys` (`:60,74`), and `studentKeys` roster (`:61,75`). For a student, the roster **direction flips**: list `teacherKeys` per course; drop the student roster.

### 3. Q2 — what promotes, and to which layer

**`entities/timetable` (pure domain):**
- `studentCourses(courses, studentKey)` — new one-line predicate beside `teacherCourses` (`teacher-perspective.ts:18`).
- `buildPerspectiveCourseItems(...)` — the generalized `buildTeacherCourseItems` (`teacher-plan-view/model/course-list.ts:32-88`), persona-parameterized on (a) the membership predicate and (b) which key-set to surface as the card's "people." Merge resolution + occurrences + hours are identical across personas. `course-list.test.ts` moves alongside.

**`widgets/timetable-board` (composed read-only UI — a NEW layer; `src/widgets/` does not exist today):**
- `ScheduleGrid` — generalized `TeacherScheduleGrid` with `unavailable?`/`onInspect?`/`cohort?` optional (teacher decorations become additive, so the teacher render is unperturbed).
- `CourseCard` / course-list renderer — shared card frame with a `people` slot (label + names) rendered once per persona.
- ~~switcher shell~~ — **dropped from `widgets/`** (see Finding 5): the student switcher gains a cohort dimension the teacher switcher lacks (teachers span both cohorts), so the two diverge. Each persona keeps its own switcher **page-slice-local**; only the grid + card are genuinely shared UI.

**Stays page-slice-local:** `loadStudentPlanView` (single-cohort, students list, teacher-name roster, no availability), the slimmed `StudentPlanPage`, the **student switcher** (cohort toggle + single-cohort dropdown — persona-specific, see Finding 5), and the `StudentViewLink` + "View plan" action added to `StudentTable`.

> **Layer discipline:** the question asked about "promoted to entity," but the grid/card/switcher are **UI**, so their correct home is `widgets/`, not `entities/`. Only the pure builder + predicate go to `entities/`. FSD reserves `entities/` for domain logic and `widgets/` for composed UI shared across pages.

### 4. Q3 — audit of `entities/timetable`: does it still hold?

**Consumer facts (whole `src/` grepped):** every external import of `@/entities/timetable` comes from exactly **two slices** — `_pages/plan-detail` (PD) and `_pages/teacher-plan-view` (TPV). No `shared/*`, `actions/`, `pages/`, or `app/` consumer (the three `shared/*` "hits" are JSDoc prose, not imports).

**Modules that clearly earn entity residency (2 real production consumers):** `placement`, `week`, `course-display`, `hours`, `availability-index`, `cross-cohort-index`, `collision/cell-key`, `collision/collisions`, `collision/cell-occupants`, `lib/period-breaks`, `ui/CollisionDetailsDialog`. **These hold.**

**Single-consumer outliers — the audit's real content:**

| Module | Sole consumer | Coupling | Verdict |
|---|---|---|---|
| **`model/lens.ts`** | **PD only** (not used by TPV at all) | Imports only `course-display` + `placement` types + shared — **zero** collision/availability coupling | **Reconsider — move back to `_pages/plan-detail/model`.** It is board-only view-state; the schedule-only student view will not use it; FSD's bar (2+ consumers) is unmet and there is no perspective consumer on the horizon. Cleanest lift of any module. *(Defensible counter: it is pure timetable read-domain, so keeping it is not "wrong" — but it does not currently earn its place.)* |
| **`model/teacher-perspective.ts`** | **TPV only** | Coupled to `collision/collisions` + `collision/constraints` + `availability-index` + `placement` | **Keep.** The student view makes the *perspective* concept 2-consumer. Generalize on arrival: the collision-free predicates (`teacherCourses`/`teacherPlacements`) become the shared core (add `studentCourses`); the collision/availability-coupled parts (`narrowViolationsToTeacher`/`teacherUnavailableCells`) stay teacher-specific (schedule-only student view doesn't mirror them). Moving it out would drag the collision core with it — not a clean lift. |
| **`lib/period-times.ts`** | **TPV only** | Standalone (zero imports) | **Keep.** Student view reuses it for occurrence times → becomes 2-consumer. |
| **`model/collision/intersects.ts`** | **PD only** (`grouping/enumerate.ts:1`) | Wraps `./constraints` (`violatesAny`) | **Keep.** Connective tissue of the cohesive shared collision cluster; splitting it fragments constraints. |
| **`model/collision/constraints/`** (external surface) | **PD only** (`violatesAny` in `drop-hints.ts:9`) | Internally consumed by `collisions`/`cell-occupants`/`teacher-perspective` | **Keep.** Its types (`CollisionViolation`, etc.) are used by the shared collision core and by `teacher-perspective`; it is the base of the shared cluster. |
| `model/__fixtures__/builders.ts` | PD + TPV (**tests only**) | shared/move-set only | **Keep.** Fixtures travel with the domain by design (barrel comment). |

**Steiger override is now removable.** `steiger.config.ts:7-15` disables `fsd/insignificant-slice` for `src/entities/timetable/**` with a comment about the "one-consumer window." That precondition is **satisfied** — TPV now imports the entity in production, so there are **two referencing slices** and the rule (which counts referencing slices, not per-module usage) would no longer warn. The comment is stale; the override can be dropped. **Note:** the new `widgets/timetable-board` slice will itself need two consumers to avoid the same warning — extracting the grid *and refactoring TPV onto it* in the same change gives it two immediately (see Finding 6).

### 5. Switcher scaling — recommendation

`TeacherSwitcher.tsx` is a shadcn `DropdownMenu` of `<a>` anchors to stable sibling URLs (`:28-36`), scroll-capped (`max-h-80 overflow-y-auto`), `aria-current` on the current row (`:31`), flat/name-sorted (order from the loader). Its deliberate value is **shareable URLs + native history + middle-click-to-open** (docstring `:12-16`). It degrades at hundreds of items: no search, all anchors mounted, long scroll, no cohort segmentation.

**The searchable-combobox primitive is already vendored — zero new deps:**

| Primitive | Vendored | File |
|---|---|---|
| `command` (cmdk Combobox) | ✅ | `src/shared/ui/command.tsx` |
| `popover` | ✅ | `src/shared/ui/popover.tsx` |
| `multi-select` (ready-made Popover+Command combobox) | ✅ (repo-authored) | `src/shared/ui/multi-select.tsx` |

`cmdk@^1.1.1` is in `package.json:43`. The pattern is **proven in production** on `client:load` islands: `LensPicker` (`plan-detail/ui/lens/LensPicker.tsx`) already does *"search over students"* via `Command`-in-`Popover` with `keywords`/custom `filter` so opaque ids don't affect ranking; `MultiSelect` is used in 5 catalog sites. No Workers/React-19/Astro hydration caveat.

**Students table today has _no_ navigation to a student** — `StudentTable.tsx` row actions are only Edit/Delete (`:97-131`); the name is plain text (`:58`); scale is handled purely client-side (search input + `CourseFilter` + cohort `Tabs` + `filterStudents`, all rows in DOM, loader `limit(500)`).

**Cohort dimension:** a student is single-cohort, so scope the switcher to the student's **own cohort** (~26–35 now), and/or use `CommandGroup` DP1/DP2 headings — matching the catalog's existing cohort tabs. The teacher switcher correctly ignores cohort (teachers span both).

**Recommendation (refined — author input): a cohort segmented control next to a single-cohort student dropdown; no combobox needed.** Put a dp1/dp2 toggle beside the student picker. Scoping the picker to one cohort caps it at ~26–35 names, where the existing flat `TeacherSwitcher` dropdown-of-anchors (`DropdownMenuItem asChild → <a>`) is already comfortable. This reuses two shipped idioms verbatim — the students catalog's **cohort-`Tabs`-as-client-filter** (`StudentCatalog.tsx:66-96`) and the `TeacherSwitcher` anchor dropdown — needs **zero new primitives**, and **sidesteps the combobox's one wrinkle entirely** (plain anchors keep shareable URLs + middle-click for free; no `CommandItem` `onSelect`-vs-anchor juggling).

**Interaction model.** The cohort toggle is **client state**, initialized to the current student's cohort; the dropdown lists the *selected* cohort's students as anchors; the current student is check-marked only while its own cohort is selected; **toggling cohort re-scopes the dropdown but does not navigate** (a bare cohort has no target until a student is picked); picking a student navigates via the anchor. Critically this is the **state**-`Tabs` variant (`StudentCatalog.tsx:66-71`, `onValueChange`), **not** the **anchor**-`Tabs` variant (`CohortSwitcher.tsx:16-42`, where each cohort maps to a real `?focus=` URL) — here a cohort alone has no URL, so it can't be an anchor.

**Resolved — browse both cohorts.** Flipping the toggle re-scopes the picker to the *other* cohort, so an author can jump cross-cohort without leaving the page. The picker still shows one cohort at a time (~dozens → plain dropdown); the current student is check-marked only while its own cohort is selected, and toggling to the other cohort simply lists that cohort's students to navigate into. (The students-table per-row link remains the second, browse-oriented entry point.)

**Architecture consequence:** because students carry a cohort dimension teachers don't, the student switcher **diverges** from the teacher switcher — so the switcher is **not** a shared `widgets/` component; each persona keeps its own (only the grid + card are shared). The vendored `command`/cmdk combobox (`src/shared/ui/command.tsx`, proven in `LensPicker`, `multi-select.tsx`) stays the **fallback** for when a single cohort grows into the hundreds. Add a per-row link on the students table regardless (`StudentTable` has no navigation to a student today) as a second, browse-oriented entry point. Reference impls to copy: `TeacherSwitcher.tsx` (dropdown/`aria-current`/label helper) + `StudentCatalog.tsx:66-96` (cohort-`Tabs` client filter).

### 6. Route, nav, entry point, e2e — all mechanical

- **Route:** `src/pages/plans/[id]/students/[studentId].astro`, a near-verbatim copy of `[teacherId].astro` (swap loader, `teacherId→studentId`, `data.teacher→data.student`, title strings; same 503/404/`PlanScopedError` ladder).
- **Nav highlight — free by construction.** `planNavItems` already lists `/plans/${planId}/students` (`nav.ts:24`). `SidebarLayout`'s `isActive` prefix-matches non-exact hrefs (`SidebarLayout.astro:22-24`), so nesting the detail route under `/students/` keeps **Students** lit; the board href is in `EXACT_HREFS`, so Board doesn't spuriously light up. Same mechanism the teacher route relies on.
- **Entry point:** thread `planId` into `StudentTable` and mirror `TeacherTable`'s additions — a `StudentViewLink` on the name cell (cf. `TeacherViewLink`, `TeacherTable.tsx:235-244`) + a "View plan" `DropdownMenuItem` + a `studentViewHref(planId, id)` helper. Students has no `code` column, so only the name links.
- **e2e:** mirror `e2e/specs/teacher-plan-view.spec.ts` with the existing helpers (`createStudent`/`createCourse`/`createPlan`/`deletePlan`/`gotoStable`). Assert `role="grid"` named `${student} timetable`, the placed chip in the named `gridcell`, and the course card's **Teachers** list (flipped from the teacher spec's student-roster assertion); switcher navigation to a sibling student. Single-cohort → no dp1/dp2 merge assertions.

### 6b. The consequence to decide up front (widgets extraction touches shipped teacher-view code)

Promoting the grid to `widgets/timetable-board` is only DRY-correct if the **existing teacher view is refactored onto the shared widget in the same change** — otherwise the widget has one consumer (student view) while TPV keeps a private copy (duplication + a `insignificant-slice` re-warning). Two options:

- **(A) Full extraction + refactor TPV (recommended, and pre-committed).** The archived research/plan already called this the "forced, mechanical" move (`research.md:159,170,172`). More churn, touches shipped code, but FSD-correct and gives the widget two consumers immediately.
- **(B) Duplicate the grid into the student slice.** Avoids touching TPV; steiger won't complain (intra-slice), but it's DRY-hostile and leaves two grids to maintain. Discouraged.

This is the one place the change is bigger than "just add a page," and it's worth an explicit decision at plan time.

## Code References

> On `main` at pushed commit `348f190`; permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/348f190aafcd76ad377b7123c0fab9d6f0db2143/`

- `src/entities/timetable/index.ts` — entity public API; comment already names the "future student view"
- `src/entities/timetable/model/teacher-perspective.ts:8-19` — the predicate + docstring the student view mirrors (`teacherCourses`)
- `src/entities/timetable/model/lens.ts:1-4` — board-only view-state; single-consumer (PD), zero collision coupling → move-back candidate
- `src/entities/timetable/lib/period-times.ts` — standalone; single-consumer today, 2-consumer with student view
- `src/entities/timetable/model/collision/cell-occupants.ts:57-59` — `groupCellOccupants` tolerates an empty collisions map (no new code for a no-collision grid)
- `src/shared/api/load-cohort-courses.ts:60-84` — `studentKeys` overlap+merge union (reuse; don't re-query)
- `src/shared/api/load-student-names.ts:5-12` — id→name resolver (already used by TPV rosters)
- `supabase/migrations/20260611180006_plans_as_domain_root.sql:28,46-63` — `cohort` enum + plan-owned `students`/`student_choices`
- `supabase/migrations/20260613130000_teacher_availability.sql:14` — the only availability table (no student analog)
- `src/_pages/students/api/assert-choices-in-cohort.ts:12-29` — app-enforced same-cohort invariant
- `src/_pages/students/api/update-student.ts:8-17` — non-atomic cohort-change caveat (sidestepped by single-cohort load)
- `src/_pages/students/ui/StudentTable.tsx:58,97-131` — no student navigation today; entry point to add
- `src/_pages/students/ui/StudentCatalog.tsx:49-96` — client-side search + cohort tabs precedent
- `src/_pages/teacher-plan-view/ui/TeacherScheduleGrid.tsx:1-13,16,25,84,113-192` — pure data-in grid; teacher-only decorations to make optional in `widgets/`
- `src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx:41-77,110-179` — the two-cohort/collision/availability machinery that vanishes
- `src/_pages/teacher-plan-view/model/course-list.ts:32-88` — `buildTeacherCourseItems` → generalize to `buildPerspectiveCourseItems`
- `src/_pages/teacher-plan-view/ui/TeacherSwitcher.tsx:12-44` — flat dropdown switcher idiom (shareable URLs, `aria-current`)
- `src/_pages/plan-detail/ui/chrome/CohortSwitcher.tsx:16-42` — cohort `Tabs` as **anchors** (each cohort → a `?focus=` URL); contrast with the student switcher's **state** toggle
- `src/_pages/students/ui/StudentCatalog.tsx:66-96` — cohort `Tabs` as **client filter** over a student list — the exact idiom the student switcher's cohort toggle reuses
- `src/_pages/teacher-plan-view/api/loader.ts:143-155` — `fetchPlanTeachers` (model for a cohort-scoped `fetchPlanStudents`)
- `src/_pages/teachers/ui/TeacherTable.tsx:235-248` — `TeacherViewLink` + `teacherViewHref` entry-point pattern to mirror
- `src/_pages/plan-detail/ui/lens/LensPicker.tsx` — Command-in-Popover "search over students" reference impl
- `src/shared/ui/command.tsx`, `src/shared/ui/multi-select.tsx`, `src/shared/ui/popover.tsx` — vendored combobox primitives
- `src/shared/config/nav.ts:24` + `src/app/.../SidebarLayout.astro:22-24` — nav highlight-by-prefix (free under `/students/`)
- `steiger.config.ts:7-15` — `fsd/insignificant-slice` override (now removable)
- `package.json:43` — `cmdk@^1.1.1` already installed

## Architecture Insights

- **The perspective-view family is now real, validating the extraction.** The teacher view's follow-up research bet an `entities/timetable` layer on a *future* second consumer; the student view is that consumer. It turns `teacher-perspective`/`period-times` from single-consumer into 2-consumer and justifies the boundary retroactively.
- **Entities vs. widgets is the key layer distinction here.** Pure domain (predicate, course-list builder) → `entities/`; composed read-only UI (grid, card) → the new `widgets/timetable-board`. Conflating them (putting UI in `entities/`) would violate FSD; the student view is the trigger that forces the widget layer to exist.
- **The switcher stays page-slice-local — the cohort asymmetry breaks the shared-shell case.** A student is single-cohort, so the student switcher pairs a cohort toggle with a single-cohort dropdown (the catalog's cohort-`Tabs`-as-filter idiom); a teacher spans both cohorts, so the teacher switcher is a flat dropdown with no cohort dimension. They diverge enough that a shared `widgets/` switcher would be over-abstraction — keep one per persona. Bonus: the cohort-scoped picker (~dozens) removes the need for a searchable combobox at all.
- **Schedule-only is a subtractive spec.** Because the teacher view was built additive (collision/availability are optional decorations on a plain grid), the student view is mostly "pass fewer props / delete branches." This is why feasibility is high.
- **`lens.ts` is the audit's signal that promotion swept slightly wide.** The Phase-1 extraction moved the whole read-side core for import-closure reasons; with the dust settled, `lens.ts` is board view-state with one consumer and no shared coupling — a candidate to migrate back, consistent with the "single-consumer logic stays local" FSD rule.
- **The doc-coupling lesson applies again.** `CLAUDE.md:10`, `README.md:91`, and `catalog-hash/types.ts:14` pin the location of the constraint core; any module that moves (lens back to PD, grid to widgets) requires updating those in the same change (per `lessons.md` §"A convention that cites a code mechanism is coupled to it").

## Historical Context (from prior changes)

- `context/archive/2026-07-05-teacher-plan-view/research.md:150-172` — the follow-up that (re)introduced `entities/timetable` under an explicit *"first of a family of read-only perspective views"* assumption and **deferred `widgets/timetable-board` until the student view forces it**. This research is the payoff of that bet.
- `context/archive/2026-07-05-teacher-plan-view/plan.md:41-42,56` — "Student plan view" listed under *What We're NOT Doing* ("the architecture prepares for it… nothing student-specific is built"), and the `insignificant-slice` override rationale.
- `context/archive/2026-06-11-students-and-choices-ui/` — the choice-picker precedent that merge composites are scheduling artifacts (rosters resolve to real courses) — mirrored by the course-list's merge resolution.
- `context/archive/2026-06-20-co-teaching-teacher-sets/` — teacher sets / `teacherKeys`; the student mirror is `studentKeys` (also a set, overlap+merge unioned).
- `context/archive/2026-06-21-bi-weekly-week-aware-validation/` — occurrence = `(day, period, week)`; the student course list must respect week A/B.
- `context/foundation/lessons.md` §"Prefer declarative pipelines" and §"doc-coupling" — apply to the generalized builder and any module relocation.

## Related Research

- `context/archive/2026-07-05-teacher-plan-view/research.md` — the direct parent; the student view mirrors its Scope Decisions (period-time seam, print-viability rules, path-param route, switcher idiom).
- `context/archive/2026-07-03-planner-board-search-discovery/` — the lens (`model/lens.ts`) origin; relevant to the Q3 move-back recommendation.
- `context/archive/2026-06-28-plan-detail-unify-views/` — render-time view branching over one loader (the "add a view" precedent).

## Follow-up 2026-07-06 — switcher refined to cohort-toggle + single-cohort dropdown

**Author input:** pair a cohort (dp1/dp2) switch with the student select so the picker narrows to one cohort, simplifying the switcher decision.

**Effect on the recommendation (Finding 5 revised in place):** this supersedes the earlier "searchable combobox" lead. Scoping the picker to a single cohort (~26–35) makes a **plain dropdown** sufficient, so the combobox is demoted to a scale-only fallback. The cohort toggle is the **state**-`Tabs` idiom already used on the students catalog (`StudentCatalog.tsx:66-96`), not the **anchor**-`Tabs` idiom of `CohortSwitcher` (a bare cohort has no URL). Because students carry a cohort dimension teachers don't, the two switchers diverge — so the switcher is **removed from the `widgets/` shared surface** and stays page-slice-local per persona (only the grid + course-card remain shared widgets). Sub-decision now **locked in: the cohort toggle browses both cohorts** (flipping it re-scopes the picker cross-cohort).

## Open Questions

1. **Widgets extraction scope (the main decision):** full extraction + refactor the existing teacher view onto `widgets/timetable-board` (option A, recommended/pre-committed) vs. duplicate the grid into the student slice (option B). Confirm A at plan time.
2. **Course-card "people" for a student:** list the course's teacher(s) only, or also surface hours/level/cohort badges as-is? (Teacher-name resolution via the already-loaded `teacherNames`.) Any notion of "co-students" is explicitly out (schedule-only).
3. ~~**Switcher control**~~ — **RESOLVED (see Finding 5):** cohort toggle + single-cohort plain dropdown, and the toggle **browses both cohorts** (re-scopes the picker cross-cohort). Combobox kept only as a scale fallback. Nothing left to decide here.
4. **`lens.ts` relocation:** fold the Q3 move-back into this change (touches PD + docs), defer to a separate cleanup change, or explicitly keep it in the entity? (Independent of the student view; surfaced by the audit.)
5. **`fetchPlanStudents` home:** promote to `shared/api` (mirrors where the plain read fetchers live) vs. keep as a page-local loader helper (as `fetchPlanTeachers` is today)?
6. **Print-viability:** the teacher view preserved print-viability as a design rule; carry the same rules into the student grid/list now, or treat print as the separate deferred change already parked? (Recommended: preserve the design rules, don't build print.)
