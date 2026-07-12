---
date: 2026-07-12T18:19:28+0200
researcher: Dobromir Kropielnicki
git_commit: 8a4c96dcf9b50c916966af500707150aef6fa05a
branch: main
repository: ib-timetable-planner
topic: "Feasibility + domain-model/UI impact of bulk-changing course choices for multiple students"
tags: [research, codebase, students, student_choices, bulk-edit, groupings, validation]
status: complete
last_updated: 2026-07-12
last_updated_by: Dobromir Kropielnicki
---

# Research: Changing courses for multiple students at once

**Date**: 2026-07-12T18:19:28+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 8a4c96dcf9b50c916966af500707150aef6fa05a
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

> As a user, I'd like to change courses for selected students at once. For instance, first I'm checking which students have been assigned the Math SL. And for those, I will add TOK1 and ensure that none of them have TOK2.

Check the **feasibility**, the need for changes in the **domain model**, and the **UI** of implementing this user story. Scope agreed with the requester: trace the **full downstream ripple** of a bulk choice change, and design a **general bulk-edit toolkit** (add course set X AND/OR ensure-absent course set Y for a selected student set) — the literal story is its first instance.

## Summary

**The feature is highly feasible and largely additive. It needs no schema change.** The domain already models exactly what the story requires:

- The M:N record already exists: `student_choices (student_id, course_id, plan_id)`, uniquely keyed on `(student_id, course_id)`. "Add TOK1" = insert-if-absent; "ensure no TOK2" = delete-if-present. Both are naturally idempotent against the existing constraint. **No new columns, no new table.**
- The "filter to students who chose Math SL" half is **already built and tested** — `filterStudents(..., selectedCourseIds)` narrows by course-choice intersection.
- The per-student "add set / remove set" reconciliation already exists as a pure function — `diffChoices(current, next)`. A bulk apply is that function run per selected student.

What is **net-new** splits into three thin, well-precedented pieces:

1. **UI** — row multi-selection (a `Checkbox` column + select-all), a selection-count / bulk-action bar, and a bulk-edit dialog (two course pickers: add + remove). The `Table` primitive is already scaffolded selection-ready; the `MultiSelect` picker and the Dialog+RHF+Zod shell are directly reusable. The only new shared primitive is a `Checkbox` wrapper — and it needs **no new dependency** (the installed unified `radix-ui` package already exports `Checkbox`).
2. **Server mutation** — one new action `bulkEditChoices`, following the identical `defineDomainAction` → framework-free domain fn → typed client-wrapper recipe every other student mutation uses. Two persistence options (batched supabase-js writes vs. a new atomic plpgsql RPC); the RPC is the stronger convention fit for a multi-row set mutation and is directly precedented by `replace_course_teachers`.
3. **Consistency handling** — a bulk choice change makes the persisted `course_groupings` (S-06 palette suggestions) stale. **This is already handled for free** by the `catalog_hash` staleness banner. The genuinely under-served (but *pre-existing*, not new) risk the feature *amplifies* is **silent validation drift**: existing placements can become `student-conflict`-violating with no placement row changing and no proactive signal.

**Domain-model verdict: no changes required.** **Feasibility: green.** **Main design decisions:** (a) client-diff vs. atomic RPC for the write; (b) how to handle **mixed-cohort selections** (choices are cohort-scoped); (c) whether to proactively surface post-edit validation drift or rely on the existing lazy board-load check.

---

## Detailed Findings

### 1. Domain model & persistence — already sufficient

**`student_choices` is the authoritative M:N record and needs no change.** Current authoritative shape (original table [`20260602185012_minimal_domain_schema.sql:80-88`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/supabase/migrations/20260602185012_minimal_domain_schema.sql#L80-L88), re-parented to plans in [`20260611180006_plans_as_domain_root.sql:55-65`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/supabase/migrations/20260611180006_plans_as_domain_root.sql#L55-L65)):

- Columns: `id`, `student_id`, `course_id`, `plan_id` (denormalized), `created_at`. No `updated_at`, no trigger — junction rows are insert/delete only.
- **UNIQUE `(student_id, course_id)`** — unchanged by re-parenting. Makes "add if absent" a safe upsert/`on conflict do nothing`.
- Composite FKs `(plan_id, student_id) → students(plan_id, id)` and `(plan_id, course_id) → courses(plan_id, id)`, both `on delete cascade` — the DB itself guarantees a choice's student and course live in the *same plan*.
- `students.cohort` is a native enum (`'dp1' | 'dp2'`); `courses` also carry cohort. This drives the one real correctness constraint (below).

**How a single student's choices are edited today** ([`update-student.ts:18-56`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/students/api/update-student.ts#L18-L56)):
1. `assertChoicesInCohort(...)` — authoritative gate; every submitted course id must exist in the plan and match the student's cohort ([`assert-choices-in-cohort.ts:12-29`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/students/api/assert-choices-in-cohort.ts#L12-L29)).
2. Update the student row.
3. `diffChoices(current, next)` → `{ toAdd, toRemove }` (pure set diff, [`diff-choices.ts:8-18`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/students/model/diff-choices.ts#L8-L18)).
4. **Insert `toAdd` first** (catch `UNIQUE_VIOLATION` → `CONFLICT` for concurrent edits), **then delete `toRemove`**. The diff (not delete-all/insert-all) is *required* by the UNIQUE constraint; insert-before-delete keeps any mid-flight failure to a *visible superset*, never silent loss.

**Documented non-atomicity note (and why it's misleading for the bulk case).** The `update-student.ts:8-17` docblock says closing the partial-write window "needs a transaction, which the project rules out (no client transactions, no new Postgres functions)." **This is a stale, slice-local claim, not a project rule.** The migrations folder is full of plpgsql RPCs doing exactly this class of set-based mutation — the direct precedent is [`replace_course_teachers`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/supabase/migrations/20260620120001_replace_course_teachers_fn.sql#L1-L33), whose own docblock explains it exists *specifically* because a supabase-js delete+insert isn't atomic. Others: `place_course`, `apply_generated_placements`, `move_bundle_members`, `replace_cohort_groupings`, `clone_plan_*`. All are `security invoker` + `search_path = ''` + `public.`-qualified so RLS still gates the write. 30+ `.rpc(` call sites exist across `src/`.

**Verdict:** a bulk mutation needs **zero DDL**. Two persistence options (see §3d).

### 2. Students UI slice — selection-ready, high reuse

**How the catalog works today.** `src/pages/plans/[id]/students.astro` server-loads via `loadStudentCatalog` (4 parallel reads → `StudentRow[]` + `CourseOption[]`) and hydrates one island `<StudentCatalog client:load>`. The island is a thin orchestrator:

- **Filters** via `useCatalogFilters` (URL-synced: `?cohort=&q=&courses=`) — cohort tabs, search `Input`, and a **`CourseFilter` (`MultiSelect`)** that already filters students by chosen course (OR-semantics). The "check which students have Math SL" step is a solved, tested capability: [`filter-students.ts:9-24`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/students/model/filter-students.ts#L9-L24).
- **Per-student choice editing** — `StudentFormDialog.tsx` uses the shared `MultiSelect` bound to `choiceCourseIds`, scoped to the cohort and excluding merge-parents (`StudentFormDialog.tsx:54-60,134-144`). This is the reusable heart of the bulk dialog.
- **Table** — `StudentTable.tsx` is presentational (Name / Choices / # / Actions). No row-level selection state exists anywhere in the slice (grep-confirmed).

**What's missing (UI):** (1) a `Checkbox` column + header select-all with indeterminate state; (2) a selection-count / bulk-action bar; (3) a bulk-edit dialog with an *add-courses* picker and a *remove-courses* picker.

**Why it's a clean fit (no rewrite):**
- The shadcn `Table` primitive is **already scaffolded for selection** — `table.tsx` carries `[&:has([role=checkbox])]` head/cell styling and `TableRow` has `data-[state=selected]:bg-muted` (unused today).
- The island already follows "one hook per independent flow," so a new `useCatalogSelection` (ephemeral `Set<string>`, **cohort-scoped, reset on tab switch** — mirroring how the course filter resets) slots in beside `useCatalogFilters`/`useCatalogDialogs`.
- The bulk apply is pure and testable: run `diffChoices` per selected student (add = union add-picker, remove = subtract remove-picker) in `model/`.

**Insertion points:** selection hook `src/_pages/students/model/use-catalog-selection.ts`; bulk bar between the filter row and `Tabs` in `StudentCatalog.tsx`; checkbox `TableHead`/`TableCell` at the head/body row in `StudentTable.tsx`; new `src/_pages/students/ui/BulkChoiceDialog.tsx` cloning `StudentFormDialog.tsx`.

**New shared primitive:** a `Checkbox` wrapper (`src/shared/ui/checkbox.tsx`, ~30 lines, templated on `switch.tsx`, semantic-token styled). **No new dependency** — the installed unified `radix-ui` v1.6.0 package already exports `Checkbox`. Everything else (`MultiSelect`, `Dialog`, `Form`, `Button`, `Badge`, `Table`, `Tabs`) already exists in `src/shared/ui/`.

### 3. Server mutation — one new action, established recipe

**(a) Action wiring** — [`define-domain-action.ts:13-26`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/shared/lib/actions/define-domain-action.ts#L13-L26) composes `requireSession` → `requireSupabase` → `runDomain(() => domainFn(supabase, input))`. Register in [`src/_pages/students/api/actions.ts:7-11`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/students/api/actions.ts#L7-L11) as one new key `bulkEditChoices` — the top barrel `src/actions/index.ts` already spreads `...studentActions`, so no change there.

**(b) Client wrapper + schema sharing** — add `bulkEditChoices = (v) => callAction(actions.bulkEditChoices, v)` to `student-client.ts`. Add a `bulkChoiceInput` Zod schema beside `studentInput` in `model/schemas.ts`, shared by the action `input` (server gate) and the RHF resolver. Model it on the existing `choiceCourseIds` field (`z.array(z.uuid()).max(64).default([]).transform(dedupe)`) plus a non-empty selection (`studentIds: z.array(z.uuid()).min(1)`, mirroring `mergeInput`/`moveBundleMembersInput`). A cohort field is likely needed because the cohort gate is per-cohort.

**(c) How success reflects** — the students slice does **not** patch client state; `submitForm` runs `refreshPage()` (`navigate(pathname+search)`), re-running the Astro loader. A bulk edit reflects the same way — **no optimistic store needed**. (Optimistic patching with `callActionData` lives only in the plan-detail board.)

**(d) Two persistence options:**

| Option | What | Pros | Cons |
|---|---|---|---|
| **1 — Batched supabase-js** (no migration) | One `.upsert(rows, { onConflict: "student_id,course_id", ignoreDuplicates: true })` for adds (cartesian student×add-course) + one `.delete().in("student_id", ids).in("course_id", removeIds)` | No DDL, no type regen; `ignoreDuplicates` is supported (supabase-js ^2.108.2); stays consistent with the slice's current approach | Two non-atomic statements (same partial-write window the slice already tolerates); cohort gate must go per-student for mixed selections |
| **2 — New atomic plpgsql RPC** (recommended) | `bulk_edit_student_choices(p_plan_id, p_student_ids, p_add_course_ids, p_remove_course_ids)` — guarded `insert ... select` cross-join `on conflict do nothing`, then set `delete`, in one transaction; can enforce the cohort invariant in SQL | Fully atomic across all N students; one round-trip; server-authoritative cohort check; directly precedented by `replace_course_teachers` / `apply_generated_placements` | New migration + `supabase gen types` regen; integration-tested rather than unit-tested |

Because a bulk edit's blast radius is larger than a single student's superset, **Option 2 (RPC) is the stronger convention fit**; Option 1 is a valid lower-friction first cut.

**(e) Error translation** — domain fns throw `DomainError`; `runDomain` maps to `ActionError`; `submitForm` routes `isInputError` → per-field `setError`, a `conflictField`/`CONFLICT` → that field, else a global toast (same wiring as `StudentFormDialog.tsx:186-192`).

**Read-cap caveat:** the catalog loader refuses to render if the `student_choices` read hits its 2000-row cap (a truncated read would misclassify choices as removable — [`loader.ts:70-76`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/students/api/loader.ts#L70-L76)). A bulk add materially increases choice rows — keep the guard in mind at scale.

### 4. Downstream ripple — one stale artifact (already handled) + one amplified pre-existing risk

Every consumer reads `student_choices` through **one hinge**: the live catalog projection `loadCohortCourses`, which folds choices into each course's `studentKeys`. Nothing consumes raw `student_choices` for constraint logic.

**Auto-reflects (live-derived, rebuilt every load — no action needed):**
- The catalog projection / `studentKeys` — [`load-cohort-courses.ts:139-148,67,82`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/shared/api/load-cohort-courses.ts#L139-L148).
- **All constraint validation**, including `student-conflict`, which decides "these courses share students" purely from live `occupants[].studentKeys` — [`student-conflict.ts:19-30`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/entities/timetable/model/collision/constraints/student-conflict.ts#L19-L30).
- The read-only **student/teacher plan views** and the **generation engine input** — all read the live catalog, not the stored groupings.

**Stale (persisted derived data needing recompute) — but already handled:**
- **`course_groupings` + `course_grouping_members`** (S-06 palette suggestions). Each stored row carries a `catalog_hash`; after a bulk choice edit its hash no longer matches the new catalog. This is detected **lazily at plan-detail board load** by `isGroupingStale` ([`staleness.ts:14-33`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/plan-detail/api/staleness.ts#L14-L33)), surfacing a per-cohort "out of date" banner + manual Recompute. **No new invalidation code is required** — the bulk write gets this for free.

**The genuinely under-served risk (pre-existing, amplified — NOT new):** adding TOK1 to many students who already take a course sharing TOK1's slot creates new `student-conflict` violations **without any placement row changing**. There is **no re-validation trigger** — validation is computed live *only* when the plan-detail board island renders. So an existing plan can silently hold now-conflicting placements until someone opens its board. Worse, the read-only student/teacher views and the xlsx export **never run collision checks**, so those surfaces show the new choices with no warning.

**Is single-student edit already exposed to this? Yes.** `updateStudent`/`createStudent`/`deleteStudent` already mutate `student_choices` with **no** grouping recompute and **no** invalidation (grep-confirmed). The staleness relationship is therefore **pre-existing**; the bulk feature only makes an actual grouping/validation shift far more *likely* (many students at once).

Prior art: [`context/archive/2026-06-24-grouping-refresh-stale-version/research.md`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/context/archive/2026-06-24-grouping-refresh-stale-version/research.md) established the governing principles — "groupings are suggestions; placements are truth," validation is grouping-agnostic and always live, staleness is per-cohort and hash-based, and recompute is manual. It also records a still-open adjacent bug: a placement whose `course_id` is absent from its cohort's catalog is **defensively skipped** by `bucketByCell` ("cannot judge, skip defensively" — `collisions.ts:104`), so it can sit colliding yet render clean.

---

## Code References

- [`supabase/migrations/20260602185012_minimal_domain_schema.sql:80-88`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/supabase/migrations/20260602185012_minimal_domain_schema.sql#L80-L88) — original `student_choices` + UNIQUE `(student_id, course_id)`
- [`supabase/migrations/20260611180006_plans_as_domain_root.sql:55-65`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/supabase/migrations/20260611180006_plans_as_domain_root.sql#L55-L65) — re-parenting to plans + composite FKs
- [`src/_pages/students/api/update-student.ts:18-56`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/students/api/update-student.ts#L18-L56) — single-student insert-then-delete diff (the logic bulk generalizes)
- [`src/_pages/students/model/diff-choices.ts:8-18`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/students/model/diff-choices.ts#L8-L18) — pure add/remove set reconciliation (reuse per student)
- [`src/_pages/students/model/filter-students.ts:9-24`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/students/model/filter-students.ts#L9-L24) — existing filter-by-course-choice (the "who has Math SL" step)
- `src/_pages/students/ui/StudentFormDialog.tsx:54-60,134-144` — the reusable `MultiSelect` course picker (cohort-scoped, merge-parent-excluded)
- `src/_pages/students/ui/StudentTable.tsx` — presentational table; checkbox column insertion point
- `src/shared/ui/table.tsx` — `[role=checkbox]` / `data-[state=selected]` styling already present (selection-ready)
- `src/shared/ui/switch.tsx` — template for the new `Checkbox` wrapper
- [`src/shared/lib/actions/define-domain-action.ts:13-26`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/shared/lib/actions/define-domain-action.ts#L13-L26) — the action-wiring helper a `bulkEditChoices` action follows
- [`supabase/migrations/20260620120001_replace_course_teachers_fn.sql:1-33`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/supabase/migrations/20260620120001_replace_course_teachers_fn.sql#L1-L33) — atomic junction-replace RPC precedent (Option 2)
- `src/_pages/plan-detail/api/placements.ts:51-64,112-133` — `apply_generated_placements`: closest "one action mutates N rows across a set" precedent
- [`src/shared/api/load-cohort-courses.ts:139-148`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/shared/api/load-cohort-courses.ts#L139-L148) — the hinge: choices → live catalog `studentKeys`
- [`src/entities/timetable/model/collision/constraints/student-conflict.ts:19-30`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/entities/timetable/model/collision/constraints/student-conflict.ts#L19-L30) — shared-student collision derived live from choices
- [`src/_pages/plan-detail/api/staleness.ts:14-33`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/src/_pages/plan-detail/api/staleness.ts#L14-L33) — `catalog_hash` staleness (auto-handles stale groupings)

## Architecture Insights

- **Suggestions vs. truth.** `course_groupings` are cached *suggestions*; `placements` are *truth*, and there is deliberately no FK between them. This is what makes any choice/catalog change safe: it can only degrade palette fidelity (surfaced as a stale banner), never silently corrupt placement rows. Validation is always recomputed live over `placements` + current catalog.
- **The `student_choices` M:N + `diffChoices` + `filterStudents` triad already is the bulk-edit engine** at the single-student scale. The story is a fan-out of existing, tested pieces, not new domain logic.
- **Uniform mutation seam.** Every app-data mutation is a `defineDomainAction` (Zod input + framework-free domain fn) surfaced through a typed client wrapper; forms refresh via a loader re-run, not client patching. A new bulk action is greenfield *within* this uniform pattern — no new architectural surface.
- **Cohort is the one real constraint.** Choices are cohort-scoped (`assertChoicesInCohort`). A multi-select can span dp1 and dp2, so the bulk operation must either (a) reject/partition mixed-cohort selections, or (b) validate each add-course against each target student's cohort. Simplest UX: **bind selection to the active cohort tab** (which the existing filter already isolates), making the whole operation single-cohort by construction.
- **RPC-when-atomicity-matters is the house rule** — the "no Postgres functions" note in `update-student.ts` is a stale local remark contradicted by ~10 existing RPCs; adding one for a multi-row set write is idiomatic.

## Historical Context (from prior changes)

- [`context/archive/2026-06-24-grouping-refresh-stale-version/research.md`](https://github.com/dobrek/ib-timetable-planner/blob/8a4c96dcf9b50c916966af500707150aef6fa05a/context/archive/2026-06-24-grouping-refresh-stale-version/research.md) — established: groupings are suggestions, validation is grouping-agnostic and live, staleness is per-cohort/hash-based (chosen over timestamps because junctions are delete-reconciled with only `created_at`), recompute is manual (Option A: keep placements, refresh palette only). Also records the still-open "wrong-cohort placement defensively skipped" bug.
- `context/foundation/lessons.md` — relevant priors: **"Astro Actions are the single transport for app-data mutations and compute"** (thin orchestration; forms use RHF + shared Zod schema; API routes only for raw Request/Response) directly constrains how `bulkEditChoices` must be built; **"Re-create SQL functions from the latest live definition"** and **"Detokenize shadcn primitives on add"** apply if Option 2 (RPC) and the new `Checkbox` primitive are chosen; **"Use semantic theme tokens"** governs the new UI.
- `context/foundation/prd.md:443-456`, `context/foundation/roadmap.md:24` — the recommendation/grouping half is "unchanged in spirit"; the collision core is the protected part.

## Related Research

- `context/archive/2026-06-24-grouping-refresh-stale-version/research.md` — grouping staleness & recompute (the invalidation mechanism this feature relies on)
- (No prior research artifact exists specifically for student choices or bulk editing.)

## Open Questions

1. **Write strategy:** batched supabase-js writes (no migration, non-atomic, per-student cohort gate) vs. a new atomic `bulk_edit_student_choices` RPC (migration + type regen, atomic, server-side cohort gate). Recommendation: RPC, for the larger blast radius — decide at plan time.
2. **Mixed-cohort selections:** bind selection to the active cohort tab (single-cohort by construction, simplest) vs. allow cross-cohort selection with per-student cohort validation. Recommendation: bind to the active cohort tab.
3. **Validation-drift signal:** the feature amplifies (does not create) the risk that a bulk choice change makes existing board placements `student-conflict`-violating with no proactive warning. Is closing this in-scope (e.g. post-edit "N affected plans may now have conflicts — review boards"), or explicitly deferred as the pre-existing behavior? The grouping staleness itself is already covered.
4. **Operation set for the "toolkit":** the story needs add-set + remove-set. Should v1 also expose replace-course / bulk-remove-a-course as first-class, or model everything as one `{add, remove}` primitive and let the dialog present the two pickers? Recommendation: one `{add, remove}` primitive; other ops are presets over it.
5. **Undo / confirmation:** a bulk edit is higher-consequence than a single edit. Confirmation summary ("Add TOK1 to 23 students; remove TOK2 from 4 of them") before apply? No transactional undo exists today.
