# Co-teaching Teacher Sets Implementation Plan

## Overview

Today a course holds exactly one nullable `teacher_id`. This change makes a course **co-taught by a set of equal teachers**. Validation treats the whole set: every co-teacher must be available in a slot, and each co-teacher is checked for double-booking. The work is largely "make the teacher field look like the student field" — the constraint core already models `studentKeys: string[]` next to the scalar `teacherKey`, so the hardest layers become near-copies of proven student machinery. Persistence moves to a pure `course_teachers` junction (the `courses.teacher_id` column is dropped), authorship moves to a multi-select, and a delete-guard protects the app-enforced "≥1 teacher per course" invariant.

The phases are sequenced **additive-first, destructive-drop-last**: the junction table is added while `courses.teacher_id` survives untouched (Phase 1), all read/write/UI paths switch to the junction (Phases 2–5), and only then is the now-unused column dropped (Phase 6). This keeps every phase ending on a green build/test gate.

## Current State Analysis

- **Persistence.** `courses.teacher_id` is a single nullable composite FK `(plan_id, teacher_id) → teachers(plan_id, id) on delete set null`, plus index `courses_plan_teacher_idx` (`supabase/migrations/20260612090000_courses_teacher_composite_fk.sql:10-20`). That migration exists specifically to stop a course referencing a teacher from another plan and to make `clone_plan` fail loud on a missed UUID remap.
- **Constraint core.** `GroupingCourse = { id; teacherKey: string | null; studentKeys: string[]; hours }` (`src/shared/lib/catalog-hash/types.ts:8-13`) — students are *already a set*. `teacher-conflict.ts` groups by the scalar `teacherKey` with `skipNullKeys`; `student-conflict.ts` is the existing "key-sets intersect" implementation. The combinatorial hot path (`enumerate.ts` → `collision.ts` → `violatesAny`) is field-agnostic.
- **Catalog hash.** `compute-catalog-hash.ts:16-22` serializes `teacherKey` (scalar) and a code-point–sorted `studentKeys`. A fixed-digest test (`compute-catalog-hash.test.ts:21-24`) locks the canonical shape.
- **Authorship.** Authored only on the courses page (`CourseFormDialog.tsx:171-199`, a single `<Select name="teacherId">`); teachers page is read-only reverse-lookup (`src/_pages/teachers/api/loader.ts:25-37`). Shared Zod: `teacherId: z.uuid("A teacher is required")` (`schemas.ts:44`) — app-required though the DB column is nullable.
- **Write atomicity.** Two in-repo precedents: `writeParentWithLinks` (insert parent → links → compensating delete) and the `replace_cohort_groupings` `security invoker` RPC (atomic delete-then-reinsert).
- **Merge validation.** `deriveMergeParent` (`src/_pages/courses/model/merge.ts:48-67`) requires merged children to share a single non-null teacher.
- **E2E.** `e2e/specs/` cover auth, guards, and plan create/delete (`seed.spec.ts`). **No teacher/course-authoring coverage.** Harness: real-workerd preview + authenticated `storageState`, fully parallel, `chromium` project.

## Desired End State

A course carries a set of one-or-more equal teachers, stored in a `course_teachers` junction (no `courses.teacher_id` column). On the courses page an author picks teachers via a multi-select; the table renders teacher chips. The board flags a double-booking when two co-placed courses share *any* teacher, and flags an availability warning naming *each* co-teacher who is unavailable in the placed cell. Deleting a teacher who is the sole teacher of any course is blocked and surfaces those courses; deleting one of several co-teachers just drops the link. Merging requires children to share the same teacher *set*. A fresh `supabase db reset` contains genuinely co-taught courses. A Playwright spec proves the authoring round-trip and the delete-guard end-to-end on real workerd.

**Verification of end state:** `pnpm build`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint`, `pnpm steiger` all green; `supabase db reset` loads a seed with co-taught courses; the courses/teachers/board flows behave as above when exercised manually.

### Key Discoveries:

- The student set is the proven blueprint — `studentKeys: string[]` lives next to `teacherKey` and `student-conflict.ts:21` already runs the exact set-intersection on the hot path (`src/_pages/plan-detail/model/constraints/student-conflict.ts`).
- The **<200ms drag budget is not at risk**: the teacher term (N≈1–3) is dominated by the student-roster term already in the same `violatesAny` call (`src/_pages/plan-detail/model/score.ts:12`).
- Composite-FK junction is dictated by the clone invariant — `teacher_availability` (`supabase/migrations/20260613130000_teacher_availability.sql:14-34`) is the exact table template; the `course_grouping_members` clone block is the copy target.
- `replace_cohort_groupings` (`supabase/migrations/20260604141213_replace_cohort_groupings_fn.sql:15-51`) is the `security invoker` precedent for `replace_course_teachers`.
- A multi-select primitive already exists (`src/shared/ui/multi-select.tsx`) and is already RHF-array-bound in a Dialog (`MergeBuilderDialog.tsx:78-98`).

## What We're NOT Doing

- **No lead/primary teacher** — co-teachers are fully symmetric; no `role`/`position` column on the junction.
- **No DB trigger** for the ≥1-teacher rule — it is app-enforced (Zod `.min(1)` + delete-guard + seed abort), matching the codebase's RPC/app-guard style (no trigger precedent).
- **No hard cap and no soft UI limit** on teachers per course.
- **No `uuid[]` array column** — arrays can't carry per-element FKs and silently drop bad UUIDs during clone remap (the regression `20260612090000` exists to prevent).
- **No explicit hash-recompute migration** — the hash shape change self-heals via the existing recompute-on-load/clone path; only the fixed-digest unit test is regenerated.
- **No board-level (drag-drop) E2E** — the constraint core is densely unit/integration-tested; E2E covers authoring + delete-guard only.
- **No client-side diff for `updateCourse`** — the atomic `replace_course_teachers` RPC is used instead.

## Implementation Approach

Bottom-up by data flow, keeping the build green at each phase boundary. Phase 1 lands the junction table, the two RPCs/clone block, and regenerated types **additively** (the legacy column stays, so nothing breaks). Phase 2 performs the one breaking type change (`teacherKey` → `teacherKeys[]`) together with every consumer and its tests, so the tree compiles and passes as a unit. Phases 3–4 move the write/authorship/UI and the teachers-page/delete-guard/merge knock-on. Phase 5 regenerates the seed with co-taught data. Phase 6 drops the now-dead column and the dead null-handling code. Phase 7 adds the E2E specs.

## Critical Implementation Details

- **Catalog-hash sort is code-point, not `localeCompare`.** The new `teacherKeys` array must be sorted with `[...course.teacherKeys].sort()` — mirror the existing `studentKeys` line. The fixed-digest test locks this; using `localeCompare` would silently diverge the JS hash from its locked digest. The shape change invalidates all persisted `catalog_hash` values once; this self-heals (the clone flow and out-of-date detection recompute JS-side). Regenerate the fixed-digest fixture in the same commit.
- **Deterministic seed.** `gen-seed.mjs` / `catalog-transcode.mjs` rely on a fixed `randomUUID()` call order to keep `seed.sql` byte-identical across runs (documented at `gen-seed.mjs:8-13`). Insert the new junction-row UUID generation at a fixed point in the canonical emission order.
- **Drop-last ordering is load-bearing.** `courses.teacher_id` must remain until every read and write path sources teachers from the junction (end of Phase 5). Dropping it earlier turns the build red.
- **`replace_course_teachers` must be `security invoker`** (not `definer`) so the `authenticated` RLS policy on `course_teachers` still gates the write — exactly as `replace_cohort_groupings` documents.
- **The column DROP deviates from the additive-migration guideline.** Acceptable pre-prod (no production data; precedent: the destructive re-baseline `20260611180006`). Noted so it isn't flagged as an accident in review.

---

## Phase 1: Persistence Foundation (DB)

### Overview

Add the `course_teachers` junction, the `replace_course_teachers` RPC, and the `clone_plan` junction-copy block — all additive. Keep `courses.teacher_id` untouched so the build stays green. Regenerate database types.

### Changes Required:

#### 1. `course_teachers` junction table

**File**: `supabase/migrations/<new>_course_teachers.sql`

**Intent**: Create the single source of a course's teacher set, mirroring the `teacher_availability` plan-scoped child-table template so cloning stays fail-loud.

**Contract**: Surrogate `id uuid pk`; `plan_id uuid not null references plans(id) on delete cascade`; `course_id`, `teacher_id`; composite FKs `(plan_id, course_id) → courses(plan_id, id) on delete cascade` and `(plan_id, teacher_id) → teachers(plan_id, id) on delete cascade`; `unique (plan_id, course_id, teacher_id)`; indexes on `(plan_id)` and `(plan_id, course_id)`; `enable row level security` + the standard `for all to authenticated using (true) with check (true)` policy. Template: `supabase/migrations/20260613130000_teacher_availability.sql:14-34`.

**anon GRANT-layer (do not trust the default blindly).** The intent is that `anon` is excluded at the GRANT layer via the existing `alter default privileges … revoke … from anon` rule (`20260617205628`). But per `lessons.md` ("granting a role is not excluding the others"), a *non-grant is not an exclusion* — Supabase auto-grants `anon`, and that incident was verified live. `course_teachers` is the **first new table created after** the `20260617205628` revoke, so the default-privileges path is unexercised here. Therefore: append an explicit `revoke select, insert, update, delete on course_teachers from anon;` in this migration (belt-and-suspenders, same transaction) **and** prove the posture by `has_table_privilege` query, not by reading the policy (see manual check 1.6).

#### 2. `replace_course_teachers` RPC

**File**: `supabase/migrations/<new>_replace_course_teachers_fn.sql`

**Intent**: Atomic delete-then-reinsert of a course's junction rows in one transaction, for `updateCourse`. Avoids the "client delete succeeds, reinsert fails, course now has zero teachers" hazard that `writeParentWithLinks` only covers on create.

**Contract**: `replace_course_teachers(p_plan_id uuid, p_course_id uuid, p_teacher_ids jsonb) returns void`, `language plpgsql`, `security invoker`, `set search_path = ''`. Delete the course's `course_teachers` rows for `(p_plan_id, p_course_id)`, then insert one row per id in `jsonb_array_elements_text(p_teacher_ids)`. Template: `supabase/migrations/20260604141213_replace_cohort_groupings_fn.sql:15-51`.

#### 3. `clone_plan` junction copy

**File**: `supabase/migrations/<new>_clone_plan_with_course_teachers.sql`

**Intent**: Extend the clone RPC to copy `course_teachers`, double-remapping through the existing `_course_map` and `_teacher_map` temp tables, so a cloned plan carries its teacher sets and a stale UUID fails loud.

**Contract**: A full `create or replace function clone_plan(...)` that copies the entire prior body verbatim (same signature, `security invoker`, `set search_path = ''`) and adds one new insert block — like the 4 prior clone migrations. Place the block **after the courses insert** (so `_course_map`/`_teacher_map` are populated) and **before the temp-map drops**. The new block (copy of the `course_grouping_members` block) `INNER JOIN`-s both maps:
```sql
insert into public.course_teachers (plan_id, course_id, teacher_id)
select v_new_plan_id, cm.new_id, tm.new_id
  from public.course_teachers ct
  join pg_temp._course_map  cm on cm.old_id = ct.course_id
  join pg_temp._teacher_map tm on tm.old_id = ct.teacher_id
 where ct.plan_id = p_source_plan_id;
```
Source clone RPC: `supabase/migrations/20260613130001_clone_plan_with_teacher_availability.sql`.

#### 4. Regenerate database types

**File**: `src/shared/api/database.types.ts`

**Intent**: Regenerate so `course_teachers` (table + relationships) and the new RPC are typed; `courses.teacher_id` stays present this phase.

**Contract**: `database.types.ts` includes a `course_teachers` `Row`/`Insert`/`Update` + the `(plan_id, course_id)` / `(plan_id, teacher_id)` relationships and the `replace_course_teachers` function signature.

### Success Criteria:

#### Automated Verification:

- [ ] `supabase db reset` applies all migrations cleanly
- [ ] `database.types.ts` regenerated and includes `course_teachers` + `replace_course_teachers`
- [ ] Existing integration suite passes with no regression: `pnpm test:integration`
- [ ] Lint + structure pass: `pnpm lint` && `pnpm steiger`
- [ ] Build stays clean: `pnpm build`

#### Manual Verification:

- [ ] `course_teachers` exists with RLS enabled; **GRANT-layer exclusion proven by query, not by reading**: `select has_table_privilege('anon','public.course_teachers','insert')` returns `false` AND `select has_table_privilege('authenticated','public.course_teachers','insert')` returns `true`; `replace_course_teachers` is callable

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual check before Phase 2.

---

## Phase 2: Constraint Core + Board Read Path + Catalog Hash

### Overview

The one breaking type change — `teacherKey: string | null` → `teacherKeys: string[]` — landed together with every consumer, the board read path (now sourced from the junction), the hash, the factory, and all affected unit/integration tests, so the tree compiles and passes as a unit.

### Changes Required:

#### 1. `GroupingCourse` type

**File**: `src/shared/lib/catalog-hash/types.ts`

**Intent**: Replace the scalar teacher key with a set, symmetric with `studentKeys`.

**Contract**: `teacherKey: string | null` → `teacherKeys: string[]` (line 10). `ComputeWarning.kind` keeps `"no-teacher"` (now meaning empty set; defensive).

#### 2. Catalog hash

**File**: `src/shared/lib/catalog-hash/compute-catalog-hash.ts`

**Intent**: Serialize a code-point–sorted `teacherKeys` array, mirroring `studentKeys`.

**Contract**: Line 18 `teacherKey: course.teacherKey` → `teacherKeys: [...course.teacherKeys].sort()`. Code-point `.sort()`, not `localeCompare`. Regenerate the locked digest in `compute-catalog-hash.test.ts:21-24`.

#### 3. `teacher-conflict` → set intersection

**File**: `src/_pages/plan-detail/model/constraints/teacher-conflict.ts`

**Intent**: Become a near-copy of `student-conflict` — courses conflict if their teacher sets intersect; empty set = no conflict (the null guard disappears).

**Contract**: `test` → `others.some((item) => item.teacherKeys.some((t) => course.teacherKeys.includes(t)))`. `explain` emits one violation per shared teacher (still `kind: "teacher"`, single `teacherKey` per violation, so the render path is unchanged). Reference shape: `student-conflict.ts:10-25`.

#### 4. Teacher availability fan-out

**File**: `src/_pages/plan-detail/model/constraints/teacher-availability.ts`, `src/_pages/plan-detail/model/drop-hints.ts`, `src/_pages/plan-detail/model/availability-index.ts`

**Intent**: Check *each* teacher in a course's set against the availability index and union the results; each unavailable co-teacher raises its own block/warn violation naming that teacher. No student analog — this is a deliberate departure.

**Contract**: `availability-index.ts` map stays `Map<teacherKey, Set<cellKey>>` (availability authored per individual teacher). `teacher-availability.ts:24-32` loops `course.teacherKeys`. `drop-hints.ts:109,111,164,167` union availability/conflict across `member.teacherKeys`. `constraints/types.ts:9,11` keep a single `teacherKey` per violation.

#### 5. Board read path aggregates from junction

**File**: `src/shared/api/load-cohort-courses.ts`, `src/_pages/plan-detail/api/load.ts`

**Intent**: Build each course's `teacherKeys[]` by aggregating the `course_teachers` junction, exactly as `studentKeys` is aggregated from `student_choices`. Stop reading `courses.teacher_id`.

**Contract**: `load-cohort-courses.ts:55,68,87,90-99` — `teacherKey: course.teacher_id` → aggregate `teacherKeys` from a junction query/embed (mirror `studentKeys` build at lines 29-33,47,57). `load.ts:65` — `.map(c => c.teacherKey).filter(...)` → `.flatMap(c => c.teacherKeys)`.

#### 6. Test factory emits junction rows

**File**: `src/test/factories/seed-plan-catalog.ts`

**Intent**: Build co-teaching state through the junction so integration tests (load, clone, adapter-parity) exercise the new source.

**Contract**: `seed-plan-catalog.ts:20-47` emits `course_teachers` rows instead of (or in addition to, during transition) `courses.teacher_id`. `add-availability.ts` stays single-teacher.

#### 7. Update affected tests

**File**: constraint-core + integration test suites

**Intent**: Reflect set semantics and the junction-sourced read path.

**Contract**: Unit — `constraints.test.ts:45-77`, `collision.test.ts`, `collisions.test.ts:33-38`, `drop-hints.test.ts`, `enumerate.test.ts`, `compute-catalog-hash.test.ts:21-24`. Integration — `clone-plan.integration.test.ts:104-113,229-263` (junction remap), `load.integration.test.ts:52-55`, `adapter-parity.integration.test.ts:62,80`.

### Success Criteria:

#### Automated Verification:

- [ ] Constraint-core + hash unit tests pass: `pnpm test`
- [ ] Load / clone-junction-remap / adapter-parity integration tests pass: `pnpm test:integration`
- [ ] Type change reconciles — build is clean: `pnpm build`
- [ ] Structure + lint pass: `pnpm steiger` && `pnpm lint`

#### Manual Verification:

> These board checks need co-taught data in the dev seed, which the generator only produces in
> Phase 5. At the Phase 2 gate they are backed by the load / clone-remap integration tests; run the
> Phase 5 seed regeneration immediately after this phase (it has no UI dependency — see the
> Implementation Note) and then perform them on the board.

- [ ] On the board, two co-placed courses sharing a co-teacher show the double-booking violation
- [ ] An availability warning names the specific unavailable co-teacher (fan-out), not an aggregate

**Implementation Note**: After automated verification passes, **run the Phase 5 seed regeneration now** — it depends only on the transcoder/generator, not the authoring UI, so it can (and should) execute out of numeric order here. This gives the dev board co-taught data and unblocks the manual checks above. Then pause for human confirmation of the (now data-backed) manual checks before Phase 3.

---

## Phase 3: Courses Authorship & UI

### Overview

Move the write path, schema, form, table, and view-model from a scalar teacher to a teacher set — using `writeParentWithLinks` for create and the `replace_course_teachers` RPC for update, and the existing multi-select primitive for the form.

### Changes Required:

#### 1. Shared Zod schema

**File**: `src/_pages/courses/model/schemas.ts`

**Intent**: Require a non-empty teacher set, mirroring `mergeInput.childCourseIds`.

**Contract**: `teacherId: z.uuid(...)` → `teacherIds: z.array(z.uuid()).min(1, "At least one teacher is required")` (line 44). Propagates to the action `input` gate and the RHF resolver. Update the docstring note (lines 12-13) to describe the array.

#### 2. Create / update domain functions + record mapper

**File**: `src/_pages/courses/api/create-course.ts`, `src/_pages/courses/api/update-course.ts`, `src/_pages/courses/api/course-record.ts`

**Intent**: `createCourse` inserts the course then bulk-inserts junction rows via `writeParentWithLinks`; `updateCourse` writes the course meta then calls `replace_course_teachers`. `toCourseRecord` stops mapping `teacherId → teacher_id`.

**Contract**: `createCourse` follows the `create-merge.ts:14-85` shape (parent insert → bulk link insert → compensating delete). `updateCourse` calls the RPC with `(planId, id, teacherIds)`. `course-record.ts:4-12` drops the scalar `teacher_id` field.

#### 3. Multi-select form

**File**: `src/_pages/courses/ui/CourseFormDialog.tsx`

**Intent**: Swap the single `<Select name="teacherId">` for the searchable `MultiSelect` bound to `teacherIds`.

**Contract**: Replace lines 171-199 with `MultiSelect` (`modal` flag required inside a Dialog), `items` = teacher options `{id,label}`, `selectedIds`/`onChange` RHF-bound. Default seeding `teacherIds: course.teacherIds ?? []`. Pattern: `MergeBuilderDialog.tsx:78-98`. No new dependency.

#### 4. Loader + view-model + table chips

**File**: `src/_pages/courses/api/loader.ts`, `src/_pages/courses/model/course.ts`, `src/_pages/courses/ui/CourseTable.tsx`

**Intent**: Add a junction query and project teacher labels as an array; render chips.

**Contract**: `loader.ts` adds a 5th parallel query grouped by `course_id` (mirror `course_merges`/`course_overlaps`). `course.ts:14-27` `teacherId/teacherLabel` → `teacherIds: string[]` / `teacherLabels: string[]`. `CourseTable.tsx:42,59` renders `teacherLabels` as `Badge` chips (`flex flex-wrap gap-2`, like existing Merged/Overlap badges).

#### 5. Teacher filter by any co-teacher

**File**: `src/_pages/courses/model/filter-courses.ts`

**Intent**: The courses-page teacher filter must keep a row when *any* of its co-teachers is selected — today it compares the scalar `teacherId`. (Compile-time consumer of the `CourseRow` shape change; must land in this phase to keep the build green.)

**Contract**: `filter-courses.ts:21` `course.teacherId !== null && teacherFilter.has(course.teacherId)` → `course.teacherIds.some((id) => teacherFilter.has(id))`. (`filter-params.ts` / `use-catalog-filters.ts` already model the filter *selection* as `teacherIds: string[]` — unchanged.)

#### 6. Merge model + builder shape (moved forward from Phase 4)

**File**: `src/_pages/courses/model/merge.ts`, `src/_pages/courses/ui/MergeBuilderDialog.tsx`

**Intent**: `MergeChildInput` / `MergeParentSpec` and the builder's live preview consume `CourseRow.teacherIds`, so this shape change must land in the same phase as `course.ts` or `pnpm build` is red at the Phase 3 boundary. (The server-side create-merge gate stays in Phase 4 §3; the merge *action* tests in Phase 4 §4.)

**Contract**: `merge.ts` — `MergeChildInput.teacherId: string | null` → `teacherIds: string[]`; `MergeParentSpec.teacherId: string` (line 25) → `teacherIds: string[]`; `deriveMergeParent` (`merge.ts:48-67`) compares teacher *sets* for equality (keep the `missing-teacher` / `mismatched-teacher` reasons). `MergeBuilderDialog.tsx:183` maps `teacherIds: course.teacherIds`; the preview at `:110` renders the parent's teacher set (join labels).

#### 7. Update courses unit tests

**File**: `schemas.test.ts`, `filter-courses.test.ts`, `load-cohort-courses.test.ts`, `merge.test.ts`

**Intent**: Reflect the array schema, view-model, the any-co-teacher filter, and set-equality merge derivation.

**Contract**: `schemas.test.ts:63-69` asserts `.min(1)`; filter/load tests use `teacherIds`/`teacherLabels`; `merge.test.ts:67-80` switches to set assertions. (Merge *action* tests stay in Phase 4 §4.)

### Success Criteria:

#### Automated Verification:

- [ ] Courses unit tests pass (schema `.min(1)`, view-model, create/update): `pnpm test`
- [ ] Build is clean: `pnpm build`
- [ ] Structure + lint pass: `pnpm steiger` && `pnpm lint`

#### Manual Verification:

- [ ] Creating a course with 2+ teachers via the multi-select renders teacher chips in the table and persists on reload
- [ ] Editing a course to add/remove a co-teacher persists atomically (no partial write)
- [ ] Submitting with zero teachers is blocked with a clear message

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before Phase 4.

---

## Phase 4: Teachers Page, Delete-Guard & Merge Knock-on

### Overview

Switch the teachers-page reverse-lookup to the junction, add the sole-teacher delete-guard (the single biggest behavioral change), and shift merge validation from single-teacher to teacher-set equality.

### Changes Required:

#### 1. Teachers reverse-lookup loader

**File**: `src/_pages/teachers/api/loader.ts`

**Intent**: Count/list a teacher's assigned courses from the junction instead of `courses WHERE teacher_id IS NOT NULL`.

**Contract**: Read `course_teachers` (PostgREST embed `course_teachers(teacher_id, courses(...))`) and group by junction `teacher_id`, populating `TeacherRow.assignments`. Replaces `loader.ts:25-37`.

#### 2. Sole-teacher delete-guard

**File**: `src/_pages/teachers/api/delete-teacher.ts`, `src/_pages/teachers/ui/DeleteTeacherDialog.tsx`

**Intent**: Block deleting a teacher who is the *only* teacher of any course (would orphan it to zero teachers); allow deleting a co-teacher (the junction link just cascades).

**Contract**: `delete-teacher.ts` gains a domain rule — query courses where this teacher is the sole `course_teachers` row; if any, throw `DomainError` listing them ("only teacher on N course(s) — reassign or delete those courses first"); otherwise delete (junction links cascade). `DeleteTeacherDialog.tsx:30,43-45` copy rewritten from "will remove their assignment" to reflect the guard/orphan list.

#### 3. Merge server gate

**File**: `src/_pages/courses/api/create-merge.ts`

**Intent**: The merge *model* shape (`MergeChildInput` / `MergeParentSpec` / `deriveMergeParent` set-equality) and the builder preview moved to Phase 3 §6. Phase 4 owns the authoritative server gate: re-derive the shared teacher set and persist it for the composite parent. (Persistence detail expanded in §3a below.)

**Contract**: `create-merge.ts` queries each child's teacher set from the junction, passes `teacherIds` into `deriveMergeParent`, and persists the parent's set (see §3a). Keep `missing-teacher` / `mismatched-teacher` as defensive gates.

#### 3a. Persist the composite parent's teacher set

**File**: `src/_pages/courses/api/create-merge.ts`

**Intent**: The merge parent is a real course placed on the board; its teachers must live in `course_teachers` like any course, or the parent renders teacher-less and composite sessions silently lose double-booking + availability detection. Today the parent's teacher is written inline as `teacher_id` (`create-merge.ts:53`).

**Contract**: In the child lookup (`create-merge.ts:16-22`), source each child's teacher *set* from the junction instead of selecting `teacher_id`. Drop the inline `teacher_id` from the parent insert (`:49-57`). After the parent row is created, persist its teacher set via one of: (a) extend the `writeParentWithLinks` link step to insert both `course_merges` *and* `course_teachers` parent rows, so the compensating `deleteParent` (`:74-83`) still cleans up on failure; or (b) call `replace_course_teachers(planId, parentId, parent.teacherIds)` after the parent insert. This removes the only remaining `teacher_id` write outside the dropped column — accounted for ahead of the Phase 6 drop.

#### 4. Update teachers + merge-action tests

**File**: `merge-actions.test.ts`, teachers loader/delete tests

**Intent**: Assert the server-gate set-equality and the delete-guard. (The `merge.test.ts` unit moved to Phase 3 §7.)

**Contract**: `merge-actions.test.ts:61-111` switch to set assertions; new delete-guard cases (sole-teacher blocked, co-teacher allowed); a new integration case asserting a created merge parent carries its teacher set when loaded for the board (proves §3a persistence).

### Success Criteria:

#### Automated Verification:

- [ ] Teachers loader + delete-guard tests pass (`pnpm test` / `pnpm test:integration`)
- [ ] Merge set-equality action tests pass
- [ ] Merge-parent persistence: a created merge parent carries its teacher set on board load (`pnpm test:integration`)
- [ ] Build + structure + lint clean: `pnpm build` && `pnpm steiger` && `pnpm lint`

#### Manual Verification:

- [ ] Teachers page shows each co-teacher's assigned-course count from the junction
- [ ] Deleting a sole teacher is blocked and names the orphaned course(s); deleting a co-teacher just drops the link
- [ ] Merging courses with mismatched teacher sets is blocked; matching sets merge

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before Phase 5.

---

## Phase 5: Seed Fixtures & Generator

### Overview

Make the generator emit junction rows for the (already-authored) co-taught fixtures and fail loud on a teacher-less course, so the feature is demonstrable on a fresh `db reset`. The co-taught CSV data already exists (§1, done); the remaining work is §2/§3 — without them the first-write-wins transcoder collapses a co-taught course to a single teacher.

> **Execution order:** run this phase immediately after Phase 2 — it has no dependency on the Phase 3/4 UI, and doing so unblocks the deferred Phase 2 board manual checks (double-booking + availability fan-out) by giving the board co-taught data. The courses-page *chip* rendering is verified separately in Phase 3.

### Changes Required:

#### 1. CSV fixtures — ✅ already in place (no work remaining)

**File**: `data/dp2/teachers_subjects.csv`, `data/dp2/students_subjects.csv`

**Intent**: A co-taught course already exists in the fixtures (authored ahead of this phase). Nothing further is needed here — §2/§3 are what turn this data into a genuinely co-taught seed.

**Contract**: `teachers_subjects.csv` carries `KK,Advisory,,,1` and `OT,Advisory,,,1` — two teacher rows sharing the course key `(Advisory, none, 0)`, i.e. one course co-taught by KK + OT (columns `code,name,level,group_index,hours`). `students_subjects.csv` enrolls the DP2 cohort in Advisory (4-column rows, CRLF-consistent). **Caveat:** with today's first-write-wins transcoder the second teacher (OT) is silently dropped, so `gen-seed.mjs` currently emits Advisory with a single teacher — concrete proof that §2 (teacher-set accumulation) and §3 (junction emission) are still required. `supabase/seed.sql` is intentionally **not** regenerated until §3 lands the junction block (regenerating now would bake in the single-teacher collapse).

#### 2. Transcoder accumulates a teacher set

**File**: `scripts/lib/catalog-transcode.mjs`

**Intent**: Store a set of teacher codes per course key instead of first-write-wins scalar.

**Contract**: `buildCohort` (`catalog-transcode.mjs:66-82`) accumulates `teacher_codes: Set<string>` per course key; add a `buildCourseTeachers(...)` emitting one junction row per (course, teacher), copying the `buildMerges`/`buildOverlaps` shape (`:348-365`).

#### 3. Seed generator junction block + abort

**File**: `scripts/gen-seed.mjs`

**Intent**: Emit a `course_teachers` insert block (copy the `course_merges` block) and abort loudly if any course resolves to zero teachers.

**Contract**: New `course_teachers` block; zero-teacher abort joins the generator's existing loud data-consistency aborts. Preserve the fixed `randomUUID()` call order (`gen-seed.mjs:8-13`) — insert the new UUID generation at a fixed point in canonical emission order so `seed.sql` stays byte-identical.

### Success Criteria:

#### Automated Verification:

- [ ] `node scripts/gen-seed.mjs > supabase/seed.sql` runs; a second run is byte-identical
- [ ] Generator aborts loudly when a course resolves to zero teachers (verified by a temporary bad fixture)
- [ ] `supabase db reset` loads the regenerated seed cleanly

#### Manual Verification:

- [ ] After a fresh `db reset`, the courses page shows co-taught courses with multiple teacher chips

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual check before Phase 6.

---

## Phase 6: Legacy Cleanup

### Overview

Drop the now-unused `courses.teacher_id` column and its FK/index, regenerate types, and remove the dead null-handling code paths.

### Changes Required:

#### 1. Drop column migration

**File**: `supabase/migrations/<new>_drop_courses_teacher_id.sql`

**Intent**: Retire the legacy scalar teacher link now that the junction is the single source.

**Contract**: Drop `courses_teacher_fkey`, `courses_plan_teacher_idx`, and `courses.teacher_id`. (Acceptable pre-prod DROP — see Critical Implementation Details.)

#### 2. Regenerate types

**File**: `src/shared/api/database.types.ts`

**Intent**: Remove `courses.teacher_id` from the generated types.

**Contract**: `courses.Row`/`Insert`/`Update` no longer carry `teacher_id`; the old composite relationship is gone.

#### 3. Remove dead null-handling

**File**: `src/shared/api/load-cohort-courses.ts`, `src/_pages/courses/ui/CourseTable.tsx`, `src/_pages/plan-detail/model/constraints/teacher-conflict.ts`

**Intent**: Drop branches made unreachable by the ≥1 invariant + set model.

**Contract**: Remove the `teacherKey === null` "no-teacher" warning (`load-cohort-courses.ts:153`), the `"—"` teacher fallback (`CourseTable.tsx:59`), and any residual `skipNullKeys`/null-guard left in `teacher-conflict.ts`. Keep the `missing-teacher` merge reason as a defensive gate. If the `ComputeWarning` `"no-teacher"` kind is now unreachable, remove it from the union and its emit site. (`create-merge.ts`'s inline `teacher_id` write was already removed in Phase 4 §3a — the criterion 6.4 "no dangling `teacher_id` refs" check confirms nothing residual remains.)

### Success Criteria:

#### Automated Verification:

- [ ] Drop migration applies: `supabase db reset`
- [ ] `database.types.ts` regenerated; no `teacher_id` on `courses`
- [ ] Full suites pass: `pnpm test` && `pnpm test:integration`
- [ ] No dangling references to `teacher_id`/`teacherKey`; build + structure + lint clean: `pnpm build` && `pnpm steiger` && `pnpm lint`

#### Manual Verification:

- [ ] Board, courses, and teachers flows all still work after the column drop

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual check before Phase 7.

---

## Phase 7: E2E

### Overview

Add a Playwright spec proving the co-teaching authoring round-trip and the sole-teacher delete-guard end-to-end on real workerd, in the authenticated `chromium` project.

### Changes Required:

#### 1. Authoring round-trip spec

**File**: `e2e/specs/co-teaching.spec.ts`

**Intent**: Drive the courses page to create a course with 2+ teachers, edit it to add/remove a co-teacher, and assert the chips render and persist.

**Contract**: Authenticated `chromium` spec (reuses `storageState`). Create a plan (or reuse one), open the course dialog, select ≥2 teachers via the `MultiSelect`, save; assert ≥2 teacher chips in `CourseTable`; reload and re-assert (persistence); edit to drop one teacher and re-assert. Clean up created entities (follow `seed.spec.ts:25-31` teardown style). Use role-based locators.

#### 2. Delete-guard-block spec

**File**: `e2e/specs/co-teaching.spec.ts` (second `test`)

**Intent**: Prove the sole-teacher delete-guard blocks at the UI.

**Contract**: Arrange a course whose only teacher is teacher T (create via UI), go to the teachers page, attempt to delete T, assert the delete is blocked and the dialog/error names the orphaned course. Then (optionally) add a co-teacher and assert deleting the now-non-sole teacher succeeds. Tear down created entities.

### Success Criteria:

#### Automated Verification:

- [ ] `pnpm test:e2e` passes including the new `co-teaching.spec.ts` (authoring round-trip + delete-guard)
- [ ] Specs run green in the `chromium` (authenticated) project without affecting `chromium-guard`

#### Manual Verification:

- [ ] On a forced-failure run, the trace/screenshots show the assertions are meaningful (not passing vacuously)

**Implementation Note**: Final phase — after E2E is green, confirm the full local CI gate (`/verify`) passes before opening the PR.

---

## Testing Strategy

### Unit Tests:

- `teacher-conflict` set-intersection semantics (empty set = no conflict; shared teacher = conflict); parity with `student-conflict`.
- `compute-catalog-hash` new fixed digest; code-point sort of `teacherKeys`.
- Availability fan-out: a course with co-teachers raises one violation per unavailable teacher.
- `schemas` `.min(1)` rejection of empty teacher sets.
- `merge` set-equality (matching sets merge; mismatched sets blocked).
- Drop-hints union across `teacherKeys`.

### Integration Tests:

- `clone_plan` remaps `course_teachers` (both maps; fail-loud on stale UUID).
- Board load aggregates `teacherKeys` from the junction (`load.integration`).
- Adapter-parity over teacher sets.
- Delete-teacher guard: sole-teacher blocked, co-teacher allowed.
- Merge-parent persistence: a created composite parent carries its teacher set in `course_teachers` (board load).

### E2E (Playwright):

- Authoring round-trip: create/edit a co-taught course, chips render + persist.
- Delete-guard: sole-teacher deletion blocked at the UI.

### Manual Testing Steps:

1. `pnpm env:local && supabase db reset` — confirm seed has co-taught courses with chips.
2. Create a course with 2 teachers; place both co-taught courses sharing a teacher on the board → double-booking violation.
3. Place a co-taught course where one co-teacher is unavailable → warning naming that teacher.
4. Delete a sole teacher → blocked; delete a co-teacher → link drops.
5. Merge courses with matching vs mismatched teacher sets.

## Performance Considerations

The per-edge cost goes from O(1) scalar compare to O(N_a × N_b) set intersection — the exact shape `student-conflict.test` already runs over much larger student rosters. Teacher count N≈1–3 is dominated by the existing student term in the same `violatesAny` call; the <200ms drag budget is not at risk. Enumeration node count is unchanged.

## Migration Notes

- Additive-first, drop-last: the junction + RPCs land while `courses.teacher_id` survives (Phase 1); the column is dropped only after all paths read/write the junction (Phase 6).
- The catalog-hash shape change invalidates persisted `catalog_hash` values once; self-heals via the existing recompute paths — no data migration.
- No production data to preserve (README §Rollback); the DROP is acceptable at this stage.

## References

- Research: `context/changes/co-teaching-teacher-sets/research.md`
- Table template: `supabase/migrations/20260613130000_teacher_availability.sql:14-34`
- RPC template: `supabase/migrations/20260604141213_replace_cohort_groupings_fn.sql:15-51`
- Clone RPC: `supabase/migrations/20260613130001_clone_plan_with_teacher_availability.sql`
- Student blueprint: `src/_pages/plan-detail/model/constraints/student-conflict.ts:10-25`
- Multi-select usage: `src/_pages/courses/ui/MergeBuilderDialog.tsx:78-98`
- E2E harness: `playwright.config.ts`, `e2e/specs/seed.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persistence Foundation (DB)

#### Automated

- [x] 1.1 `supabase db reset` applies all migrations cleanly — 6bcca1a
- [x] 1.2 `database.types.ts` regenerated and includes `course_teachers` + `replace_course_teachers` — 6bcca1a
- [x] 1.3 Existing integration suite passes with no regression — 6bcca1a
- [x] 1.4 Lint + structure pass (`pnpm lint` && `pnpm steiger`) — 6bcca1a
- [x] 1.5 Build stays clean (`pnpm build`) — 6bcca1a

#### Manual

- [x] 1.6 `course_teachers` RLS enabled; `has_table_privilege('anon',…,'insert')`=false AND `('authenticated',…)`=true (proven by query, not by reading); RPC callable — 6bcca1a

### Phase 2: Constraint Core + Board Read Path + Catalog Hash

#### Automated

- [x] 2.1 Constraint-core + hash unit tests pass (`pnpm test`) — e414807
- [x] 2.2 Load / clone-junction-remap / adapter-parity integration tests pass — e414807
- [x] 2.3 Type change reconciles — build is clean (`pnpm build`) — e414807
- [x] 2.4 Structure + lint pass (`pnpm steiger` && `pnpm lint`) — e414807

#### Manual

- [ ] 2.5 Board shows double-booking for co-placed courses sharing a co-teacher
- [ ] 2.6 Availability warning names the specific unavailable co-teacher (fan-out)

### Phase 3: Courses Authorship & UI

#### Automated

- [x] 3.1 Courses unit tests pass (schema `.min(1)`, view-model, create/update) — 2cedaf0
- [x] 3.2 Build is clean (`pnpm build`) — 2cedaf0
- [x] 3.3 Structure + lint pass (`pnpm steiger` && `pnpm lint`) — 2cedaf0

#### Manual

- [ ] 3.4 Creating a course with 2+ teachers renders chips and persists on reload
- [ ] 3.5 Editing to add/remove a co-teacher persists atomically
- [ ] 3.6 Submitting with zero teachers is blocked with a clear message

### Phase 4: Teachers Page, Delete-Guard & Merge Knock-on

#### Automated

- [x] 4.1 Teachers loader + delete-guard tests pass
- [x] 4.2 Merge set-equality action tests pass
- [x] 4.3 Merge-parent persistence integration test passes (parent carries its teacher set on board load)
- [x] 4.4 Build + structure + lint clean

#### Manual

- [ ] 4.4 Teachers page shows each co-teacher's assigned-course count from the junction
- [ ] 4.5 Sole-teacher deletion blocked + names orphaned course(s); co-teacher deletion drops the link
- [ ] 4.6 Mismatched teacher-set merge blocked; matching sets merge

### Phase 5: Seed Fixtures & Generator

#### Automated

- [x] 5.1 `gen-seed.mjs` runs; second run byte-identical — e414807
- [x] 5.2 Generator aborts loudly on a zero-teacher course — e414807
- [x] 5.3 `supabase db reset` loads the regenerated seed cleanly — e414807

#### Manual

- [ ] 5.4 Fresh `db reset` shows co-taught courses with multiple teacher chips

### Phase 6: Legacy Cleanup

#### Automated

- [ ] 6.1 Drop migration applies (`supabase db reset`)
- [ ] 6.2 `database.types.ts` regenerated; no `teacher_id` on `courses`
- [ ] 6.3 Full `pnpm test` + `pnpm test:integration` pass
- [ ] 6.4 No dangling `teacher_id`/`teacherKey` refs; build + structure + lint clean

#### Manual

- [ ] 6.5 Board, courses, and teachers flows still work after the column drop

### Phase 7: E2E

#### Automated

- [ ] 7.1 `pnpm test:e2e` passes including `co-teaching.spec.ts` (authoring round-trip + delete-guard)
- [ ] 7.2 Specs run green in `chromium` without affecting `chromium-guard`

#### Manual

- [ ] 7.3 Forced-failure run confirms the assertions are meaningful (not vacuous)
