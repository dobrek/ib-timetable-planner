---
date: 2026-06-11T07:55:38Z
researcher: Dobromir Kropielnicki
git_commit: 9a08a143394165c07f2b29634ea4285f338a4d88
branch: main
repository: dobrek/ib-timetable-planner
topic: "Do students-and-choices-ui need new UI elements or changes to the UI conventions?"
tags: [research, codebase, students, choices, ui-conventions, multi-select, crud]
status: complete
last_updated: 2026-06-11
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Added follow-up research for list rendering of choices, cohort tabs, and course/name filtering"
---

# Research: Do students-and-choices-ui need new UI elements or convention changes?

**Date**: 2026-06-11T07:55:38Z
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 9a08a143394165c07f2b29634ea4285f338a4d88
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

For the S-04 `students-and-choices-ui` slice (CRUD students + their course choices), check whether we need **new UI elements** or **changes to our UI conventions** (`context/foundation/ui-conventions.md`).

## Summary

**Short answer: no new shared UI _primitive_ is strictly required, and no UI convention needs to change — but two additive moves are recommended.**

1. **The flat-record CRUD is fully covered.** A student is `(full_name, cohort_id)` — a flat record like a teacher or course. The existing `teachers` slice is an almost-exact template: `Table` + `Dialog` (create/edit) + `AlertDialog` (delete) + RHF/Zod form + `model/` filter & dialog hooks + `api/*-client.ts` `{ error }` wrappers. Scaffold `src/_pages/students/` by mirroring `src/_pages/teachers/` 1:1. The only new *use* of an existing primitive is a **cohort `<Select>`** on the student form (teachers have no cohort field; students require one).

2. **The one genuinely new UI surface is the _choices editor_** — a one-to-many "pick N courses for this student" control. This is the only part not present in any catalog slice as a *form-bound* element. **The building blocks already exist** (`Command` + `Popover` + `Badge`), and the pattern is already implemented twice (`TeacherFilter`, `MergeBuilderDialog`). So this is "compose existing primitives," not "introduce a new dependency or primitive."

3. **Recommended (additive, not blocking):** because the multi-select combobox would now be hand-rolled a **third** time, promote it to a reusable `shared/ui` component (e.g. `MultiSelectCombobox`). The current UI conventions explicitly invite this ("promote to `shared/` when a second consumer appears") — this *extends* the conventions by example, it does not contradict them. A short convention/lesson note on "editing a child collection inside a parent dialog" would capture the one shape the conventions (written from a flat-record refactor) don't yet illustrate.

## Detailed Findings

### Area 1 — The data model makes this a flat record + a child collection

From the schema (`supabase/migrations/20260602185012_minimal_domain_schema.sql`, `src/shared/api/database.types.ts`):

- **`students`**: `id`, `cohort_id` (NOT NULL, FK → `cohorts` ON DELETE CASCADE), `full_name` (NOT NULL), `created_at`, `updated_at`. **No level/group/year enum on the student** — cohort is a separate `cohorts` table referenced by FK.
- **`student_choices`**: pure join row — `id`, `student_id` (FK CASCADE), `course_id` (FK CASCADE), `created_at`. `UNIQUE (student_id, course_id)`. **Carries no level/group of its own** — those live on the `courses` row a choice points at (FR-002 triple `(name, level, group_index)`).
- **Cardinality**: one row per choice; a student has *many* choices (IB load ~8–9; `data/dp1/students_subjects.csv` shows 26 students / 232 rows).

Design implications for UI:
- **Student form** = `full_name` (Input) + `cohort` (single-select). Nothing exotic.
- **Choices editor** = add/remove a *set* of course references, naturally **scoped to the student's cohort** (courses are cohort-scoped via `courses.cohort_id`). Level/group are not entered here — the author picks among already-defined courses.
- Each choice is an explicit add/remove (PRD Business Logic: "student-choice data is never silently mutated", `prd.md:57`). The unique row-per-choice schema makes per-choice add/remove the natural mutation granularity (vs. diffing a whole set on form submit) — flag as a plan-level decision.

Requirements text: **FR-006** (`prd.md:101-102`) — "create a student, add or remove course choices for that student … the **primary path**"; **FR-002** (`prd.md:89`); roadmap **S-04** (`roadmap.md:160-171`) — "basic CRUD … Risk: Low."

### Area 2 — The `teachers` slice is a ready-made CRUD template

`src/_pages/teachers/` maps cleanly onto a future `src/_pages/students/`:

- **Root island** `ui/TeacherCatalog.tsx` — thin orchestrator: destructures `useCatalogFilters()` + `useCatalogDialogs()`, computes filtered rows, wires `Table` + dialogs. (`ui-conventions.md` "Root page component".)
- **Table** `ui/TeacherTable.tsx` — empty / no-results / data states, row `DropdownMenu` actions, private sub-components (`AssignmentBadges`, `TeacherRowActions`) following the newspaper rule.
- **Create/Edit** `ui/TeacherFormDialog.tsx` — `Dialog` + RHF (`useForm` + `zodResolver`, `mode:"onTouched"`), `isInputError` → field errors; private `useTeacherForm` hook below the component.
- **Delete** `ui/DeleteTeacherDialog.tsx` — `AlertDialog` + private `useDeleteTeacher`.
- **model/** — `use-catalog-dialogs.ts`, `use-catalog-filters.ts` (URL-sync), `filter-teachers.ts` (pure), `filter-params.ts` (pure, URL serialization), `schemas.ts` (Zod single source for action `input` + RHF resolver), `teacher.ts` (view-model types). Pure files have co-located `*.test.ts`.
- **api/** — `teacher-client.ts` (`{ error }` wrappers), `actions.ts` (`defineAction` gate), `create/update/delete-*.ts` (framework-free domain fns throwing `DomainError`), `loader.ts` (server projection to view-models), `constants.ts`, `index.ts` barrel.
- **Astro route** `src/pages/teachers.astro` — `createClient` → `loadTeacherCatalog` → mounts `<TeacherCatalog … client:load />`; handles `unavailable` (503) and empty-cohorts states.

Everything except the choices editor transfers field-for-field. The student form adds a **cohort `<Select>`** (loader must pass the `cohorts` list as a prop, like `TeacherCatalog` already receives `cohortIds`).

### Area 3 — Multi-select building blocks already exist (and are already used twice)

`src/shared/ui/` inventory relevant to the choices editor:

| Primitive | Role for choices editor |
| --- | --- |
| `select.tsx` (Radix Select) | **Single-select only** — use for the student's *cohort*, not for choices. |
| `command.tsx` (cmdk) + `popover.tsx` | **The multi-select foundation** — searchable, toggleable list in a popover. |
| `badge.tsx` | Selected choices rendered as removable chips. |
| `form.tsx`, `dialog.tsx` | RHF `FormField` binding + modal container. |

**No dedicated multi-select / combobox / tags-input component exists** — but the shadcn `Command + Popover + Badge` combobox is the project's established way to do it, present in two production spots:

- **`src/_pages/courses/ui/TeacherFilter.tsx:1-101`** — transient *filter* (Set-based toggle, not form-bound): Popover trigger w/ count badge → `Command` searchable list w/ `Check` marks → removable `Badge` chips + Clear.
- **`src/_pages/courses/ui/MergeBuilderDialog.tsx:61-233`** — *form-bound* multi-select inside a `Dialog`: `FormField` binding `childCourseIds: string[]`, same Popover+Command list, `Badge` chips with X (`:146-164`), inline Zod validation + live preview. **This is the closest analog to the student-choices editor.**
- (`src/_pages/plan-detail/ui/SlotCell.tsx:26-119` shows render-a-collection-with-remove chips, for reference.)

**Conclusion on "new UI elements":** the choices editor needs **no new primitive and no new library**. It composes `Command + Popover + Badge + FormField` exactly like `MergeBuilderDialog`. The open question is reuse, not capability (below).

## Architecture Insights

- **Two reuse altitudes meet here.** `ui-conventions.md` "Shared helpers" says: promote a helper to `shared/` only when a *second* consumer appears. The multi-select combobox now has two consumers (`TeacherFilter`, `MergeBuilderDialog`) and student-choices would be the **third** hand-rolled copy. That crosses the project's own promotion threshold → extract a reusable `shared/ui/MultiSelectCombobox` (search + toggle + chips) and refactor the two existing call sites onto it, or at minimum build the choices editor on a shared component rather than a third copy. This is the single most useful "new UI element" to introduce — and it's consistent with, not a change to, the conventions.
- **The conventions are written from a flat-record refactor** (`courses`) and don't *illustrate* a one-to-many child-collection edit. Nothing in them conflicts with it; the newspaper rule, per-flow hooks (a private `useStudentChoices` flow distinct from `useStudentForm`), `model/` purity, and the `api/*-client.ts` `{ error }` boundary all apply unchanged. Worth a one-line convention/lesson note so future child-collection slices have a precedent (candidate for `/10x-lesson`).
- **Cohort scoping is a real UI constraint**, not cosmetic: the choices picker must list only courses whose `cohort_id` matches the student's selected cohort. That couples the cohort `<Select>` to the choices `Command` list (changing cohort should reset/refilter choices) — a per-flow concern the hook split should make visible (`ui-conventions.md` Design goal #1).
- **Mutation granularity is undecided**: per-choice add/remove actions (matches the row-per-choice unique schema and the "never silently mutate" rule) vs. whole-set diff on form submit. Defer to `/10x-plan`.

## Code References

- `supabase/migrations/20260602185012_minimal_domain_schema.sql:68-88` — `students` + `student_choices` tables, unique/index constraints.
- `src/shared/api/database.types.ts:353-420` — generated TS types for both tables.
- `src/_pages/teachers/ui/TeacherCatalog.tsx` — thin-orchestrator island template.
- `src/_pages/teachers/ui/TeacherFormDialog.tsx` — RHF + Zod create/edit dialog template.
- `src/_pages/teachers/ui/DeleteTeacherDialog.tsx` — AlertDialog delete template.
- `src/_pages/teachers/model/{use-catalog-dialogs,use-catalog-filters,filter-teachers,filter-params,schemas}.ts` — model layer to mirror.
- `src/_pages/teachers/api/{teacher-client,actions,loader,create-teacher,update-teacher,delete-teacher}.ts` — api layer to mirror.
- `src/pages/teachers.astro` — Astro route + loader wiring to mirror as `students.astro`.
- `src/_pages/courses/ui/TeacherFilter.tsx:1-101` — multi-select combobox (filter variant).
- `src/_pages/courses/ui/MergeBuilderDialog.tsx:61-233` — **form-bound** multi-select combobox (closest analog to choices editor).
- `src/shared/ui/{command,popover,badge,select,form,dialog}.tsx` — primitives available.
- `data/dp1/students_subjects.csv`, `data/dp2/students_subjects.csv` — real choice-data shape (one row per student×course).

## Architecture Insights — convention verdict (direct answer)

| Question | Verdict |
| --- | --- |
| New shared UI **primitive** needed? | **No.** `Command + Popover + Badge + Select` cover everything. |
| New **library / dependency**? | **No.** |
| New **composed component**? | **Yes, recommended:** a reusable `MultiSelectCombobox` (3rd consumer crosses the promotion threshold) + a slice-local `StudentChoicesField` wrapper. |
| **Change** to `ui-conventions.md`? | **No change.** Optional *additive* note: child-collection edit inside a parent dialog (the one shape the doc doesn't yet illustrate). |
| New use of existing primitive? | **Yes:** cohort single-`<Select>` on the student form. |

## Historical Context (from prior changes)

- `context/foundation/ui-conventions.md` — the conventions, authored from the `courses` refactor (flat-record CRUD); "Shared helpers" promotion rule and "Hook granularity / per independent flow" are the load-bearing entries for this slice.
- `context/foundation/lessons.md` — "Use semantic theme tokens, never hardcoded colors" and "Detokenize shadcn primitives on add" apply to any new component (incl. an extracted `MultiSelectCombobox`); "Astro Actions are the single transport" governs the choices add/remove mutations.
- `course-merge-builder` change — origin of `MergeBuilderDialog`, the form-bound multi-select precedent.
- `teachers-catalog` change (commit `9a08a14`) — the CRUD slice this one mirrors.

## Open Questions

1. **Extract `MultiSelectCombobox` to `shared/ui` now, or copy a third time?** (Recommendation: extract; refactor `TeacherFilter`/`MergeBuilderDialog` onto it — but that refactor could be its own change to keep S-04 small.)
2. **Choices mutation granularity** — per-choice add/remove actions vs. whole-set diff on submit. (Schema + "never silently mutate" lean toward explicit per-choice actions.)
3. **Cohort change in an existing student** — if the author edits a student's cohort, what happens to choices pointing at the old cohort's courses? (Block/confirm/clear — design decision.)
4. **Student delete cascade UX** — `student_choices` cascade on delete; surface choice count in the `AlertDialog` like teachers surface assignment count.
5. **PII on edit** (roadmap S-04 unknown) — soft vs hard delete / audit trail. Owner: user; non-blocking for UI shape.

## Follow-up Research 2026-06-11

Three list/catalog-view questions: how to present a student's courses in the row, whether to reuse the cohort-tabs pattern, and what filtering to offer. **All three have direct precedents already in the codebase — every one is reuse, nothing new is required.**

### Q1 — How to present a student's course choices in the list

The exact pattern exists: **`AssignmentBadges` in `src/_pages/teachers/ui/TeacherTable.tsx:90-102`** — a flex-wrapped row of `<Badge variant="secondary">` chips, with `—` when the set is empty. A teacher's courses-per-cohort column is structurally identical to a student's choices column.

Options, best-first:

1. **Inline badge chips (recommended).** Reuse the `AssignmentBadges` shape: a `Choices` column rendering one chip per chosen course, label formatted like `formatAssignmentBadgeLabel` (`teachers/lib/labels.ts` — name + level + circled group digit; courses already carry `name`/`level`/`group_index`). Chips wrap; an IB student's ~8–9 choices fit a wrapping cell. This matches the established catalog look and needs zero new primitive.
   - **Difference from teachers:** teachers split badges into **Y1/Y2 columns** because a teacher spans both cohorts. A **student belongs to exactly one cohort** (`students.cohort_id` NOT NULL), so it's a **single `Choices` column** — simpler. Add a numeric `#` count column (like teachers' hour columns) if a quick "how many choices" read is wanted.
2. **Count + popover/expand.** If wrapping 8–9 chips makes rows too tall, show a count badge that reveals the full chip set on hover/click (`Popover` already in `shared/ui`). More work; only if density becomes a problem in practice.
3. **Nested sub-table / expandable row.** Heaviest; no precedent in the codebase. Overkill for a flat list of course names — not recommended.

**Verdict:** reuse `AssignmentBadges` as a single `Choices` column. Consider lifting the badge-set renderer + `formatAssignmentBadgeLabel` to a shared helper since students and teachers now both render "a set of course chips" (same promotion argument as the multi-select combobox).

### Q2 — Reuse the courses cohort-tabs pattern? Yes, directly

`src/_pages/courses/ui/CourseCatalog.tsx:75-99` is the template: `Tabs value={filters.activeCohortId} onValueChange={filters.setActiveCohortId}` → `TabsList` of `TabsTrigger` per cohort → one `TabsContent` per cohort that renders the table over `filterCourses(courses, cohort.id, …)`. State lives in `useCatalogFilters` (`courses/model/use-catalog-filters.ts:19-53`), which owns `activeCohortId` and **URL-syncs** it (seeds from `?…` on mount, mirrors back via `replaceState`).

This fits students **even better than courses**: a student has exactly one `cohort_id`, so tabs cleanly partition the list (filter predicate `student.cohortId === cohort.id`). Two concrete wins to carry over:
- **`Tabs` + `TabsContent`-per-cohort** with `activeCohortId` from a students `useCatalogFilters` (mirror the URL-sync).
- **Active tab seeds the create form's default cohort** — `CourseCatalog.tsx:109` passes `defaultCohortId={filters.activeCohortId}` to the form dialog. Do the same so "New student" on the Year 1 tab pre-selects Year 1. (This also reduces the cohort `<Select>` on the student form to a confirm/override rather than a blank required field.)

`shared/ui/tabs.tsx` is already present. No new primitive.

### Q3 — Filtering: course multi-select + quick name search

**Course multi-select filter — direct analog of `TeacherFilter`.** `src/_pages/courses/ui/TeacherFilter.tsx:1-101` is a generic searchable multi-select (Popover + `Command`/`CommandInput`/`CommandItem` + removable `Badge` chips + Clear). A students `CourseFilter` is the *same component with course options* — "filter students by the courses they take" mirrors "filter courses by the teacher who teaches them." The filter predicate mirrors `filterCourses` (`courses/model/filter-courses.ts:15-21`): empty selection = all; otherwise keep students whose **choice set intersects** the selected course ids (`student.choiceCourseIds.some(id => selected.has(id))`). 
- **Scope the course options to the active cohort tab** — courses are cohort-scoped, and a student only holds same-cohort choices, so the `CourseFilter` should list the active cohort's courses (cleaner than showing all). 
- This `CourseFilter` is the **third structurally-identical copy** of the Popover+Command+Badge combobox (after `TeacherFilter` and `MergeBuilderDialog`) — reinforcing the primary research recommendation to extract a shared `MultiSelectCombobox`.

**Quick name filter — borrow from teachers, which the courses slice lacks.** The **courses** `useCatalogFilters` has **no text query** (only tabs + teacher multi-select + hideMerged). The **teachers** slice *does* have one: an `<Input>` bound to `filters.query`, with `filterTeachers` doing a case-insensitive substring match. Students are looked up by **name** (PII, ~26–150 rows), so a quick name `<Input>` should be the primary control. **Combine both precedents** — students take the courses slice's tabs + multi-select *and* the teachers slice's name `<Input>`.

**Resulting students filter composition** (one `useCatalogFilters` hook, URL-synced like both precedents):

| Control | Source pattern | State |
| --- | --- | --- |
| Cohort **tabs** | `courses/ui/CourseCatalog.tsx:75-99` | `activeCohortId` |
| **Name** quick filter `<Input>` | `teachers` slice (`query` + `filterTeachers`) | `query` |
| **Course** multi-select `CourseFilter` | `courses/ui/TeacherFilter.tsx` | `selectedCourseIds` |

Pure predicate `filterStudents(students, cohortId, query, selectedCourseIds)`: cohort match → name substring → choice-set ∩ selected courses. All three controls are existing patterns; the only authored piece is the `filterStudents` pure function (+ its `*.test.ts`, per the `model/` testing convention).

### Follow-up code references

- `src/_pages/teachers/ui/TeacherTable.tsx:90-102` — `AssignmentBadges`: the badge-chip set renderer to reuse for the `Choices` column.
- `src/_pages/teachers/lib/labels.ts` — `formatAssignmentBadgeLabel` (name + level + circled group digit).
- `src/_pages/courses/ui/CourseCatalog.tsx:75-99` + `:109` — cohort `Tabs` per-cohort `TabsContent`, and active-tab-seeds-create-form-default.
- `src/_pages/courses/model/use-catalog-filters.ts:19-53` — filter-state hook with URL sync (tabs + multi-select).
- `src/_pages/courses/model/filter-courses.ts:9-22` — pure filter predicate to mirror as `filterStudents`.
- `src/_pages/courses/ui/TeacherFilter.tsx:1-101` — the multi-select to clone as `CourseFilter` (and the 3rd-consumer case for `MultiSelectCombobox`).
- teachers slice `query`/`filterTeachers` — the quick name-`<Input>` pattern the courses slice omits.
