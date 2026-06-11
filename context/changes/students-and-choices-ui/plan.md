# Students and Choices UI (S-04) Implementation Plan

## Overview

Build the `src/_pages/students/` FSD slice and wire it into the existing `/students` route: a students catalog with cohort tabs, name search, and a course filter, plus CRUD where the create/edit dialog manages the student's full course-choice set (name + cohort + choices, whole-set on submit). This is FR-006 — the **primary path** for entering student data — and the prerequisite for S-05 (CSV import) and S-06 (compute groupings).

## Current State Analysis

- **Schema exists** (`supabase/migrations/20260602185012_minimal_domain_schema.sql:67-88`): `students` (`id`, `cohort_id` NOT NULL FK CASCADE, `full_name` NOT NULL) and `student_choices` (`student_id` FK CASCADE, `course_id` FK CASCADE, `UNIQUE (student_id, course_id)`). No unique constraint on `students.full_name` — duplicate names are allowed, so the form has no conflict-field mapping.
- **No migration needed.** Generated types already cover both tables (`src/shared/api/database.types.ts`).
- **A placeholder route exists**: `src/pages/students.astro` renders a "coming in S-04" message; `NAV_ITEMS` already contains `/students` (`src/shared/config/nav.ts:15`). No nav work needed.
- **The `teachers` slice is the CRUD template** (post-refactor, commits `6736116`/`b93d39a`/`93c2d81`): thin orchestrator island, `Result` loader via `withSupabase`, `defineDomainAction` routing table, `unwrapRow` ladders, `submitForm`/`useConfirmAction` flows, `onClose` dialog contract, `z.input`/`z.output` form typing, URL-synced filters via `useUrlSyncedFilters`.
- **The shared `MultiSelect` already exists** (`src/shared/ui/multi-select.tsx`, commit `4d2bd9f`) — searchable popover + check marks + removable chips, with `onBlur` for RHF binding. The research doc's open question #1 (extract a `MultiSelectCombobox`?) is resolved: both the choices editor and the course filter consume it directly. `MergeBuilderDialog` (`src/_pages/courses/ui/MergeBuilderDialog.tsx:75-94`) is the form-bound usage template.
- **Atomic multi-table write precedent**: `writeMergeAtomic` (`src/_pages/courses/api/write-merge-atomic.ts`) — insert parent, insert links, compensating delete on failure. workerd + supabase-js cannot run client transactions; the project rule is no new Postgres functions for this.
- **Cohort tabs pattern**: `CourseCatalog` (`src/_pages/courses/ui/CourseCatalog.tsx:75-99`) — `Tabs` bound to `activeCohortId` from `useCatalogFilters`, one `TabsContent` per cohort, active tab seeds the create form's default cohort (`:109`).
- **Merge parents are identifiable**: composite parent courses are those appearing as `course_merges.parent_course_id` (see `src/_pages/courses/api/loader.ts:27,51`). Students choose real courses, not composites — the picker and filter must exclude parents.

## Desired End State

The author opens `/students`, sees students partitioned by cohort tabs with their choices rendered as badge chips, narrows by name or by chosen course, and can: create a student (name + cohort + choices in one dialog, cohort pre-seeded from the active tab), edit any of those fields (changing cohort visibly resets the in-form choice selection), and delete a student (confirm dialog states how many choices are removed). All filter state survives reload via the URL. Choice mutations are explicit form submissions — never silent (PRD Business Logic, `prd.md:57`).

Verify by: `pnpm test` (model + api unit tests), `pnpm test:integration` (students CRUD round-trip against local Supabase), `pnpm lint && pnpm steiger && pnpm build`, and the manual checks per phase.

### Key Discoveries:

- `src/shared/ui/multi-select.tsx` — shared `MultiSelect` already promoted; no new primitive needed.
- `src/_pages/teachers/` — field-for-field CRUD template (loader at `api/loader.ts`, dialogs at `model/use-catalog-dialogs.ts`, form at `ui/TeacherFormDialog.tsx`).
- `src/_pages/courses/api/write-merge-atomic.ts` — compensating-cleanup write to promote to `shared/lib` (second consumer).
- `src/_pages/courses/model/use-catalog-filters.ts:19-53` + `model/filter-params.ts` — URL-synced tabs + multi-select codec template.
- `src/_pages/teachers/lib/labels.ts:6-15` — compact course badge label (`name` + level unless `"none"` + circled group digit) to mirror slice-locally.
- `src/_pages/plan-detail/api/endpoint.integration.test.ts` — integration-test harness pattern (service-role client, `describe.skip` when env missing).
- `src/middleware.ts` is deny-by-default — `/students` is already auth-protected; no allowlist change.

## What We're NOT Doing

- **No CSV import** — that is S-05 (`csv-import-students`).
- **No schema changes** — no soft-delete column, no audit trail (decided: hard delete; PII actually leaves the database).
- **No per-choice add/remove actions** — choices persist as a whole set on form submit (decided).
- **No min/max constraint on choice count** — empty set is valid; no IB-load heuristics (decided).
- **No promotion of the badge-label formatter to `shared/lib`** — the teachers (compact) and courses (verbose) label formats differ stylistically; they are not the same helper, so the promotion rule does not fire. Students gets a slice-local copy of the compact format.
- **No changes to `ui-conventions.md`** — research verdict: nothing conflicts. An optional `/10x-lesson` on "child-collection edit inside a parent dialog" can follow implementation.
- **No grouping/validator integration** — S-06 consumes this data later.

## Implementation Approach

Mirror `src/_pages/teachers/` 1:1 for the flat CRUD, take the cohort-tabs + URL-sync composition from `src/_pages/courses/`, and bind the shared `MultiSelect` into the student form exactly as `MergeBuilderDialog` binds `childCourseIds`. The single novel server-side piece is the whole-set choice write: create uses the promoted compensating-cleanup helper (insert student → insert choices → delete student on failure); update computes a pure add/remove diff and inserts before deleting so a mid-flight failure can only leave a visible superset, never lost choices.

Three phases, each ending in a working page: flat CRUD with read-only choice display → choices editing → course filter + integration tests.

## Critical Implementation Details

- **Atomicity on workerd**: no client-side transactions and no new Postgres functions. Create relies on compensating cleanup (the `writeMergeAtomic` mechanism, promoted to `shared/lib`). Update orders mutations insert-`toAdd`-then-delete-`toRemove`: a failure between the two leaves extra rows the author can see and re-edit — acceptable; silent loss is not. The `UNIQUE (student_id, course_id)` constraint is why the diff (not delete-all/insert-all) approach is required: re-inserting unchanged choices would conflict.
- **The server is the authoritative cohort gate.** The client filters the picker to the selected cohort, but `createStudent`/`updateStudent` must independently verify every `choiceCourseIds` entry references a course whose `cohort_id` equals the submitted `cohortId` (one `select id, cohort_id from courses where id in (...)` + count/cohort check), throwing `DomainError` (BAD_REQUEST) otherwise. Without this, a stale client or crafted call could attach cross-cohort choices that S-06's grouping algorithm would choke on.
- **Cohort-change reset must distinguish user edits from form resets.** Clearing `choiceCourseIds` when the cohort `Select` changes must fire only on an actual user change (watch via RHF `subscribe`/`watch` callback comparing to the previous value, or clear inside the cohort field's `onChange` handler — preferred, since it can't misfire during `form.reset` on dialog open/edit-prefill).
- **Vitest astro rule** (`ui-conventions.md`): the new slice's `api/` domain files deep-import `@/shared/lib/postgrest` / `@/shared/lib/errors`; `ui/` deep-imports `@/shared/lib/forms`. The promoted atomic-write helper must be a pure module (no astro imports) so its test stays in the unit suite.

## Phase 1: Students flat CRUD + catalog shell

### Overview

Scaffold the full slice mirroring `teachers`, with cohort tabs and name search from the `courses` composition. The form edits `fullName` + `cohortId` only; choices are loaded and *displayed* (badge chips + count) but not yet editable. Replace the placeholder route body.

### Changes Required:

#### 1. Model layer

**File**: `src/_pages/students/model/student.ts`

**Intent**: View-model types for the island.

**Contract**: `StudentRow = { id; cohortId; fullName; choiceCourseIds: string[] }` and `CourseOption = { id; cohortId; label; isMergeParent: boolean }`. Course labels are formatted once in the loader; the table/badges/picker/filter all consume `CourseOption` via a `coursesById` map computed at the orchestrator level (Shared-lookups convention).

**File**: `src/_pages/students/model/schemas.ts` (+ `schemas.test.ts`)

**Intent**: Zod single source for action input + RHF resolver, mirroring `teachers/model/schemas.ts`.

**Contract**: `studentInput = { fullName: trimmed nonempty; cohortId: uuid }`; `updateStudentInput = studentInput.extend({ id: uuid })`; `deleteStudentInput = { id: uuid }`; `StudentFormValues = z.input<…>` / `StudentInput = z.output<…>`. (`choiceCourseIds` joins in Phase 2.)

**File**: `src/_pages/students/model/filter-params.ts` (+ test)

**Intent**: Pure URL codec for filter state, mirroring `courses/model/filter-params.ts` plus the teachers-style text query.

**Contract**: `readFilterParams(search, cohorts)` / `toFilterSearch(state)` over `{ cohortId, query }` — unknown cohort ids fall back to the first cohort; empty query omitted from the URL. (`courseIds` joins in Phase 3.)

**File**: `src/_pages/students/model/filter-students.ts` (+ test)

**Intent**: Pure filter predicate: cohort match → case-insensitive `fullName` substring.

**Contract**: `filterStudents(students, cohortId, query)` (signature widens with `selectedCourseIds` in Phase 3).

**File**: `src/_pages/students/model/use-catalog-filters.ts`

**Intent**: Thin wrapper over `useUrlSyncedFilters` exposing `activeCohortId`/`setActiveCohortId`/`query`/`setQuery`, mirroring `courses/model/use-catalog-filters.ts` (referentially stable `parse`/`serialize` via `useCallback`).

**Contract**: `useCatalogFilters(cohorts: readonly CohortOption[])`.

**File**: `src/_pages/students/model/use-catalog-dialogs.ts`

**Intent**: Dialog coordination state, mirroring `teachers/model/use-catalog-dialogs.ts` verbatim with `StudentRow` targets.

**Contract**: `{ formOpen, formStudent, openCreate, openEdit, closeForm, deleteTarget, openDelete, closeDelete }`.

#### 2. Lib layer

**File**: `src/_pages/students/lib/labels.ts`

**Intent**: Compact course label for badges and picker items, mirroring `teachers/lib/labels.ts:6-15` (name + level unless `"none"` + circled group digit).

**Contract**: `formatChoiceLabel({ name, level, groupIndex }): string`. Slice-local by design (see What We're NOT Doing).

#### 3. API layer

**File**: `src/_pages/students/api/loader.ts`

**Intent**: Page loader returning students with their choice ids, ordered cohorts, and labeled course options.

**Contract**: `loadStudentCatalog(supabase | null): Promise<LoaderResult<{ students: StudentRow[]; cohorts: CohortOption[]; courses: CourseOption[] }>>` via `withSupabase`. Parallel selects: `cohorts`, `students` (order `full_name`, limit 500), `student_choices` (`student_id, course_id`, limit 2000 — ~150 students × ~9 choices), `courses` (`id, cohort_id, name, level, group_index`, limit 500), `course_merges` (`parent_course_id`) to set `isMergeParent`. Group choices by `student_id` via `groupBy`; `assertNoQueryErrors` over all results.

**File**: `src/_pages/students/api/{constants,create-student,update-student,delete-student}.ts`

**Intent**: Framework-free domain functions mirroring the teachers trio; per-entity messages in `constants.ts`.

**Contract**: `createStudent(supabase, input)` inserts `{ cohort_id, full_name }` via `unwrapRow`; `updateStudent` updates by id (`notFound: "Student not found."`); `deleteStudent` deletes by id via `unwrapCompleted`. No conflict message (no unique constraint). Choices handling joins in Phase 2.

**File**: `src/_pages/students/api/actions.ts`

**Intent**: Declarative routing table via `defineDomainAction`, mirroring teachers.

**Contract**: `studentActions = { createStudent, updateStudent, deleteStudent }`.

**File**: `src/actions/index.ts`

**Intent**: Register `studentActions` in the composition barrel alongside course/teacher actions.

**Contract**: Spread/namespace exactly as the existing slices are registered.

**File**: `src/_pages/students/api/student-client.ts` and `src/_pages/students/api/index.ts`

**Intent**: Typed `callAction` wrappers (one one-liner per action) and the public barrel (loader + types + actions only — client wrappers stay deep-imported).

**Contract**: `createStudent(values: StudentInput)`, etc., returning `{ error }`.

#### 4. UI layer

**File**: `src/_pages/students/ui/StudentCatalog.tsx` (+ slice root `index.ts`)

**Intent**: Thin orchestrator island: header + "New student" button, name-search `Input`, cohort `Tabs` with one `TabsContent` per cohort rendering the filtered table (CourseCatalog pattern), dialogs, `Toaster`. Computes `coursesById` once and passes down.

**Contract**: `Props = { students: StudentRow[]; cohorts: CohortOption[]; courses: CourseOption[] }`. Active tab seeds `defaultCohortId` on the form dialog (`CourseCatalog.tsx:109` pattern).

**File**: `src/_pages/students/ui/StudentTable.tsx`

**Intent**: Table with Name | Choices (badge chips via private `ChoiceBadges` sub-component, `—` when empty) | `#` count | row `DropdownMenu` (Edit / Delete). Empty-catalog and no-results states mirroring `TeacherTable`.

**Contract**: `rows`, `totalCount`, `coursesById`, `onEdit`, `onDelete`, `onCreateFirst`.

**File**: `src/_pages/students/ui/StudentFormDialog.tsx`

**Intent**: Create/edit dialog — `fullName` `Input` + `cohortId` `Select` (options from `cohorts`), RHF + `zodResolver`, `mode: "onTouched"`, private `useStudentForm` below the component, `submitForm` without `conflictField`, reset-on-open with student values or `{ fullName: "", cohortId: defaultCohortId }`.

**Contract**: `{ open, onClose, student: StudentRow | null, cohorts, defaultCohortId }` following the `onClose` dialog contract.

**File**: `src/_pages/students/ui/DeleteStudentDialog.tsx`

**Intent**: `AlertDialog` + private `useConfirmAction`, mirroring `DeleteTeacherDialog`; the description states the cascade impact: "This also removes its N course choices." (count from `student.choiceCourseIds.length`).

**Contract**: `{ student: StudentRow | null, onClose }`.

#### 5. Route

**File**: `src/pages/students.astro`

**Intent**: Replace the placeholder body with loader wiring mirroring `teachers.astro`: `createClient` → `loadStudentCatalog` → 503/empty-cohorts branches → `<StudentCatalog … client:load />`.

**Contract**: Same three-branch template as `src/pages/teachers.astro:13-22`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass (schemas, filter-params, filter-students): `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure passes: `pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- `/students` lists seeded students under cohort tabs with choice badges and counts
- Create / edit (name + cohort) / delete a student works end-to-end with toasts and page refresh
- "New student" on the Year 2 tab pre-selects Year 2 in the cohort select
- Name search narrows rows; tab + query survive a reload via the URL

**Implementation Note**: After this phase passes automated checks, pause for manual confirmation before Phase 2.

---

## Phase 2: Choices editor in the form dialog

### Overview

Make choices editable: `choiceCourseIds` joins the schema and form as a shared-`MultiSelect` field scoped to the selected cohort; cohort change visibly resets the selection; the server writes the whole set atomically (create) or as an insert-then-delete diff (update), with an authoritative cohort-membership guard.

### Changes Required:

#### 1. Promote the atomic-write helper

**File**: `src/shared/lib/write-parent-with-links.ts` (move from `src/_pages/courses/api/write-merge-atomic.ts`, test moves alongside)

**Intent**: Second consumer crosses the promotion threshold. Same mechanism, merge-neutral name.

**Contract**: `writeParentWithLinks(ops: { insertParent; insertLinks; deleteParent })` — identical semantics; update `courses/api/create-merge.ts` and the moved test's imports. Pure module (no astro imports) so it stays in the unit suite; deep-import it from slice api files (not the `@/shared/lib` barrel).

#### 2. Model layer

**File**: `src/_pages/students/model/schemas.ts` (+ test)

**Intent**: Add the choices field to create/update inputs.

**Contract**: `choiceCourseIds: z.array(z.uuid()).default([])` — empty set valid (decided: no count constraint). `StudentFormValues`/`StudentInput` stay schema-derived.

**File**: `src/_pages/students/model/diff-choices.ts` (+ test)

**Intent**: Pure set diff the update path and its tests hinge on.

**Contract**: `diffChoices(current: readonly string[], next: readonly string[]): { toAdd: string[]; toRemove: string[] }`.

#### 3. API layer

**File**: `src/_pages/students/api/assert-choices-in-cohort.ts`

**Intent**: Authoritative server-side guard: every submitted course id must exist and belong to the submitted cohort (see Critical Implementation Details).

**Contract**: `assertChoicesInCohort(supabase, cohortId, courseIds): Promise<void>` — throws `DomainError` (BAD_REQUEST, message in `constants.ts`) on any mismatch or missing id. No-op for the empty set.

**File**: `src/_pages/students/api/create-student.ts`

**Intent**: Insert student + choices with compensating cleanup.

**Contract**: guard → `writeParentWithLinks({ insertParent: insert students row; insertLinks: bulk-insert student_choices; deleteParent: delete the student })`.

**File**: `src/_pages/students/api/update-student.ts`

**Intent**: Update the student row, then reconcile choices as a diff.

**Contract**: guard → update `{ full_name, cohort_id }` via `unwrapRow` → read current choice course ids → `diffChoices` → insert `toAdd` (if any) → delete `toRemove` (if any), each via `unwrapCompleted`/`unwrapRow` ladders. Insert-before-delete ordering is load-bearing (see Critical Implementation Details). A cohort change naturally lands all old-cohort choices in `toRemove` because the guard has already pinned `next` to the new cohort.

#### 4. UI layer

**File**: `src/_pages/students/ui/StudentFormDialog.tsx`

**Intent**: Add the choices `FormField` binding the shared `MultiSelect` (MergeBuilderDialog pattern: `selectedIds={field.value}`, `onChange`, `onBlur`, count-or-placeholder trigger, chips below). Items = `courses.filter(c => c.cohortId === watchedCohortId && !c.isMergeParent)` labeled via `CourseOption.label`. Edit mode seeds `choiceCourseIds` from the row. Cohort `Select` change clears the choices field inside its own `onChange` handler (not an effect), with a muted helper line under the picker: "Choices are limited to the selected cohort."

**Contract**: The cohort-change reset:

```tsx
// inside the cohortId FormField render
onValueChange={(next) => {
  if (next !== field.value) form.setValue("choiceCourseIds", [], { shouldDirty: true });
  field.onChange(next);
}}
```

(Handler-scoped so `form.reset` on dialog open/edit-prefill can never misfire it.)

### Success Criteria:

#### Automated Verification:

- New unit tests pass (diff-choices, schemas with choices, moved write-parent-with-links test, assert-choices-in-cohort if testable purely): `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure passes (shared-lib promotion is downward-only imports): `pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- Create a student with several choices in one submit; badges appear in the table
- Edit a student: add + remove choices in one submit; table reflects the new set after refresh
- Change cohort on an existing student: chips visibly clear before submit, picker now lists the new cohort's courses, submit persists the new state
- Picker excludes composite merge-parent courses and offers only the selected cohort's courses
- Searching inside the picker filters by label; chips remove on X

**Implementation Note**: After this phase passes automated checks, pause for manual confirmation before Phase 3.

---

## Phase 3: Course filter + integration tests

### Overview

Close scope: filter students by chosen courses (shared `MultiSelect`, options scoped to the active tab), fold `courseIds` into the URL codec and the pure predicate, and land the CRUD integration test the lessons.md rule mandates.

### Changes Required:

#### 1. Model layer

**File**: `src/_pages/students/model/filter-params.ts` (+ test)

**Intent**: Add `courseIds` to the codec, validated against the known course list (mirroring how courses validates `teacherIds`).

**Contract**: `{ cohortId, query, courseIds }`; unknown ids dropped on parse; empty list omitted on serialize.

**File**: `src/_pages/students/model/filter-students.ts` (+ test)

**Intent**: Add the choice-set intersection clause.

**Contract**: `filterStudents(students, cohortId, query, selectedCourseIds)` — empty selection keeps all; otherwise keep students whose `choiceCourseIds` intersects the selection.

**File**: `src/_pages/students/model/use-catalog-filters.ts`

**Intent**: Expose `selectedCourseIds`/`setSelectedCourseIds`; `setActiveCohortId` also clears `courseIds` (a stale other-cohort selection would silently empty the new tab).

**Contract**: Single state update — `setState(current => ({ ...current, cohortId: id, courseIds: [] }))`.

#### 2. UI layer

**File**: `src/_pages/students/ui/CourseFilter.tsx`

**Intent**: Filter control over the shared `MultiSelect` (TeacherFilter role): options = active cohort's non-merge-parent courses, count badge in the trigger, chips + clear.

**Contract**: `{ courses: CourseOption[]; selectedIds: string[]; onChange: (ids: string[]) => void }`; rendered in `StudentCatalog`'s filter row next to the name `Input`.

#### 3. Integration tests

**File**: `src/_pages/students/api/students-crud.integration.test.ts`

**Intent**: CRUD round-trip against local Supabase per the lessons.md rule ("Catalog CRUD integration tests belong in the test harness"), following `plan-detail/api/endpoint.integration.test.ts` (service-role client, `describe.skip` without env, cleanup in `afterAll`).

**Contract**: Drives the domain functions directly: create student with choices → read back rows → update replacing part of the set (assert diff result + unique constraint untouched) → update with cohort change (assert old-cohort choices gone, guard rejects cross-cohort ids) → delete (assert `student_choices` cascade left no rows).

### Success Criteria:

#### Automated Verification:

- Unit tests pass (codec + predicate with courseIds): `pnpm test`
- Integration tests pass against local Supabase: `pnpm test:integration`
- Lint passes: `pnpm lint`
- FSD structure passes: `pnpm steiger`
- Build stays clean: `pnpm build`

#### Manual Verification:

- Selecting courses in the filter narrows the list to students who chose any of them; clearing restores all
- Course filter, name search, and tabs compose; all three survive reload via the URL
- Switching tabs clears the course selection (no silently-empty list)

---

## Testing Strategy

### Unit Tests:

- `schemas.test.ts` — trim/required name, uuid cohort, choices array default + uuid validation.
- `filter-params.test.ts` — round-trip codec, unknown cohort/course-id fallback, empty-param omission.
- `filter-students.test.ts` — cohort partition, case-insensitive query, intersection semantics, empty-selection passthrough, combined clauses.
- `diff-choices.test.ts` — add-only, remove-only, mixed, no-op, full-replacement (cohort-change shape).
- `write-parent-with-links.test.ts` (moved) — success path and compensating cleanup on link failure.

### Integration Tests:

- `students-crud.integration.test.ts` — full CRUD round-trip incl. choice replacement, cohort-change reconciliation, cross-cohort guard rejection, delete cascade (see Phase 3).

### Manual Testing Steps:

1. `pnpm exec supabase db reset && pnpm dev`, sign in, open `/students`.
2. Walk each phase's Manual Verification list (above).
3. Edge cases: student with zero choices (renders `—`, count 0, valid submit); cancel after a cohort change (no persistence); both cohort tabs with seeded dp1/dp2 data.

## Performance Considerations

Catalog scale is ~50–150 students × ~9 choices — trivially within the loader's parallel-select + `groupBy` approach (limits: 500 students, 2000 choices, 500 courses, mirroring existing loaders). No pagination, no virtualization. The `<200ms` constraint budget concerns plan-detail drag-drop, not this catalog page.

## Migration Notes

None — both tables, their constraints, and cascades already exist. No data migration; seeded fixture data is display-compatible.

## References

- Related research: `context/changes/students-and-choices-ui/research.md`
- CRUD template: `src/_pages/teachers/` (loader, dialogs, form, delete, actions)
- Tabs + URL-sync template: `src/_pages/courses/ui/CourseCatalog.tsx:75-109`, `src/_pages/courses/model/use-catalog-filters.ts`
- Form-bound MultiSelect: `src/_pages/courses/ui/MergeBuilderDialog.tsx:75-94`
- Atomic write mechanism: `src/_pages/courses/api/write-merge-atomic.ts`
- Integration harness: `src/_pages/plan-detail/api/endpoint.integration.test.ts`
- Conventions: `context/foundation/ui-conventions.md`; lessons: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Students flat CRUD + catalog shell

#### Automated

- [x] 1.1 Unit tests pass (schemas, filter-params, filter-students): `pnpm test` — 2a16923
- [x] 1.2 Lint passes: `pnpm lint` — 2a16923
- [x] 1.3 FSD structure passes: `pnpm steiger` — 2a16923
- [x] 1.4 Build stays clean: `pnpm build` — 2a16923

#### Manual

- [x] 1.5 `/students` lists seeded students under cohort tabs with choice badges and counts — 2a16923
- [x] 1.6 Create / edit (name + cohort) / delete works end-to-end with toasts and refresh — 2a16923
- [x] 1.7 "New student" on the Year 2 tab pre-selects Year 2 — 2a16923
- [x] 1.8 Name search narrows rows; tab + query survive reload via URL — 2a16923

### Phase 2: Choices editor in the form dialog

#### Automated

- [x] 2.1 New unit tests pass (diff-choices, schemas, moved write-parent-with-links): `pnpm test`
- [x] 2.2 Lint passes: `pnpm lint`
- [x] 2.3 FSD structure passes: `pnpm steiger`
- [x] 2.4 Build stays clean: `pnpm build`

#### Manual

- [x] 2.5 Create a student with several choices in one submit; badges appear
- [x] 2.6 Edit adds + removes choices in one submit; table reflects new set
- [x] 2.7 Cohort change visibly clears chips before submit; new cohort's courses listed; submit persists
- [x] 2.8 Picker excludes merge-parent composites and other-cohort courses
- [x] 2.9 Picker search filters by label; chips remove on X

### Phase 3: Course filter + integration tests

#### Automated

- [ ] 3.1 Unit tests pass (codec + predicate with courseIds): `pnpm test`
- [ ] 3.2 Integration tests pass: `pnpm test:integration`
- [ ] 3.3 Lint passes: `pnpm lint`
- [ ] 3.4 FSD structure passes: `pnpm steiger`
- [ ] 3.5 Build stays clean: `pnpm build`

#### Manual

- [ ] 3.6 Course filter narrows to students who chose any selected course; clearing restores
- [ ] 3.7 Course filter + name search + tabs compose and survive reload via URL
- [ ] 3.8 Switching tabs clears the course selection
