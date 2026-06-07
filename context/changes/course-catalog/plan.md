# Course Catalog (S-02) Implementation Plan

## Overview

Expand the `/courses` stub into the project's **first form-CRUD feature**: a cross-cohort course catalog presented as **Year 1 / Year 2 tabs** with a **teacher multi-select filter**, supporting **atomic course create/edit/delete** and **overlap (dependency) authoring**. This is built on the convention decided in research — **Astro Actions + Zod 4 + react-hook-form + shadcn `<Table>`/`<Dialog>`** — with the Zod schema shared between the action (server gate) and the form resolver. The change is **zero-migration**: the schema S-02 needs already shipped in F-02.

Merge data (composite-level parent rows + `course_merges` links) already exists in the seed. The **merge builder is deferred** to a follow-up slice; this slice must only **coexist** with merge data by rendering merge-involved courses read-only.

## Current State Analysis

- **`courses.astro` is a 10-line stub** (`src/pages/courses.astro:1-10`) wrapping `AppShellLayout title="Courses"`. S-02 expands this — not a greenfield page. The route, nav entry (`src/lib/nav.ts:13`), auth gate, and theming already exist.
- **Read pattern to mirror**: `src/pages/plans/index.astro:6-18` — local row view-model, `createClient(headers, cookies)`, a typed fetch helper that throws, and `null → 503` / `[] → empty` discriminated render, all token-based.
- **Schema is in place** (`supabase/migrations/20260602185012_minimal_domain_schema.sql`): `courses(cohort_id, teacher_id, name, level text, group_index smallint default 0, hours_per_week smallint)` with `unique (cohort_id, name, level, group_index)` and `check (hours_per_week >= 0)`; `course_overlaps(base_course_id, dependent_course_id)` unique pair; `course_merges(parent_course_id, child_course_id)` unique pair. **No DB enums.**
- **Cohorts are flat and seed-only**: two rows, `'Diploma Programme Year 1'` / `'Diploma Programme Year 2'` (`scripts/gen-seed.mjs:268-271`), with no pairing field. There is **no `school_years` entity** (Follow-up 2 decision: not justified by the single-snapshot PRD).
- **Deps absent**: `zod`, `react-hook-form`, `@hookform/resolvers` are not in `package.json`. `src/actions/` and `src/lib/schemas/` do not exist. shadcn surface = `button`, `select`, `badge` only.
- **Astro Actions are viable on workerd**: `src/lib/supabase.ts:6` `createClient(request.headers, cookies)` works inside an Action context; Vitest is wired (`pnpm test`).

### Key Discoveries:

- **Actions bypass the auth redirect.** `src/middleware.ts:8-11` exempts `/_` prefixes, and Astro Actions POST to `/_actions/*`. So the middleware redirect does **not** gate action endpoints — **every action handler must guard on `context.locals.user`** and reject when absent. (Middleware still populates `locals.user` from cookies on every request, including action calls, so the guard is a simple null check.)
- **React-dedup config exists.** `astro.config.mjs:19-31` pre-bundles `react`/`react-dom` for the SSR environment to avoid the dual-React "Invalid hook call" (the documented dev lesson). Adding `react-hook-form` (a client island dep) is expected to be fine; **if** a dev re-optimize flare appears, the fix is adding `react-hook-form` + `@hookform/resolvers` to the **client** `optimizeDeps.include` in that plugin.
- **`level` is permissive text by design** — composite values (`AB+SL`, …) are legitimate merge parents. The `{SL,HL,AB,none}` enum lives **only** in the app-layer Zod on the atomic-course form; **no DB CHECK/enum** (`context/foundation/lessons.md`, research Decision 2).
- **Domain projection (lessons rule #1)** and **semantic tokens only (lessons rule #2)** both apply: project DB rows to view-models; never copy `auth/FormField.tsx`'s hardcoded colors.

## Desired End State

Signing in and visiting `/courses` shows, within the app shell:

- **Two tabs, "Year 1" and "Year 2"** — selecting a tab shows that cohort's courses in a shadcn `<Table>`; the other is hidden. Year 1 is the default tab.
- A **teacher multi-select filter** that narrows the visible rows to courses taught by any selected teacher(s); empty selection shows all.
- A **"New course"** action opening a dialog (name, level, IB-group, weekly hours, required cohort, **required teacher**); on save the row appears in the right tab.
- Per-row **edit** and **delete** (delete confirms and names the cascade). Atomic courses round-trip; **merge-involved courses are tagged "Merged" and have no edit/delete/overlap affordance**.
- Per-course **overlap authoring**: link a base course (this course's students also attend the base) and unlink it; self-links and duplicates are rejected.

Verification: `pnpm test` (schema units) + `pnpm build` pass; the flows above work manually against the local Supabase stack; no theme-token regressions; merge-parent rows render but cannot be mutated.

## What We're NOT Doing

- **No merge builder / merge authoring** — merges are read-only this slice (deferred; the merge data model invariant re: hours/direction is unsettled and gets its own slice).
- **No `school_years` entity** and no cohort CRUD — cohorts stay seed-only (Follow-up 2, Option A). **Side note for the future cohort-CRUD slice:** cohort *order* is semantically meaningful (planning proceeds Year 1 → Year 2, and the author may have an ordering preference), so this slice's naive `order by name` (first = Year 1) is a stand-in. When cohort CRUD is designed, replace it with deliberate sequencing — an explicit ordinal/sequence column or other logic — rather than relying on alphabetical name sort (also retires the `load.ts:34` `.order("name").limit(1)` hack).
- **No teacher CRUD** — teachers are seed-only here; the form only *selects* from existing teachers (S-03 owns teacher management).
- **No migration** — zero schema change.
- **No retrofit of S-01's API routes** (`placements.ts`/`grouping.ts` stay as the realtime hot path — lessons "two mutation styles").
- **No student-choice or grouping UI** — out of this slice.
- **No "All cohorts" union tab** — the two tabs cover the school-year view per the chosen design. **Conscious deviation from research Follow-up 2 / Decision 2** (which leaned to a cross-cohort union default): the app serves a single school year with exactly two cohorts, so Year 1 / Year 2 tabs are sufficient now; an "All" union view is deferred until a multi-year / school-year-spanning model is actually needed.

## Implementation Approach

Build foundation-first: deps + shared Zod schemas + the Action layer with auth guards and unit tests (Phase 1), then the read-only list with tabs and the teacher filter (Phase 2), then wire mutations through dialogs (Phase 3), then overlaps (Phase 4). Each phase is independently reviewable and has its own automated gate. The page stays server-rendered (`courses.astro` loads data, projects to view-models) and mounts a single `CourseCatalog` island (`client:load`) that owns tab/filter/dialog state; mutations call `astro:actions` and trigger a `navigate(currentPath)` refresh to re-run the server load. **Note:** no `<ClientRouter />` is mounted in the app (and `output: "server"`), so `navigate()` performs a full-page navigation, not an SPA soft transition — this is fine (the server load re-runs); do **not** add `<ClientRouter />` solely to make it a soft refresh.

### UI component map

Every new UI element maps to a shadcn primitive (all token-based — lessons rule #2). `select`, `button`, `badge` already exist; the rest are added in Phase 1.

| UI element | Component(s) |
| --- | --- |
| Year 1 / Year 2 tabs | `tabs` |
| Course list (≤~60 rows/tab) | `table` (plain primitive — **no pagination, no virtualization**) |
| Teacher filter (multi-select) | `popover` + `command` (searchable checklist) + `badge` chips; fallback: `dropdown-menu` + checkbox items |
| "Merged" tag | `badge` |
| Per-row actions (atomic rows) | `dropdown-menu` kebab → Edit / Manage overlaps / Delete; **merged rows render no menu** |
| Create / edit form | `dialog` + `form` + `input` + `label` + `select` |
| Weekly hours | `input type=number` |
| Delete confirm | `alert-dialog` |
| "New course" + triggers | `button` |
| Success feedback | `sonner` (`<Toaster>` mounted once) |
| Overlap authoring (Phase 4) | `dialog` + `command`/`select` + `badge` |

**Sorting & pagination (decided):** rows render in a **fixed default order — `group_index` then `name`** (applied in the server query). **No interactive column sorting and no pagination** this slice — at the PRD's ~30–60 courses/cohort (`prd.md:128`) a plain scrollable `<Table>` suffices; interactive sort is the main thing that would justify the TanStack data-table and is deferred.

## Critical Implementation Details

- **Action auth guard**: because `/_actions/*` is in the middleware public prefix, each `defineAction` handler must read `context.locals.user` and throw an `ActionError({ code: "UNAUTHORIZED" })` when null before touching Supabase. Do not rely on the redirect.
- **Unique-violation mapping**: `courses_unique (cohort_id, name, level, group_index)` and the `course_overlaps` unique pair surface as Postgres `23505`. Actions must catch it and return a field-level input error (e.g. "A course with this name/level/group already exists in this cohort"), mirroring the idempotent-`23505` handling in `src/pages/api/placements.ts:39-51` (here it is a user error, not idempotent success).
- **Merge coexistence**: server-load `course_merges` once, build a `Set<string>` of every id appearing as `parent_course_id` or `child_course_id`, and mark each course view-model `isMerged`. The Action `updateCourse`/`deleteCourse`/`createOverlap` handlers must also reject when the target id is in that set (defense in depth — the UI hides the affordance, the action enforces it).

## Phase 1: Foundation — dependencies, schemas, Action layer

### Overview

Install the CRUD stack, scaffold the shadcn primitives, define the shared Zod schemas, and implement the Astro Actions with auth guards and error mapping. No user-visible UI yet; this phase is gated entirely by build + types + unit tests.

### Changes Required:

#### 1. Dependencies

**File**: `package.json` (+ `pnpm-lock.yaml`)

**Intent**: Add the form-CRUD runtime stack pinned to the Zod-4-aligned versions from research, so `astro/zod` and our schemas share one Zod 4 copy.

**Contract**: Add direct deps `zod@^4.4.3`, `react-hook-form@^7.77`, `@hookform/resolvers@^5.4`. After install, verify a single runtime Zod with `pnpm why zod` (the stray `zod@3.25.76` must remain dev-only via `eslint-plugin-react-compiler`). Do **not** pin `zod@^3` or `@hookform/resolvers@^3`.

#### 2. shadcn primitives

**File**: `src/components/ui/*` (via shadcn CLI)

**Intent**: Add the UI primitives the catalog needs; they are token-based (new-york + Tailwind v4) and satisfy lessons rule #2 out of the box.

**Contract**: Add `input`, `label`, `form`, `dialog`, `alert-dialog`, `table`, `tabs`, `popover`, `command`, `dropdown-menu`, `sonner`. (`select`, `button`, `badge` already exist.) Use the project's shadcn invocation (`components.json` is configured). `popover` + `command` compose the teacher multi-select; `dropdown-menu` is the per-row kebab actions menu; `sonner` provides success toasts (mount its `<Toaster>` once in the island).

#### 3. Shared Zod schemas

**File**: `src/lib/schemas/course.ts` (new)

**Intent**: Single source of truth for validation, imported by both the actions (`input`) and the RHF resolver. Encodes the app-layer enums that are deliberately absent from the DB.

**Contract**: Export `courseInput` and `overlapInput` (import `z` from `zod`).
- `courseInput`: `name` (non-empty, trimmed), `level` enum `["SL","HL","AB","none"]`, `groupIndex` enum `[0,1,2]` (0 = none sentinel), `hoursPerWeek` int `>= 1` (0 is the merge-child sentinel, not authorable here), `cohortId` uuid, **`teacherId` required uuid** — a course must have a teacher (an app-layer rule, deliberately stricter than the nullable `courses.teacher_id` DB column, same pattern as the `level` enum). Export an `updateCourseInput` = `courseInput` + `id` uuid.
- `overlapInput`: `baseCourseId` uuid, `dependentCourseId` uuid, refined so the two differ (self-link rejected). Export inferred types via `z.infer`.

#### 4. Action layer

**File**: `src/actions/index.ts` (new)

**Intent**: Server mutation gate for the catalog. Provides typed client + Zod validation + field errors for free, replacing what S-01 hand-rolls.

**Contract**: Export `server = { createCourse, updateCourse, deleteCourse, createOverlap, deleteOverlap }` via `defineAction({ input, handler })`. Every handler: (1) guard `context.locals.user` → `ActionError UNAUTHORIZED` if null; (2) `createClient(context.request.headers, context.cookies)` → `ActionError` if null (Supabase unconfigured); (3) for `updateCourse`/`deleteCourse`/`createOverlap`, reject if a referenced course id is merge-involved; (4) map `23505` to an input/field error; (5) return the affected row(s) or `{ ok: true }`. `createOverlap` additionally validates both courses share a cohort.

#### 5. Schema unit tests

**File**: `src/lib/schemas/course.test.ts` (new)

**Intent**: Lock the validation contract (the enums, the hours floor, the self-link refinement) with Vitest — the pure, DB-free logic worth testing.

**Contract**: Cover: valid atomic course passes; invalid `level`/`groupIndex` rejected; `hoursPerWeek = 0` and negatives rejected; **missing/empty `teacherId` rejected**; `overlapInput` rejects equal base/dependent and accepts a valid directed pair.

### Success Criteria:

#### Automated Verification:

- Dependencies install: `pnpm install`
- Single runtime Zod: `pnpm why zod` shows one 4.x reaching the app
- Type checking passes: `pnpm exec astro sync && pnpm exec astro check`
- Schema unit tests pass: `pnpm test`
- Linting passes: `pnpm lint`
- Production build passes: `pnpm build`

#### Manual Verification:

- `astro:actions` import resolves and the five actions are typed end-to-end in an editor.
- No dev-server "Invalid hook call" regression after adding RHF (watch the dedup note).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Read path — cohort tabs + course list

### Overview

Expand `courses.astro` to server-load both cohorts, all courses, teachers, and merge-involved ids; project to view-models; mount the `CourseCatalog` island rendering Year 1 / Year 2 tabs, a table per tab, "Merged" read-only tagging, and the teacher multi-select filter. Display only — no mutations.

### Changes Required:

#### 1. Server load + view-models

**File**: `src/pages/courses.astro`

**Intent**: Load the catalog data once on the server and hand the island a typed, projected payload, following the `plans/index.astro` discriminated-state pattern.

**Contract**: Build `createClient(Astro.request.headers, Astro.cookies)`; fetch cohorts (`id, name` ordered by name → map to `{ id, label: "Year 1"|"Year 2" }`; first = Year 1, second = Year 2 — naive but stable for the two seed names), courses (`id, cohort_id, name, level, group_index, hours_per_week, teacher_id`), teachers (`id, code, full_name`), and `course_merges` (`parent_course_id, child_course_id`). Project to `CourseRow = { id, cohortId, name, level, groupIndex, hours, teacherId, teacherLabel, isMerged }` and `TeacherOption = { id, label }`. `null` (Supabase down) → `Astro.response.status = 503` + message; `[]` cohorts/courses → empty state. Mount `<CourseCatalog ... client:load />`.

#### 2. Catalog island

**File**: `src/components/courses/CourseCatalog.tsx` (new)

**Intent**: Own the tab, filter, and (later) dialog state; render the cross-cohort list as tabs with the teacher filter.

**Contract**: Props = `{ cohorts: {id,label}[]; courses: CourseRow[]; teachers: TeacherOption[] }`. A header row holds the title and a top-right "New course" `<Button>` (opens the create dialog — wired in Phase 3) and the teacher multi-select filter. shadcn `<Tabs>` keyed by cohort id (default first / Year 1); per tab a plain `<Table>` of that cohort's courses (columns: Name, Level, Group, Hours, Teacher, Actions), rows in the server's fixed order (`group_index`, then `name`), **no pagination**. Atomic rows' Actions cell is a `dropdown-menu` kebab (Edit / Manage overlaps / Delete — handlers wired in Phases 3–4); merge-involved rows show a `<Badge>"Merged"` and **render no kebab**. The teacher multi-select (`popover` + `command`) filters visible rows to any selected teacher; empty = all. `.tsx` only because it renders JSX (lessons). Tokens only.

#### 3. Filter hook (optional split)

**File**: `src/components/courses/useCourseFilters.ts` (new, `.ts`)

**Intent**: Keep filtering logic pure and testable, separate from the view.

**Contract**: `(courses, activeCohortId, selectedTeacherIds) => CourseRow[]`. No mutation of inputs (functional clean-code preference).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Build passes: `pnpm build`
- Existing tests still pass: `pnpm test`

#### Manual Verification:

- `/courses` lists seeded courses; Year 1 / Year 2 tabs switch the visible list.
- The teacher filter narrows rows; clearing it restores all.
- Merge-parent rows (composite levels like `AB+SL`) appear tagged "Merged" with no edit/delete.
- Supabase-down → 503 message; empty cohort → empty state. No hardcoded colors.

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Mutations — create / edit / delete atomic courses

### Overview

Wire the create/edit dialog (RHF + `zodResolver`) and the delete confirmation through the Phase 1 actions, with field-error mapping, success toasts, and a post-mutation refresh.

### Changes Required:

#### 1. Course form dialog

**File**: `src/components/courses/CourseFormDialog.tsx` (new)

**Intent**: Create and edit atomic courses with the shared schema driving both client validation and the server gate.

**Contract**: RHF `useForm` with `zodResolver(courseInput)` and **`mode: "onTouched"`** — each field validates against the shared Zod schema when the user first blurs it, then re-validates live as they type (RHF's default `reValidateMode: "onChange"`); no validation noise before a field is touched. This is the catalog CRUD convention's validation UX, inherited by S-03/S-04/S-05. shadcn `<Form>` fields — name (`input`), level (`select`), group (`select`: None/Group 1/Group 2), hours (`input type=number`), cohort (`select`, required; defaults to the active tab's cohort on create), teacher (`select`, **required**, from `teachers`). Submit calls `actions.createCourse` / `actions.updateCourse`; on `isInputError(error)` map fields via `form.setError`; on success show a `sonner` toast, close, and `navigate(currentPath)` (`astro:transitions/client`) to refresh the server load. Reused for edit by seeding `defaultValues` from the row. **Because teacher is required and teacher CRUD lands in S-03, at least one seeded teacher must exist to create a course — an empty `teachers` table blocks creation by design** (the seed provides teachers; surface a clear empty-state hint if none).

#### 2. Delete confirmation

**File**: `src/components/courses/CourseCatalog.tsx` (extend) + `DeleteCourseDialog` (inline or new)

**Intent**: Prevent accidental destructive deletes given the FK cascade.

**Contract**: shadcn `<AlertDialog>` naming the cascade (placements, student choices, overlaps, groupings referencing the course are removed). Confirm calls `actions.deleteCourse`; toast + refresh on success. No delete control on merge-involved rows.

#### 3. Wire actions into the island

**File**: `src/components/courses/CourseCatalog.tsx`

**Intent**: Wire the Phase 2 header button and per-row kebab to the dialogs (atomic rows only).

**Contract**: The header "New course" button opens `CourseFormDialog` in create mode with the **active tab's cohort prefilled** (still editable). Each atomic row's kebab `dropdown-menu` Edit item opens the dialog in edit mode (seeded from the row); the Delete item opens the `AlertDialog`. Mount `<Toaster />` once.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Build passes: `pnpm build`
- Tests pass: `pnpm test`

#### Manual Verification:

- Create a course → appears in the correct cohort tab.
- Edit a course → changes persist after refresh.
- Duplicate `(name, level, group)` in a cohort → friendly field error, no crash.
- Delete → confirm dialog names the cascade; row disappears.
- Invalid input (empty name, hours 0/negative, missing level, **no teacher selected**) → inline field errors; nothing sent.
- Merge rows remain non-editable; an action call against one (if forced) is rejected server-side.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Overlaps authoring

### Overview

Let the author declare and remove the directed overlap relation (a course's students also attend a base course) between courses in the same cohort, via the Phase 1 overlap actions.

### Changes Required:

#### 1. Overlap management UI

**File**: `src/components/courses/CourseOverlaps.tsx` (new) + integration into `CourseCatalog.tsx`

**Intent**: Author the `course_overlaps` directed pair from the catalog without leaving the page.

**Contract**: The row kebab's **"Manage overlaps"** item opens a `<Dialog>` for that atomic course showing its existing base-course overlaps and an "Add overlap" control that picks a base course from the **same cohort** (excluding self and merge-involved courses). Add → `actions.createOverlap`; remove → `actions.deleteOverlap`; self-link and duplicates rejected (Zod refinement + DB unique → mapped error). Toast + refresh on success.

#### 2. Server load extension

**File**: `src/pages/courses.astro`

**Intent**: Provide existing overlaps to the island for display.

**Contract**: Fetch `course_overlaps (base_course_id, dependent_course_id)`; project per dependent course into the `CourseRow` view-model (e.g. `overlaps: {baseCourseId}[]`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- Build passes: `pnpm build`
- Tests pass: `pnpm test`

#### Manual Verification:

- Add an overlap between two Year 1 courses → shows on the dependent course.
- Attempt a self-overlap → blocked with a clear message.
- Attempt a duplicate overlap → blocked (no duplicate row).
- Remove an overlap → it disappears after refresh.
- Merge-involved and cross-cohort courses are not offered as overlap targets.

**Implementation Note**: Final phase — confirm the full catalog flow end-to-end.

---

## Testing Strategy

### Unit Tests (Vitest, pure/no-DB):

- `src/lib/schemas/course.test.ts` — enums, hours floor, optional teacher, overlap self-link refinement (Phase 1).
- `useCourseFilters` — cohort + teacher-multiselect filtering, input immutability (Phase 2), if extracted.

### Integration Tests:

- Out of scope for this slice (Action/DB integration is exercised manually against the local stack). Note left for a later testing-gate slice.

### Manual Testing Steps:

1. `pnpm env:local` + local Supabase running + `pnpm dev`; sign in; open `/courses`.
2. Switch Year 1 / Year 2 tabs; apply and clear the teacher filter.
3. Create, edit, delete an atomic course; force a duplicate and an empty-name to see validation.
4. Confirm a merge-parent (e.g. `AB+SL`) is tagged and non-editable.
5. Add, duplicate-attempt, self-attempt, and remove an overlap.
6. Stop Supabase → reload `/courses` → 503 message.

## Performance Considerations

Catalog volume is small (~30–60 courses/cohort per NFR). Single server-side load per page view; filtering and tab-switching are client-side over an in-memory array. Rows use a fixed server order (`group_index`, `name`) with **no pagination, virtualization, or interactive sort** — unjustified at this volume and the trigger for the heavier TanStack data-table (see UI component map). No <200ms drag-drop budget applies here (that is the planner's hot path). `.limit()` the course/teacher fetches defensively (e.g. 500) following `plans/index.astro`.

## Migration Notes

None — zero schema change. The slice operates entirely on F-02's existing tables.

## References

- Research (incl. CRUD convention, pinned deps, merge model, Option A): `context/changes/course-catalog/research.md`
- Lessons: two-mutation-styles + semantic-tokens + domain-projection — `context/foundation/lessons.md`
- Read pattern: `src/pages/plans/index.astro:6-18`
- Island mount precedent: `src/pages/plans/[id].astro:35`
- Schema: `supabase/migrations/20260602185012_minimal_domain_schema.sql:28-66`
- Action context / per-request client: `src/lib/supabase.ts:6-25`; middleware `/_` exemption: `src/middleware.ts:8-21`
- React dedup plugin: `astro.config.mjs:19-31`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundation — dependencies, schemas, Action layer

#### Automated

- [ ] 1.1 Dependencies install: `pnpm install`
- [ ] 1.2 Single runtime Zod: `pnpm why zod` shows one 4.x reaching the app
- [ ] 1.3 Type checking passes: `pnpm exec astro sync && pnpm exec astro check`
- [ ] 1.4 Schema unit tests pass: `pnpm test`
- [ ] 1.5 Linting passes: `pnpm lint`
- [ ] 1.6 Production build passes: `pnpm build`

#### Manual

- [ ] 1.7 `astro:actions` import resolves and the five actions are typed end-to-end
- [ ] 1.8 No dev-server "Invalid hook call" regression after adding RHF

### Phase 2: Read path — cohort tabs + course list

#### Automated

- [ ] 2.1 Type checking passes: `pnpm exec astro check`
- [ ] 2.2 Linting passes: `pnpm lint`
- [ ] 2.3 Build passes: `pnpm build`
- [ ] 2.4 Existing tests still pass: `pnpm test`

#### Manual

- [ ] 2.5 `/courses` lists seeded courses; Year 1 / Year 2 tabs switch the list
- [ ] 2.6 Teacher filter narrows rows; clearing restores all
- [ ] 2.7 Merge-parent rows tagged "Merged" with no edit/delete
- [ ] 2.8 Supabase-down → 503; empty cohort → empty state; no hardcoded colors

### Phase 3: Mutations — create / edit / delete atomic courses

#### Automated

- [ ] 3.1 Type checking passes: `pnpm exec astro check`
- [ ] 3.2 Linting passes: `pnpm lint`
- [ ] 3.3 Build passes: `pnpm build`
- [ ] 3.4 Tests pass: `pnpm test`

#### Manual

- [ ] 3.5 Create a course → appears in the correct cohort tab
- [ ] 3.6 Edit a course → changes persist after refresh
- [ ] 3.7 Duplicate `(name, level, group)` → friendly field error, no crash
- [ ] 3.8 Delete → confirm dialog names cascade; row disappears
- [ ] 3.9 Invalid input (incl. no teacher selected) → inline field errors; nothing sent
- [ ] 3.10 Merge rows non-editable; forced action against one is rejected server-side

### Phase 4: Overlaps authoring

#### Automated

- [ ] 4.1 Type checking passes: `pnpm exec astro check`
- [ ] 4.2 Linting passes: `pnpm lint`
- [ ] 4.3 Build passes: `pnpm build`
- [ ] 4.4 Tests pass: `pnpm test`

#### Manual

- [ ] 4.5 Add an overlap between two same-cohort courses → shows on the dependent
- [ ] 4.6 Self-overlap attempt blocked with a clear message
- [ ] 4.7 Duplicate overlap attempt blocked (no duplicate row)
- [ ] 4.8 Remove an overlap → disappears after refresh
- [ ] 4.9 Merge-involved and cross-cohort courses not offered as overlap targets
