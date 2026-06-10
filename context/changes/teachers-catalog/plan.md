# Teachers Catalog Implementation Plan

## Overview

Build a teacher CRUD catalog page at `/teachers` with read-only course assignment visibility, replicating the established `src/_pages/courses/` architecture. Teachers are managed (create/edit/delete) here; assignments are authored on `/courses` and displayed read-only as cohort-scoped course badges with workload totals.

## Current State Analysis

- The `teachers` table exists (`id`, `code` UNIQUE, `full_name` nullable, timestamps) — no migration needed
- `courses.teacher_id` FK → `teachers.id` (nullable, ON DELETE SET NULL) already tracks assignments
- `src/pages/teachers.astro` is a placeholder with "coming in S-03" text
- `/teachers` is already in the nav config (`src/shared/config/nav.ts:14`)
- Teachers are consumed read-only in courses (filter, form, labels) and plan-detail (collision detection)
- No `src/_pages/teachers/` directory exists yet
- 18 seed teachers exist (code-only, no `full_name`)

## Desired End State

A fully functional `/teachers` page where the author can:
1. See all teachers in a single table with Y1/Y2 course badge columns and workload hours
2. Create new teachers (code required, full_name optional)
3. Edit existing teachers (code + full_name)
4. Delete teachers with a confirmation dialog showing assignment impact
5. Filter by text search (immediate, matching code/name/course names) and optional year toggle
6. See static course badges grouped by cohort with per-cohort hours and a cross-cohort total

Verification: navigate to `/teachers`, confirm CRUD works, filters work, badges render correctly, duplicate code produces a field error, delete shows correct impact count and cascades to SET NULL on courses.

### Key Discoveries:

- `src/_pages/courses/` provides a 1:1 replicable template (39 files)
- Courses loader already fetches teachers as `TeacherOption[]` — the teachers loader inverts this join
- `DomainError("CONFLICT")` + `UNIQUE_VIOLATION` code pattern handles duplicate `code`
- `applyActionFieldErrors` from `@/shared/lib` maps server field errors to RHF
- `navigate(pathname + search)` after mutations preserves URL filter state

## What We're NOT Doing

- Teacher availability rules (deferred to follow-up change)
- Validator extension to named teacher collision classes (deferred)
- Editable assignments from this page (authored on `/courses`)
- Teacher import from CSV
- Sortable table columns (single default sort for now)
- Client-side pagination or virtualization (18 teachers — unnecessary)

## Implementation Approach

Direct replication of the courses slice architecture, layer by layer. Every file in `src/_pages/teachers/` maps 1:1 to a courses equivalent. The key structural difference: no cohort tabs (single flat table with structural Y1/Y2 columns), and a text+year filter instead of a teacher multi-select filter.

## Phase 1: Model + Schemas

### Overview

Establish the data types, validation schemas, and pure filter logic that the API and UI layers depend on.

### Changes Required:

#### 1. View-model types

**File**: `src/_pages/teachers/model/teacher.ts`

**Intent**: Define the `TeacherRow` view-model (assembled by the loader, consumed by the UI) and the `CourseAssignment` projection for badge display.

**Contract**: `TeacherRow` has `id`, `code`, `fullName`, and `assignments: CourseAssignment[]`. `CourseAssignment` has `id`, `cohortId`, `name`, `level`, `groupIndex`, `hours`. Exports both types.

#### 2. Validation schemas

**File**: `src/_pages/teachers/model/schemas.ts`

**Intent**: Single source of truth for teacher validation, shared by Astro Actions (server gate) and react-hook-form (client resolver). Mirrors courses' `schemas.ts` approach.

**Contract**:
- `teacherInput`: `z.object({ code: z.string().trim().min(1), fullName: z.string().trim().optional().transform(empty → undefined) })`
- `updateTeacherInput`: `teacherInput.extend({ id: z.uuid() })`
- `deleteTeacherInput`: `z.object({ id: z.uuid() })`
- Exported inferred types: `TeacherInput`, `UpdateTeacherInput`, `DeleteTeacherInput`

#### 3. Pure filter function

**File**: `src/_pages/teachers/model/filter-teachers.ts`

**Intent**: Pure predicate pipeline that narrows teacher rows by text search and optional year filter. Stateless and testable.

**Contract**: `filterTeachers(teachers: TeacherRow[], query: string, yearFilter: "all" | "y1" | "y2", cohortIds: { y1: string; y2: string }): TeacherRow[]`. Text search matches against `code`, `fullName`, and course names within `assignments` (case-insensitive substring). Year filter keeps teachers with ≥1 assignment in the matching cohort.

#### 4. Filter params (URL sync)

**File**: `src/_pages/teachers/model/filter-params.ts`

**Intent**: Serialize/deserialize filter state to/from URL query string so post-mutation `navigate` preserves filters.

**Contract**:
- `TeacherFilters`: `{ query: string; year: "all" | "y1" | "y2" }`
- `readFilterParams(search: string): TeacherFilters` — parse `?q=` and `?year=`
- `toFilterSearch(filters: TeacherFilters): string` — serialize, omitting defaults

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro sync && pnpm lint`
- Unit tests pass for `filter-teachers.ts`: `pnpm test`
- Unit tests pass for `filter-params.ts`: `pnpm test`
- Schema validation tests pass for `schemas.ts`: `pnpm test`

#### Manual Verification:

- N/A (no UI in this phase)

**Implementation Note**: After completing this phase and all automated verification passes, proceed to Phase 2.

---

## Phase 2: API Layer

### Overview

Build the server-side data loading, CRUD handlers, action definitions, and typed client wrapper. Register teacher actions in the global barrel.

### Changes Required:

#### 1. Constants

**File**: `src/_pages/teachers/api/constants.ts`

**Intent**: Centralize the Postgres error code and user-facing duplicate message for teacher `code` uniqueness violations.

**Contract**: Export `UNIQUE_VIOLATION = "23505"` and `DUPLICATE_TEACHER_MESSAGE = "A teacher with this code already exists."`.

#### 2. Loader

**File**: `src/_pages/teachers/api/loader.ts`

**Intent**: Server-side data fetching that assembles `TeacherRow[]` with joined course assignments, scoped by cohort. Mirrors `courses/api/loader.ts` discriminated-union pattern.

**Contract**:
- `TeacherCatalogData`: `{ teachers: TeacherRow[]; cohortIds: { y1: string; y2: string } }`
- `TeacherCatalogResult`: `{ kind: "ok"; data: TeacherCatalogData } | { kind: "unavailable" }`
- `loadTeacherCatalog(supabase: SupabaseClient | null): Promise<TeacherCatalogResult>`
- Fetches teachers (ordered by `full_name NULLS LAST, code`) + cohorts + courses, joins in memory to build `TeacherRow.assignments` grouped by cohort

#### 3. Create handler

**File**: `src/_pages/teachers/api/create-teacher.ts`

**Intent**: Insert a teacher row, catching UNIQUE_VIOLATION on `code`.

**Contract**: `createTeacher(supabase, input: TeacherInput) → data | throws DomainError("CONFLICT" | "INTERNAL_SERVER_ERROR")`

#### 4. Update handler

**File**: `src/_pages/teachers/api/update-teacher.ts`

**Intent**: Update a teacher's code and/or full_name by id, catching UNIQUE_VIOLATION on `code`.

**Contract**: `updateTeacher(supabase, input: UpdateTeacherInput) → data | throws DomainError`

#### 5. Delete handler

**File**: `src/_pages/teachers/api/delete-teacher.ts`

**Intent**: Delete a teacher by id. The DB cascades to `SET NULL` on `courses.teacher_id` automatically.

**Contract**: `deleteTeacher(supabase, input: DeleteTeacherInput) → { ok: true } | throws DomainError`

#### 6. Action definitions

**File**: `src/_pages/teachers/api/actions.ts`

**Intent**: Astro Action registry for teacher CRUD, following the thin-orchestration pattern (`requireSession → requireSupabase → runDomain`).

**Contract**: Export `teacherActions` object with `createTeacher`, `updateTeacher`, `deleteTeacher` actions, each using the corresponding schema from `model/schemas.ts`.

#### 7. Client wrapper

**File**: `src/_pages/teachers/api/teacher-client.ts`

**Intent**: Typed RPC boundary for React islands. Returns `{ error }` so dialogs can branch on field errors, conflict codes, and toasts.

**Contract**: Export `createTeacher(values)`, `updateTeacher(values)`, `deleteTeacher(values)` — each returning `ActionResult<TInput>`.

#### 8. API barrel

**File**: `src/_pages/teachers/api/index.ts`

**Intent**: Re-export loader, actions, and handlers for consumption by the page and global action barrel.

**Contract**: Export `{ loadTeacherCatalog, teacherActions }`.

#### 9. Global action registration

**File**: `src/actions/index.ts`

**Intent**: Spread `teacherActions` into the global `server` object so Astro recognizes the new actions.

**Contract**: Add `import { teacherActions } from "@/_pages/teachers/api"` and `...teacherActions` to the `server` export.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro sync && pnpm lint`
- Build passes: `pnpm build`
- Integration tests pass (if Supabase running): teacher CRUD actions respond correctly

#### Manual Verification:

- Call teacher actions via Astro dev tools or curl and verify DB state changes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 3.

---

## Phase 3: UI + Page Wiring

### Overview

Build the React UI components (orchestrator, table, dialogs), hooks (filter, dialog coordination), and wire everything into the Astro page.

### Changes Required:

#### 1. Filter hook

**File**: `src/_pages/teachers/model/use-catalog-filters.ts`

**Intent**: Owns filter state (text query + year toggle) and URL sync with the two-phase pattern (SSR-safe defaults → seed from URL on mount).

**Contract**: `useCatalogFilters(): { query, setQuery, year, setYear }` with URL params `?q=` and `?year=`.

#### 2. Dialogs hook

**File**: `src/_pages/teachers/model/use-catalog-dialogs.ts`

**Intent**: Owns which dialog is open and its target row. Simpler than courses (no overlaps/merge) — just form + delete.

**Contract**: `useCatalogDialogs(): { formOpen, formTeacher, openCreate, openEdit, closeForm, deleteTarget, openDelete, closeDelete }`.

#### 3. Teacher table

**File**: `src/_pages/teachers/ui/TeacherTable.tsx`

**Intent**: Presentational table with columns: Code, Name, Y1 Courses (badges), Y1h, Y2 Courses (badges), Y2h, Total, Actions. Row actions: Edit, Delete.

**Contract**: Props: `rows: TeacherRow[]`, `totalCount: number`, `cohortIds: { y1: string; y2: string }`, `onEdit`, `onDelete`, `onCreateFirst: () => void`. Badges are static, display course `name` + `level` + group-index suffix (circled digit when > 0). Empty cohort badge cells show em-dash; hours columns show 0. Sort: by `fullName` (nulls last) then `code`. Two distinct empty states: when `totalCount === 0` (no teachers in DB) show "No teachers yet — create your first teacher" with a "New teacher" button; when `rows.length === 0` but `totalCount > 0` (filter yielded nothing) show "No teachers match the current filter."

#### 4. Teacher form dialog

**File**: `src/_pages/teachers/ui/TeacherFormDialog.tsx`

**Intent**: Create/edit dialog with code (required) + fullName (optional). Shared `teacherInput` schema drives both client validation (RHF zodResolver, mode "onTouched") and server action gate.

**Contract**: Props: `open`, `onOpenChange`, `teacher: TeacherRow | null`. Create vs edit determined by `teacher === null`. CONFLICT error maps to `code` field. Success → toast + close + navigate.

#### 5. Delete teacher dialog

**File**: `src/_pages/teachers/ui/DeleteTeacherDialog.tsx`

**Intent**: AlertDialog confirming destructive delete with assignment impact count. "This teacher is assigned to N courses. Deleting will remove their assignment from those courses."

**Contract**: Props: `teacher: TeacherRow | null`, `onOpenChange`. Open when `teacher !== null`. Uses `teacher.assignments.length` for impact count. On confirm: call `deleteTeacher`, toast, close, navigate.

#### 6. Orchestrator component

**File**: `src/_pages/teachers/ui/TeacherCatalog.tsx`

**Intent**: Thin orchestrator island: header with "New teacher" button, filter bar (text input + year toggle group), table, dialogs, toaster. Destructures hooks, wires props.

**Contract**: Props: `teachers: TeacherRow[]`, `cohortIds: { y1: string; y2: string }`. Applies `filterTeachers(...)` in render. Passes `totalCount={teachers.length}` to `TeacherTable` so it can distinguish "zero in DB" from "zero after filter". Mounts form + delete dialogs once at bottom.

#### 7. Slice barrel

**File**: `src/_pages/teachers/index.ts`

**Intent**: Export only the orchestrator component (convention: single public export per slice).

**Contract**: `export { default as TeacherCatalog } from "./ui/TeacherCatalog"` (or default re-export).

#### 8. Page wiring

**File**: `src/pages/teachers.astro`

**Intent**: Replace the placeholder with the full catalog page, following the same SSR pattern as `courses.astro` — create client, load data, handle unavailable state, render island.

**Contract**: Import `loadTeacherCatalog` from the teachers API; render `<TeacherCatalog>` with `client:load`. Handle `unavailable` and empty states with muted text messages.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro sync && pnpm lint`
- Lint passes: `pnpm lint`
- Build passes: `pnpm build`
- Unit tests pass: `pnpm test`

#### Manual Verification:

- Navigate to `/teachers` — table renders with seed data (18 teachers, badges, hours)
- With zero teachers in DB: shows "No teachers yet" empty state with create CTA
- Create a teacher with code "TEST" — appears in table after navigation
- Create another "TEST" — field error "A teacher with this code already exists."
- Edit a teacher's full_name — reflected in table
- Delete a teacher with assignments — confirmation shows correct count; after delete, courses show unassigned
- Text search filters by code, name, and course name
- Year toggle filters to teachers with courses in selected cohort
- Empty badge cells show — and 0h

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before considering this change complete.

---

## Testing Strategy

### Unit Tests:

- `model/filter-teachers.test.ts` — text search matching (code, name, course name), year filter, combined predicates, case-insensitivity, empty query returns all
- `model/filter-params.test.ts` — round-trip serialize/parse, defaults on empty params, unknown year values
- `model/schemas.test.ts` — code required, empty code rejected, fullName optional, empty fullName → undefined, id required on update

### Integration Tests:

- Teacher CRUD via Supabase: create → read back → update → delete, verify cascade SET NULL on courses

### Manual Testing Steps:

1. Open `/teachers` — confirm table layout matches design decision (Code | Name | Y1 badges | Y1h | Y2 badges | Y2h | Total | Actions)
2. Create teacher "ZZ" with no full_name — row appears with code "ZZ", name column shows "—"
3. Attempt duplicate code — confirm inline error on `code` field
4. Edit teacher to add full_name — confirm it appears in Name column
5. Verify badge content shows course `name` + `level` + circled digit (when group-index > 0)
6. Verify workload totals sum correctly across cohorts
7. Delete teacher with assignments — verify impact count, confirm, check courses page shows unassigned

## Performance Considerations

No concerns at current scale (18 teachers, ~60 courses). The loader performs a simple two-query parallel fetch (teachers + courses) with in-memory join. No pagination needed.

## References

- Related research: `context/changes/teachers-catalog/research.md`
- Reference implementation: `src/_pages/courses/` (full 39-file template)
- Courses loader (teachers as `TeacherOption[]`): `src/_pages/courses/api/loader.ts:25`
- Migration (teachers DDL): `supabase/migrations/20260602185012_minimal_domain_schema.sql:16-26`
- UI conventions: `context/foundation/ui-conventions.md`
- Lessons: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Model + Schemas

#### Automated

- [x] 1.1 Type checking passes after model types + schemas + filter logic — 3d0f5f9
- [x] 1.2 Unit tests pass for filter-teachers — 3d0f5f9
- [x] 1.3 Unit tests pass for filter-params — 3d0f5f9
- [x] 1.4 Unit tests pass for schemas — 3d0f5f9

### Phase 2: API Layer

#### Automated

- [x] 2.1 Type checking passes after loader + handlers + actions + client + barrel registration — b73e71d
- [x] 2.2 Build passes with teacher actions registered — b73e71d

#### Manual

- [x] 2.3 Teacher CRUD actions respond correctly via Astro dev tools — b73e71d

### Phase 3: UI + Page Wiring

#### Automated

- [x] 3.1 Type checking passes
- [x] 3.2 Lint passes
- [x] 3.3 Build passes
- [x] 3.4 Unit tests pass

#### Manual

- [x] 3.5 Table renders with seed data, badges, hours
- [x] 3.6 CRUD operations work end-to-end (create, duplicate error, edit, delete with impact)
- [x] 3.7 Filters work (text search + year toggle)
- [x] 3.8 Empty states display correctly (—, 0h)
