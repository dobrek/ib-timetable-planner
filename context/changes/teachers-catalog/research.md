---
date: 2026-06-10T13:50:00+02:00
researcher: AI
git_commit: 3d20d830c76f88e2413d5823b4098ca6a4165471
branch: main
repository: ib-timetable-planner
topic: "Open questions and architecture review before planning teachers-catalog"
tags: [research, codebase, teachers, catalog, S-03, availability, validation]
status: complete
last_updated: 2026-06-10
last_updated_by: AI
last_updated_note: "Folded in design decisions from discussion: table layout, badge content, filtering, scope narrowing"
---

# Research: Open questions before planning teachers-catalog

**Date**: 2026-06-10T13:50:00+02:00
**Researcher**: AI
**Git Commit**: 3d20d830c76f88e2413d5823b4098ca6a4165471
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

What open questions need to be addressed before planning the teachers-catalog change? Using `src/_pages/courses/` as a reference implementation and `context/foundation/ui-conventions.md` as the conventions baseline.

## Summary

The teachers-catalog change is **scoped to teacher CRUD with read-only assignment visibility** — no availability, no validator extension. The architecture is extensibility-ready for those follow-up changes.

Key settled decisions:
1. **Table layout:** one row per teacher with structural Y1/Y2 course badge columns + hours + total workload
2. **Badge content:** `name` + `level` + group-index (when > 0, shown as circled digit suffix)
3. **Filtering:** text search + optional year filter — controls row visibility, never column visibility
4. **Assignments are read-only** — authored on `/courses`, displayed here
5. **`full_name` optional**, `code` is primary identifier
6. **Delete with confirmation** showing assignment impact count
7. **Code uniqueness** validated at submit time (consistent with courses pattern)

The courses slice (`src/_pages/courses/`) provides a complete, replicable template. No architectural novelty needed.

## Detailed Findings

### 1. Existing schema — minimal but sufficient for basic CRUD

The `teachers` table exists with a simple shape:

| Column | Type | Constraint |
|--------|------|-----------|
| `id` | uuid | PK, `gen_random_uuid()` |
| `code` | text | NOT NULL, UNIQUE |
| `full_name` | text | nullable |
| `created_at` | timestamptz | NOT NULL, default `now()` |
| `updated_at` | timestamptz | NOT NULL, moddatetime trigger |

Assignment is **inline** on courses: `courses.teacher_id → teachers.id` (nullable, ON DELETE SET NULL). No junction table — one teacher per course is the settled design from F-02.

**No `teacher_availability` table exists.** Explicitly deferred to S-03 per `minimal-domain-schema` plan.

### 2. Courses reference slice — fully replicable pattern

The `src/_pages/courses/` slice provides a complete template:

| Layer | File pattern | Teachers equivalent |
|-------|-------------|---------------------|
| View-models | `model/course.ts` → `CourseRow`, `TeacherOption` | `model/teacher.ts` → `TeacherRow` |
| Schemas | `model/schemas.ts` — Zod, shared by actions + RHF | `model/schemas.ts` — teacher input schemas |
| Pure logic | `model/filter-courses.ts` | `model/filter-teachers.ts` (simpler — text search?) |
| Hooks | `model/use-catalog-filters.ts`, `use-catalog-dialogs.ts` | Same two hooks |
| Loader | `api/loader.ts` → `CatalogResult` discriminated union | `api/loader.ts` → `TeacherCatalogResult` |
| Actions | `api/actions.ts` → `courseActions` object | `api/actions.ts` → `teacherActions` |
| Client | `api/course-client.ts` → `runAction` wrapper | `api/teacher-client.ts` |
| Handlers | `api/create-course.ts`, `update-course.ts`, `delete-course.ts` | Same CRUD verbs |
| Orchestrator | `ui/CourseCatalog.tsx` | `ui/TeacherCatalog.tsx` |
| Table | `ui/CourseTable.tsx` | `ui/TeacherTable.tsx` |
| Dialogs | `CourseFormDialog.tsx`, `DeleteCourseDialog.tsx` | Same pattern |
| Barrel | `index.ts` exports orchestrator only | Same |

Key conventions from `ui-conventions.md`:
- Hooks span independent behavioral flows (not monolithic bags)
- Newspaper file ordering (component first, hooks below)
- Declarative orchestrating components (no inline state/effects)
- Astro Actions are the single transport (`api/<slice>-client.ts` wrappers)
- `mode: "onTouched"` for forms, Zod shared between action + resolver

### 3. Current teacher usage across the app

Teachers are already consumed in two contexts:

**Courses catalog** — as a lookup for assignment + filtering:
- `src/_pages/courses/api/loader.ts:25` fetches `teachers` for `TeacherOption[]`
- `TeacherFilter.tsx` — multi-select filter by teacher UUID
- `CourseFormDialog.tsx` — required teacher `<Select>` on create/edit

**Plan-detail / validator** — for collision detection:
- `src/_pages/plan-detail/model/collision.ts:7-9` — `teacherKey` comparison (lumped with student collisions under one generic badge)
- `GroupingCourse.teacherKey` carries the teacher UUID (DB path) or code (CSV fixture path)

### 4. Validator current state vs FR-012 target

| FR-012 class | Status | Owner |
|--------------|--------|-------|
| (a) Student collisions | Implemented (generic badge) | S-01 ✓ |
| (b) Teacher in cohort | **Detected** by `hasIntersection` but **not named** — lumped with students | S-03 |
| (c) Teacher vs other cohort | Not implemented | S-09 |
| (d) Teacher availability | Not implemented (no table, no logic) | S-03 |

### 5. Scope narrowing vs roadmap S-03

The roadmap S-03 is `teachers-and-availability-catalog-ui` — a broader scope including:
- Teacher CRUD ← **this change**
- Assignment UI (read-only display) ← **this change**
- Availability rules ← deferred
- Validator extension to named classes (b) and (d) ← deferred

This change (`teachers-catalog`) covers the CRUD + read-only assignment visibility subset. The remaining S-03 work (availability + validator) becomes a follow-up change once this ships.

## Design Decisions (settled)

### D1: Scope — teacher CRUD only (extensibility-ready)

This change covers teacher CRUD (create/edit/delete/list) with read-only assignment visibility. Availability rules, validator extension, and named collision classes are deferred to a follow-up change. The architecture is designed so these extensions slot in without restructuring.

### D2: Table layout — one row per teacher, cohort-scoped assignment columns

The table uses a flat layout with structural cohort columns (always present, never hidden by filters):

```
| Code | Name | Y1 Courses       | Y1h | Y2 Courses       | Y2h | Total | Actions |
|------|------|------------------|-----|------------------|-----|-------|---------|
| AP   | —    | [Math AI SL]     |  4  | [Math AI SL]     |  4  |   8   |   ⋮     |
|      |      | [Math AI HL]     |     | [Math AI HL]     |     |       |         |
| JC   | —    | [Eng B HL①][...] |  12 | [Eng B HL①]      |  6  |  18   |   ⋮     |
```

- **Columns:** Code, Name, Y1 Courses (badges), Y1 Hours, Y2 Courses (badges), Y2 Hours, Total Hours, Actions
- **Course badges** are read-only, flex-wrapped within the cell
- **Badge content:** course `name` + `level` + group-index suffix when group-index > 0 (e.g., "English B HL①", "Math AI SL"). Group-index 0 (the "none" sentinel) is omitted.
- **Hours columns** show total weekly hours for that teacher in the given cohort
- **Total column** sums across both cohorts — immediate workload visibility
- **Row height varies** based on assignment count — acceptable at current data scale (18 teachers, max ~5 courses per cohort)

### D3: Filtering — controls row visibility, not column structure

- **Text search:** matches against teacher code, full_name, and course names within assignments
- **Year filter (optional):** when active, shows only teachers who have ≥1 course in the selected cohort; both Y1/Y2 columns remain visible (structural, never hidden)
- **Filter hook** uses a predicate pipeline (`TeacherFilter[]`) extensible for future predicates (e.g., "missing availability rules")

### D4: Assignment display — read-only, assignment authored on `/courses`

Assignments (`courses.teacher_id`) are shown as read-only badge lists in the table. The course form on `/courses` remains the single entry point for assigning teachers. No dual-write complexity on this page.

**Loader joins courses** to assemble `TeacherRow.assignments: CourseAssignment[]` — acceptable coupling (same pattern as courses loader joining teachers for display labels).

### D5: `full_name` — optional in form (match DB nullability)

`code` is the primary identifier (short, unique, used mentally by authors). `full_name` is optional. Display format: `code` in its own column, `full_name` in a separate column (null → em dash or empty). The courses `TeacherFilter` label continues to use `full_name ?? code`.

### D6: Delete — confirm with assignment impact count

Deletion is allowed but requires confirmation showing cascade impact: "This teacher is assigned to N courses. Deleting will remove their assignment." Consistent with `DeleteCourseDialog` pattern.

### D7: Code uniqueness — submit-time conflict only

Duplicate `code` is caught on form submit via `UNIQUE_VIOLATION` → `DomainError("CONFLICT", ...)` → field error on `code`. No eager blur-time uniqueness check (consistent with courses pattern).

## Deferred Questions (out of scope, for follow-up change)

### Q-deferred-1: Teacher availability table shape

Deferred until the availability change. Schema options (exclusion grid, named rules) remain open. The teacher view-model leaves room for a future `availabilityRules?: ...` field.

### Q-deferred-2: Drop UX policy (PRD Q8) for validator extension

S-01 settled "accept-and-flag" for student collisions. Extension to teacher collision classes is deferred; Q8 resolution applies when that change is planned.

### Q-deferred-3: Named collision class UX

Splitting the generic collision badge into per-class indicators (student, teacher, availability) is a `plan-detail` UI concern, deferred to the validator-extension change.

## Architecture Insights

1. **Pattern replication is straightforward** — courses slice is a complete, well-documented template. No architectural novelty needed for basic teacher CRUD.
2. **Availability is the only new schema work** — everything else uses existing tables and patterns.
3. **Validator extension is a separate concern** from CRUD — it lives in `plan-detail`, touches collision detection, and has a UX dependency (Q8). Clean separation argues for splitting the change.
4. **The `code` field uniqueness** means duplicate detection mirrors `courses` (`UNIQUE_VIOLATION` → conflict error pattern).

## Historical Context

- `context/changes/course-catalog/plan.md` — full implementation template (4 phases: schema→loader→CRUD→refinement)
- `context/changes/minimal-domain-schema/plan.md` — decided against `teacher_assignments` junction; availability deferred
- `context/changes/first-valid-drop-with-validation/plan.md` — resolved Q8 as "accept-and-flag" for S-01; teacher collision detected but not named
- `context/foundation/lessons.md` — "Astro Actions are the single transport", "semantic tokens only", "port mechanism not legacy shape"

## Code References

- `src/_pages/courses/` — full reference implementation (39 files)
- `src/_pages/courses/model/schemas.ts` — Zod schema pattern (shared action + form)
- `src/_pages/courses/api/loader.ts:25` — teachers loaded as `TeacherOption[]`
- `src/_pages/courses/api/actions.ts` — action composition pattern
- `src/_pages/courses/api/course-client.ts` — typed client wrapper
- `src/_pages/courses/ui/CourseCatalog.tsx` — orchestrator pattern
- `src/_pages/plan-detail/model/collision.ts:3-13` — current teacher collision detection
- `src/shared/api/database.types.ts:421-444` — generated teacher types
- `supabase/migrations/20260602185012_minimal_domain_schema.sql` — teachers table DDL
- `src/pages/teachers.astro` — placeholder page ("coming in S-03")
- `src/shared/config/nav.ts:14` — `/teachers` already in navigation

## Related Research

- `context/changes/course-catalog/research.md` — sibling catalog research (patterns, conventions)
