---
date: 2026-06-20T20:27:08+0200
researcher: Dobromir Kropielnicki
git_commit: a6f86e1369d0af644e67499910cef715c10f8a2f
branch: main
repository: ib-timetable-planner
topic: "Co-teaching teacher sets: multiple teachers per course (feasibility + impact map)"
tags: [research, codebase, teachers, courses, constraint-core, persistence, clone-plan, catalog-hash]
status: complete
last_updated: 2026-06-20
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Recorded resolved design decisions (pure junction, drop teacher_id, app-enforced ≥1, replace RPC)"
---

# Research: Co-teaching teacher sets — multiple teachers per course

**Date**: 2026-06-20T20:27:08+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: a6f86e1369d0af644e67499910cef715c10f8a2f
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

Enable a course to be **co-taught by multiple teachers** (a "teacher set") instead of exactly one. Validation must treat the whole set — every co-teacher must be available in a slot, and each is checked for double-booking. Today a course holds a single nullable `teacher_id`. This document is the **feasibility + full impact map** to inform a `/10x-plan`: current model, data-model options with trade-offs, constraint-engine + <200 ms drag-budget impact, and every UI / migration / seed / type / test touch-point.

*(Scope confirmed with the user: intent = "multiple teachers per course"; output = "feasibility + full impact map".)*

## Summary

**Feasibility is high, and the cost is bounded — because the codebase already solves this exact problem for students.** The constraint core already models `studentKeys: string[]` (a *set* of student keys per course) right next to the single `teacherKey: string | null`. Turning `teacherKey` into `teacherKeys: string[]` is, in three of the most complex layers, *literally copying the student machinery*:

- **`teacher-conflict` becomes a near-copy of `student-conflict`** (set intersection instead of scalar equality).
- **The catalog-load path** aggregates teachers from a junction the same way it already aggregates student rosters.
- **Board name plumbing** flat-maps over teacher keys the same way it already flat-maps over student keys.

The **<200 ms drag budget is not at risk**: `student-conflict.test` already runs set-intersection over rosters of *tens* of students on the same hot path and meets budget; a course's teacher count (1–3) is one to two orders of magnitude smaller, so the teacher term is dominated by the student term that already exists in the same evaluation.

**Recommended persistence: a new junction table `course_teachers(plan_id, course_id, teacher_id)`** with the project's composite-FK pattern. It preserves the cross-plan-impossible / fail-loud-on-clone invariant the entire schema is built on, mirrors the two most recent precedents (`teacher_availability` and `course_grouping_members`), and makes the `clone_plan` change a *copy of a tested block*. A Postgres `uuid[]` array column is rejected: arrays can't carry per-element FKs, so it discards exactly the referential integrity that migration `20260612090000` was written to add.

**Three things are NOT a simple mirror and need explicit design attention** (details in [Architecture Insights](#architecture-insights)):
1. **`teacher-availability` + drop-hints** must *fan out per co-teacher* — there is no student analog (availability is teacher-only).
2. **The catalog hash projection changes shape** (`teacherKey` scalar → sorted `teacherKeys` array), a one-time invalidation of all persisted catalog hashes.
3. **Course-merge validation** currently requires merged children to share a *single* teacher; that rule becomes "share the same teacher *set*."

**Open product decisions** (flagged inline): (a) minimum teachers per course — keep today's app-layer "exactly one required" as `.min(1)`, or allow zero (the DB column was always nullable)?; (b) `updateCourse` write strategy — a new `replace_course_teachers` plpgsql RPC (recommended, matches the codebase) vs a client-side diff.

## Decisions (resolved 2026-06-20)

These supersede the original "Open Questions" below and make the change plan-ready. Decided with the user during research.

1. **Intent — multiple teachers per course, symmetric.** No "lead/primary" teacher; all co-teachers are equal members of a set.
2. **Persistence — pure junction; drop `courses.teacher_id`.** Add `course_teachers(plan_id, course_id, teacher_id)` with composite FKs `(plan_id, course_id) → courses(plan_id, id) on delete cascade` and `(plan_id, teacher_id) → teachers(plan_id, id) on delete cascade`, `unique (plan_id, course_id, teacher_id)`, surrogate `id` PK, plan + composite indexes, RLS `for all to authenticated`. **Drop** the `courses.teacher_id` column, its `courses_teacher_fkey`, and `courses_plan_teacher_idx`. The junction is the *single source* of a course's teacher set — an exact mirror of how `studentKeys` is built from `student_choices`, so the constraint core gets the cleanest possible single-source shape. The `DROP` deviates from the additive guideline but is acceptable pre-prod (no production data; precedent: the destructive re-baseline `20260611180006`).
3. **≥1 teacher per course — app-enforced (no DB trigger).** `teacherIds: z.array(z.uuid()).min(1, …)` in the shared Zod schema (server gate + RHF resolver); `delete-teacher` blocks removing the *sole* teacher of any course; `gen-seed.mjs` aborts loudly if any course resolves to zero teachers. The DB *could* technically hold a teacher-less course via raw writes, but no app path creates one — consistent with the codebase's RPC/app-guard style (no trigger precedent).
4. **Teacher deletion — symmetric, app-guarded.** Junction teacher FK is `ON DELETE CASCADE`. The delete action blocks a deletion that would orphan any course (i.e. the teacher is that course's only teacher), surfacing those courses for reassignment; removing a teacher who is one of several co-teachers just drops the link. No auto-promotion (there is no lead).
5. **`updateCourse` write — `replace_course_teachers` RPC.** A `security invoker` plpgsql function does delete + reinsert of the course's junction rows in one transaction, mirroring `replace_cohort_groupings` (`supabase/migrations/20260604141213_*`). `createCourse` uses `writeParentWithLinks` (insert course → bulk-insert junction → compensating delete on link failure), mirroring `createMerge`.
6. **Recommended defaults (pending final confirm):**
   - *Junction shape*: plain unordered set, **no `role`/`position` column** — symmetric teachers; a role column is a cheap additive change later if needed.
   - *Availability for a co-taught placement*: **per-co-teacher fan-out** — each co-teacher unavailable at the placed cell raises its own block/warn violation (naming that teacher); availability stays authored per individual teacher. (Not an aggregate "all must be unavailable" rule.)
   - *Count*: **no hard cap** on teachers per course (optional soft UI limit).
7. **Knock-on — course-merge validation.** `deriveMergeParent` (`src/_pages/courses/model/merge.ts:48-67`) shifts from "children share a single non-null teacher" to "children share the same teacher *set*" (set equality); `MergeParentSpec` carries the set.

## Detailed Findings

### Current model (baseline)

**Persistence.** `courses.teacher_id` is a single nullable FK, rekeyed to the plan-scoped composite FK `(plan_id, teacher_id) → teachers(plan_id, id)`:
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:28-48` — original `courses` table, `teacher_id uuid references teachers(id) on delete set null`.
- `supabase/migrations/20260612090000_courses_teacher_composite_fk.sql:10-20` — drops the plain FK, adds composite `courses_teacher_fkey foreign key (plan_id, teacher_id) references teachers (plan_id, id) on delete set null (teacher_id)`, plus index `courses_plan_teacher_idx`. The header states this migration exists *specifically* to stop a course referencing a teacher from another plan — "a link clone_plan would then silently NULL via its LEFT JOIN remap."
- Generated types: `src/shared/api/database.types.ts` — `courses.teacher_id: string | null`, FK to `teachers(plan_id, id)`.

**Constraint core.** Each course in the core carries one teacher key:
- `src/shared/lib/catalog-hash/types.ts:8-13` — `GroupingCourse = { id; teacherKey: string | null; studentKeys: string[]; hours }`. **Note the asymmetry: students are already a set.**
- Two teacher constraints: `src/_pages/plan-detail/model/constraints/teacher-conflict.ts` (double-booking; has a `test` → on the enumeration/drag fast path) and `.../teacher-availability.ts` (board-only; *omits* `test`, so excluded from enumeration).

**Authorship.** Teacher assignment is authored only on the courses page; the teachers page shows it read-only:
- `src/_pages/courses/ui/CourseFormDialog.tsx:171-199` — single shadcn `<Select name="teacherId">`.
- `src/_pages/courses/model/schemas.ts:44` — `teacherId: z.uuid("A teacher is required")` (app-layer *required*, though the DB column is nullable; the file docstring flags this deliberate mismatch).
- `src/_pages/courses/api/course-record.ts:4-12` — `toCourseRecord` maps `input.teacherId → teacher_id` as one scalar field.

### Area 1 — Constraint engine: `teacherKey` → `teacherKeys[]` (the studentKeys blueprint)

**`student-conflict` is the existing implementation of "courses clash if their key-sets intersect"** (`src/_pages/plan-detail/model/constraints/student-conflict.ts`):
- `test` fast path (line 21): `others.some((item) => item.studentKeys.some((s) => course.studentKeys.includes(s)))` — "share ANY key."
- `explain` (lines 10-25): pairwise loop, `sharedStudents(a,b) = a.studentKeys.filter((s) => b.studentKeys.includes(s))`.

**`teacher-conflict` today uses scalar equality** (`src/_pages/plan-detail/model/constraints/teacher-conflict.ts:14,20-23`): groups by the single `course.teacherKey` (a Map key), `skipNullKeys`, `test` is `course.teacherKey !== null && others.some(i => i.teacherKey === course.teacherKey)`. **Converting to a set makes it a near-copy of `student-conflict`** — the null guard disappears (empty array = no conflict, exactly like `studentKeys: []`).

**The combinatorial hot path is field-agnostic** and needs *zero* change:
- `src/_pages/plan-detail/model/enumerate.ts:38` gates groupings only via `hasIntersection` → `src/_pages/plan-detail/model/collision.ts` → `violatesAny` (`src/_pages/plan-detail/model/constraints/index.ts:24-25`), which runs each constraint's `test?`. Two courses sharing a teacher are mutually incompatible during enumeration — same mechanism as sharing a student.
- `collisions.ts`, `compute-groupings.ts`, `score.ts`, and the `CollisionViolation` render path never name `teacherKey` — they ride entirely on `violatesAny`/`explainCell`. **Free.**

**<200 ms budget — already absorbed.** The per-edge cost goes from O(1) scalar compare to O(N_a × N_b) set intersection, *the exact shape `student-conflict.test` already runs* over much larger student rosters (`src/_pages/plan-detail/model/score.ts:12` sums `studentKeys.length`; rosters are tens of students). Teacher count N≈1–3 is dominated by the student term in the same `violatesAny` call. Enumeration node count is unchanged (the conflict graph shape is identical).

**Catalog-hash determinism** (`src/shared/lib/catalog-hash/compute-catalog-hash.ts:13-23`): the hash already sorts `studentKeys` per course (`[...course.studentKeys].sort()`, line 20) and sorts courses by id. Line 18 (`teacherKey: course.teacherKey`) becomes `teacherKeys: [...course.teacherKeys].sort()` — mirror line 20. **Use code-point `.sort()`, NOT `localeCompare`** (a fixed-digest test, `compute-catalog-hash.test.ts:21-24`, locks this). This changes the canonical JSON shape, so **every existing catalog hash is invalidated once** — regenerate the fixed-digest test and expect a one-time stale-hash recompute on deploy (acceptable; the clone flow already recomputes `catalog_hash` JS-side).

### Area 2 — Persistence: junction table vs array (recommendation: junction)

**The composite-FK pattern is the load-bearing invariant.** `supabase/migrations/20260611180006_plans_as_domain_root.sql` re-based every domain table to carry `plan_id` + a `(plan_id, id)` unique used as a composite-FK target, *so that cloning is safe*: a child can only reference a parent in the same plan, and a missed UUID remap during clone fails loudly at insert. `teacher_availability` is the most recent teacher-child precedent and the exact template to copy:
- `supabase/migrations/20260613130000_teacher_availability.sql:16-34` — surrogate `id` PK, composite-unique business key, composite FK `(plan_id, teacher_id) → teachers(plan_id, id) on delete cascade`, plan + composite indexes, RLS enabled with the standard `for all to authenticated using (true) with check (true)` policy.

**`clone_plan` is the make-or-break test.** The function (`supabase/migrations/20260613130001_clone_plan_with_teacher_availability.sql`, called from `src/_pages/plans-list/api/clone-plan.ts:14`) builds per-table temp ID maps (`_teacher_map`, `_course_map`, …) and copies each table joining through the maps to swap UUIDs.
- **Option A — junction `course_teachers`**: add **one new insert block, a copy of the `course_grouping_members` block** (which already double-remaps through two maps):
  ```sql
  insert into public.course_teachers (plan_id, course_id, teacher_id)
  select v_new_plan_id, cm.new_id, tm.new_id
    from public.course_teachers ct
    join pg_temp._course_map  cm on cm.old_id = ct.course_id
    join pg_temp._teacher_map tm on tm.old_id = ct.teacher_id
   where ct.plan_id = p_source_plan_id;
  ```
  INNER JOIN both maps; the composite FK keeps the fail-loud safety net.
- **Option B — array `courses.teacher_ids uuid[]`**: no new block, but the courses copy must do element-wise `array_agg` remap via `unnest`. This is materially more complex and **silently fragile** — a stale/foreign UUID in the array is *dropped* by the join with no error, reintroducing the precise "silently NULL via remap" bug `20260612090000` exists to prevent (no FK to fail loudly).

**RLS + grants** (per the project lesson "granting a role is not excluding others"):
- A new `course_teachers` table **auto-inherits** `authenticated` + `service_role` DML and **auto-excludes** `anon`, because `alter default privileges` rules are already in place (`supabase/migrations/20260617171048_*`, `20260618203532_*`, `20260617205628_*`). Only the explicit `enable row level security` + the standard `authenticated` policy must be written (RLS is not inherited). There is *no* per-row plan-ownership scoping in this codebase today — `plans` has no `owner_id`; auth is enforced at middleware/`requireSession`.
- Option B's only genuine advantage: **zero** RLS/grant work (the column lives on `courses`).

**Migration conventions**: additive / nullable / no-DROP (README §"Rollback"); **no production data to preserve yet**. Option A is a single additive `create table` migration + RLS; `courses.teacher_id` can stay as a nullable legacy column during transition (or be retired).

### Area 3 — Write / authorship path

**Every required mechanism already exists in-repo** — this is "apply existing patterns," not "invent":
- **Multi-row child writes**: `src/_pages/courses/api/create-merge.ts:14-85` inserts a parent then bulk-inserts N `course_merges` link rows via `src/shared/lib/write-parent-with-links/write-parent-with-links.ts:15-29` (insert parent → insert links → compensating-delete parent on link failure). `createCourse` would gain a parallel bulk-insert of `course_teachers`.
- **Atomic delete-then-reinsert RPC**: `supabase/migrations/20260604141213_replace_cohort_groupings_fn.sql:15-51` is a `security invoker` plpgsql function that does `delete … then insert from jsonb` in one transaction (called from `src/_pages/plan-detail/api/persist.ts:27`). Its header documents *exactly* the hazard it avoids: "PostgREST has no client-side transaction, so a delete followed by a failed insert would wipe … with nothing to show for it." **Recommend a `replace_course_teachers(p_plan_id, p_course_id, p_teacher_ids jsonb)` RPC for `updateCourse`** — it mirrors this precedent and avoids the "client delete succeeds, reinsert fails, course now has zero teachers" hazard that `writeParentWithLinks` only covers on *create*.
- Domain functions keep the standard shape `defineDomainAction` → `requireSession → requireSupabase → runDomain` (`src/shared/lib/actions/define-domain-action.ts:17-24`), throwing `DomainError` (`src/shared/lib/errors/domain-error.ts`).

**Shared Zod schema** (`src/_pages/courses/model/schemas.ts:44`): `teacherId: z.uuid(...)` → `teacherIds: z.array(z.uuid()).min(1, "At least one teacher is required")`, mirroring `mergeInput.childCourseIds` (line 72, `z.array(z.uuid()).min(2, ...)`). The schema is shared by the action `input` gate and the RHF `zodResolver`, so the one edit propagates. **Decision: `.min(1)` (preserve today's "a course must have a teacher") vs allow-zero (matches the historically-nullable column, enables unstaffed/draft courses).** Consider a `.max(N)` cap.

**Form UI** — a multi-select primitive already exists, no new dependency:
- `src/shared/ui/multi-select.tsx` — searchable Popover + cmdk `MultiSelect` with `items:{id,label}[]`, `selectedIds`, `onChange`, plus a `modal` flag required inside a Dialog. `MultiSelectItem {id;label}` is identical to `TeacherOption`.
- The RHF-array binding is already demonstrated in `src/_pages/courses/ui/MergeBuilderDialog.tsx:78-98` (binds `childCourseIds` to `MultiSelect modal` inside a Dialog). **Swapping the `teacherId` `<Select>` (CourseFormDialog.tsx:171-199) for a `MultiSelect name="teacherIds"` is mechanical**; default-value seeding becomes `teacherIds: course.teacherIds ?? []` / `[]`.

**Loader & view model**:
- `src/_pages/courses/api/loader.ts` already issues parallel grouped child queries (`course_merges`, `course_overlaps`, grouped with `groupBy`). `course_teachers` becomes a 5th parallel query grouped by `course_id` — exactly mirroring merges/overlaps.
- `src/_pages/courses/model/course.ts:14-27` — `CourseRow.teacherId/teacherLabel` (scalar) → `teacherIds: string[]` / `teacherLabels: string[]`, mirroring existing array fields `mergeChildIds`/`overlaps`.
- `src/_pages/courses/ui/CourseTable.tsx:42,59` — render `row.teacherLabels.join(", ")` or `Badge` chips (the file already renders Merged/Overlap badges with `flex flex-wrap gap-2`).

**Teachers-page reverse lookup** (`src/_pages/teachers/api/loader.ts:25-37`): today queries `courses WHERE teacher_id IS NOT NULL` and groups by `teacher_id`. Under the junction, read `course_teachers` (PostgREST embed `course_teachers(teacher_id, courses(...))`) and group by junction `teacher_id`. `DeleteTeacherDialog`'s "assigned to N course(s)" count (`src/_pages/teachers/ui/DeleteTeacherDialog.tsx:30,43-45`) keeps working as long as the loader populates `TeacherRow.assignments`. Teacher delete should `on delete cascade` the junction rows (vs today's `on delete set null` on `courses.teacher_id`). **Edge case**: with `.min(1)` enforced app-side, deleting the last teacher of a co-taught course leaves it with zero teachers (DB allows it) — consider a guard or re-staffing prompt.

### Area 4 — Seed fixtures + generator

- Today each CSV row = one teacher teaching one course: `data/dp1/teachers_subjects.csv` columns `code,name,level,group_index,hours` (e.g. `AP,Math AI,SL,,4`). `scripts/lib/catalog-transcode.mjs` (`buildCohort`, lines 66-82) stores a single `teacher_code` per course key, first-write-wins.
- **Recommended fixture format (lowest-risk)**: multiple rows with the same course key each contribute one teacher (e.g. add `LB,Math AI,SL,,4`). The transcoder accumulates `teacher_codes: Set<string>` per course key instead of a scalar.
- Generator: add `buildCourseTeachers(...)` emitting one junction row per (course, teacher) — copy the existing `buildMerges`/`buildOverlaps` shape — and a `course_teachers` block in `scripts/gen-seed.mjs` (copy the `course_merges` block). **Critical**: `randomUUID()` call order must stay fixed to keep `seed.sql` byte-identical (documented in `gen-seed.mjs:8-13` and `catalog-transcode.mjs:18-19`) — insert the new UUID generation at a fixed point in the canonical emission order.

### Area 5 — Course-merge validation (non-obvious impact)

`src/_pages/courses/model/merge.ts:48-67` (`deriveMergeParent`) currently enforces that merged children share a **single non-null teacher** (`missing-teacher` / `mismatched-teacher` reasons; `MergeParentSpec.teacherId: string`, line 25). This is the single source of truth for both the builder dialog preview and the `createMerge` server gate. Under co-teaching this rule must become **"all children share the same teacher *set*"** and the composite parent carries that set — a set-equality comparison instead of scalar equality. Tests `src/_pages/courses/model/merge.test.ts` and `src/_pages/courses/api/merge-actions.test.ts` assert the current single-teacher rule and must change.

## Code References

**Persistence / migrations**
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:28-48` — `courses` table, original single `teacher_id`; `:60-66` — `course_merges` junction template.
- `supabase/migrations/20260612090000_courses_teacher_composite_fk.sql:10-20` — composite-FK rationale (cross-plan / fail-loud-clone).
- `supabase/migrations/20260613130000_teacher_availability.sql:16-34` — teacher-child table template (composite FK + RLS) to mirror for `course_teachers`.
- `supabase/migrations/20260613130001_clone_plan_with_teacher_availability.sql` — clone RPC; add a `course_teachers` copy block modeled on the `course_grouping_members` block.
- `supabase/migrations/20260604141213_replace_cohort_groupings_fn.sql:15-51` — atomic delete-then-reinsert RPC precedent for `replace_course_teachers`.
- `supabase/migrations/20260617171048_*`, `20260618203532_*`, `20260617205628_*` — grant/revoke default-privilege rules (new table auto-inherits grants; anon auto-excluded; RLS must be added explicitly).

**Constraint core**
- `src/shared/lib/catalog-hash/types.ts:10` — `teacherKey: string | null` → `teacherKeys: string[]` (the one definition).
- `src/shared/lib/catalog-hash/compute-catalog-hash.ts:18` — hash field; sort like `studentKeys` (line 20), code-point sort.
- `src/_pages/plan-detail/model/constraints/teacher-conflict.ts:14,20-23` — becomes a copy of `student-conflict.ts:21,24-25`.
- `src/_pages/plan-detail/model/constraints/teacher-availability.ts:24-32` — fan out per co-teacher (no student analog).
- `src/_pages/plan-detail/model/drop-hints.ts:109,111,164,167` — union availability/conflict across `member.teacherKeys`.
- `src/_pages/plan-detail/model/availability-index.ts:21-24` — `Map<teacherKey, Set<cellKey>>` stays single-teacher-keyed; only consumers loop.
- `src/_pages/plan-detail/model/constraints/types.ts:9,11` — `kind:"teacher"` / `"teacher-unavailable"` keep a single `teacherKey` per violation (render path unchanged).
- Field-agnostic, no change: `enumerate.ts`, `collision.ts`, `collisions.ts`, `compute-groupings.ts`, `score.ts`.

**Read / board-load path**
- `src/shared/api/load-cohort-courses.ts:55,68,87,90-99` — `teacherKey: course.teacher_id` (scalar) → aggregate `teacherKeys[]` from the junction, mirroring how `studentKeys` is built from `student_choices` (lines 29-33,47,57).
- `src/_pages/plan-detail/api/load.ts:65` — `.map(c => c.teacherKey).filter(...)` → `.flatMap(c => c.teacherKeys)` (mirror the students line one below).

**Write / UI / authorship**
- `src/_pages/courses/api/create-course.ts`, `update-course.ts`, `course-record.ts:4-12`, `create-merge.ts:14-85`, `src/shared/lib/write-parent-with-links/write-parent-with-links.ts:15-29`.
- `src/_pages/courses/model/schemas.ts:44` — `teacherId` → `teacherIds` array.
- `src/_pages/courses/ui/CourseFormDialog.tsx:171-199`, `MergeBuilderDialog.tsx:78-98`, `src/shared/ui/multi-select.tsx`.
- `src/_pages/courses/api/loader.ts`, `src/_pages/courses/model/course.ts:14-27`, `src/_pages/courses/ui/CourseTable.tsx:42,59`.
- `src/_pages/teachers/api/loader.ts:25-37`, `src/_pages/teachers/api/delete-teacher.ts`, `src/_pages/teachers/ui/DeleteTeacherDialog.tsx:30,43-45`.
- `src/_pages/courses/model/merge.ts:48-67` — single-teacher rule → teacher-set rule.

**Seed**
- `data/dp1/teachers_subjects.csv`, `data/dp2/teachers_subjects.csv`, `scripts/lib/catalog-transcode.mjs:66-82,348-365`, `scripts/gen-seed.mjs:8-13,55-70`.

**Tests requiring changes** (from the repo-wide sweep)
- Integration: `src/_pages/plans-list/api/clone-plan.integration.test.ts:104-113,229-263` (junction remap), `src/_pages/plan-detail/api/load.integration.test.ts:52-55` (iterate `teacherKeys`), `src/_pages/plan-detail/api/adapter-parity.integration.test.ts:62,80` (set compare).
- Unit (constraint core): `constraints.test.ts:45-77`, `collision.test.ts`, `collisions.test.ts:33-38`, `drop-hints.test.ts`, `enumerate.test.ts`, `compute-catalog-hash.test.ts:21-24` (fixed digest). `hours.test.ts`/`score.test.ts` unaffected.
- Unit (courses): `schemas.test.ts:63-69`, `merge.test.ts:67-80`, `merge-actions.test.ts:61-111`, `filter-courses.test.ts`, `load-cohort-courses.test.ts`.
- Factories: `src/test/factories/seed-plan-catalog.ts:20-47` (emit junction rows). `add-availability.ts` stays single-teacher (availability is per-teacher).
- E2E (`e2e/specs/*.spec.ts`): no teacher-specific coverage — no change.

## Architecture Insights

1. **The student set is the proven blueprint.** The single most important finding: the hardest layers (conflict detection, hot-path performance, hash determinism, name plumbing, junction aggregation) are *already solved* for students. The migration is largely "make teacher look like student." This both de-risks the work and gives a concrete, tested reference for every change.

2. **Three deliberate departures from the blueprint** (no student analog → real design work):
   - **Teacher availability fans out per co-teacher.** `teacher-availability.ts` and `drop-hints.ts` must check *each* teacher in a course's set and union the results. The `AvailabilityIndex` map shape stays `Map<single teacherKey, …>` (availability is authored per teacher); only the lookups loop.
   - **Hash shape change → one-time invalidation.** `teacherKey` scalar → sorted `teacherKeys` array changes the canonical JSON; all persisted `catalog_hash` values go stale once. Regenerate the fixed-digest test; keep code-point sort.
   - **Merge validation set-equality.** Merged children must share the same teacher *set*, not a single teacher.

3. **Junction over array is dictated by the clone invariant.** The whole schema's composite-FK design exists to make cloning safe and fail loud. A junction copy block is a tested pattern; an array forces element-wise remap that silently drops bad UUIDs — the exact regression `20260612090000` was written to prevent. RLS/grants for a new table are nearly free (auto-inherited grants; one explicit RLS policy).

4. **Atomicity for the multi-row write is a solved problem.** `replace_cohort_groupings` is the in-repo precedent for an atomic delete-then-reinsert of child rows; a `replace_course_teachers` RPC for `updateCourse` follows it directly and dodges the partial-write hazard.

5. **The violation/render edge is cleaner than students.** Each teacher violation still names exactly one teacher (`CollisionDetailsDialog` resolves `teacherNames[violation.teacherKey]` unchanged), so multi-teacher fans out into multiple single-teacher violations rather than bundling a set — no render-layer change.

## Historical Context (from prior changes)

- `context/archive/2026-06-13-teacher-availability/plan.md` — established the board-only constraint pattern (omit `test?` → excluded from the <200 ms enumeration), the storage-severity (`strong`/`soft`) vs render-severity (`block`/`warn`) split, the drag-hint precedence `blocked > partial > warn > free`, and the composite-FK teacher-child table (`teacher_availability`) that `course_teachers` should mirror. Availability is **plan-scoped and cohort-independent** — co-teaching inherits this (availability stays per-teacher).
- `context/archive/2026-06-20-dp1-dp2-cohort-naming/plan.md` — settled the cohort vocabulary (`dp1`/`dp2`, no `y1`/`y2` alias). Any new co-teaching filtering/display should use `COHORTS`/`cohortLabel()`, not legacy tokens.
- `context/archive/2026-06-10-teachers-catalog/research.md` — set the precedent that **assignment is authored only on the courses page; the teachers page is read-only** (no dual-write). Co-teaching authorship should stay on the courses page.
- `context/foundation/lessons.md` → "Port the mechanism, not the legacy type shape" reinforces modeling on the app's own domain types and keeping identity as opaque tokens (the `teacherKey`/`teacherKeys` approach). The Supabase grant lesson governs the new junction table's RLS/grant posture.

## Related Research

- This is the first research artifact for `co-teaching-teacher-sets`. Closest prior art: `context/archive/2026-06-13-teacher-availability/` and `context/archive/2026-06-10-teachers-catalog/`.

## Open Questions

All resolved during research — see [Decisions (resolved 2026-06-20)](#decisions-resolved-2026-06-20). For the record, the resolutions:

1. **Minimum teachers per course** → ≥1, **app-enforced** (`teacherIds.min(1)` + delete guard + seed abort); no hard cap. *(Decision 3, 6)*
2. **`updateCourse` write strategy** → **`replace_course_teachers` RPC** (atomic, mirrors `replace_cohort_groupings`). *(Decision 5)*
3. **Retire vs keep `courses.teacher_id`** → **drop it**; the `course_teachers` junction is the single source. *(Decision 2)*
4. **Per-teacher role on the junction** → **no role/ordering** — plain unordered set, symmetric teachers (cheap additive column later if needed). *(Decision 6)*
5. **Availability semantics for a set** → **per-co-teacher fan-out** (block/warn per unavailable teacher), not an aggregate "whole set unavailable" rule. *(Decision 6)*

## Follow-up Research 2026-06-20T20:40:00+0200 — hard "≥1 teacher, never null" invariant

**Question**: What changes if we introduce the rule that a course must have at least one teacher — `null` is no longer an option?

**Key framing**: The app layer *already* enforces this — `src/_pages/courses/model/schemas.ts:44` is `teacherId: z.uuid("A teacher is required")`, and the file docstring already flags the deliberate "app required, DB nullable" mismatch. In the co-teaching design this is simply `teacherIds: z.array(z.uuid()).min(1, …)`. So the create/edit/form path needs nothing beyond the array change already in the main impact map. The work is making the invariant *true at every other layer* — and the load-bearing change is **teacher deletion**, because today the FK relies on `ON DELETE SET NULL`, the exact behavior this rule forbids.

### What changes, by layer

1. **Teacher deletion (the load-bearing change).** Today `courses.teacher_id` is `ON DELETE SET NULL (teacher_id)` (`supabase/migrations/20260612090000_courses_teacher_composite_fk.sql:13-16`); `src/_pages/teachers/api/delete-teacher.ts` just deletes and leans on that SET NULL; `src/_pages/teachers/ui/DeleteTeacherDialog.tsx:43-45` says "Deleting will remove their assignment." Under a no-null rule, you cannot null a course on teacher delete. New per-course behavior:
   - Course is **co-taught** (≥1 *other* teacher) → removing this teacher is fine.
   - Teacher is the **sole** teacher of a course → deletion must be **blocked** (clear error: "only teacher on N course(s) — reassign or delete those courses first") or force re-staffing.
   This adds a real domain rule to `delete-teacher.ts` and rewrites the dialog copy. It is the single biggest behavioral change.

2. **DB-level enforcement (a design choice).** "Every course has ≥1 teacher" is an *aggregate* constraint (a `courses` row needs ≥1 matching `course_teachers` row) — not expressible as a plain FK/CHECK. Options:
   - **(a) Keep `courses.teacher_id NOT NULL` as a "lead" teacher**, junction holds only *additional* co-teachers. NOT NULL trivially guarantees ≥1; teacher FK becomes `ON DELETE RESTRICT` (block deleting a lead); co-teacher junction links cascade freely. Cheapest, no triggers — introduces a lead/co-teacher asymmetry.
   - **(b) Pure junction + a deferred constraint trigger** checking ≥1 junction row per course at commit. More machinery, and **the codebase has no trigger precedent** (it uses `security invoker` RPCs, e.g. `replace_cohort_groupings`).
   - **(c) App-layer only** — the DB *could* technically hold a teacher-less course via direct writes; enforce ≥1 in the action + delete guard. Lowest effort, weakest guarantee.

3. **Seed hardening.** `scripts/lib/catalog-transcode.mjs:348-365` emits `teacher_id = teacherMap.get(code) ?? null` for unmatched/missing codes. The generator (which already "aborts loudly on data inconsistencies") must **fail loudly** if any course resolves to zero teachers.

4. **Dead-code cleanup** (becomes unreachable, keep defensively or drop): the "no-teacher" warning in `src/shared/api/load-cohort-courses.ts:153` (`teacherKey === null`), the `"—"` fallback in `src/_pages/courses/ui/CourseTable.tsx:59`, and the `skipNullKeys`/null-guard branches in `src/_pages/plan-detail/model/constraints/teacher-conflict.ts`. The `missing-teacher` merge-validation reason (`src/_pages/courses/model/merge.ts:58-59,76`) is now guaranteed-true upstream but worth keeping as a defensive gate.

### Recommendation & the one decision

This resolves **Open Question #3**. If "≥1, never null" is a firm product rule *and* you want it DB-guaranteed, **option (a) — `teacher_id NOT NULL` lead + junction co-teachers — is the path of least resistance**: free ≥1 guarantee, natural `ON DELETE RESTRICT` "can't delete the lead", cascading co-teacher links. The cost is a lead/co-teacher distinction in the model (which may be *desirable* — a "responsible" teacher). If app-layer enforcement suffices, the pure-junction model from the main research stands, with the ≥1 guard in the delete action.

**The single decision that picks the path**: is there a meaningful **"lead teacher"**, or are co-teachers **fully symmetric**? Lead → (a). Symmetric + DB-guaranteed → (b). Symmetric + app-guaranteed → (c).
