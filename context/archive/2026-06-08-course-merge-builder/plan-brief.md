# Course Merge Builder — Plan Brief

> Full plan: `context/changes/course-merge-builder/plan.md`
> Research: `context/changes/course-merge-builder/research.md`

## What & Why

Close the loop on S-02 (FR-003) by shipping the **merge builder** deferred from the Course Catalog slice. Authors need a way to compose 2+ atomic child courses into a virtual composite "merge parent" (e.g. `Spanish B SL+HL`) so the timetable's combined-session model can be authored in the UI rather than only seeded.

## Starting Point

The merge **domain model is already settled** and the read path + grouping algorithm already consume merges correctly: a parent is a 0-choice virtual course holding the derived composite level, shared teacher, and an authored weekly-hours value; children are atomic, student-chosen courses. The grouping adapter builds virtual courses from this exact shape (`src/lib/grouping/adapters/supabase.ts:45-58`). What's missing is purely the **authoring UI + a thin mutation layer** — there is **no migration** and no algorithm change.

## Desired End State

From `/courses`, an author can click **New merge** to pick children and confirm a composite parent (derived name/level/teacher shown read-only, hours entered), and use **Manage merge** on a merged row to edit its hours or dissolve it (which removes the links + orphan parent, keeping children). Catalog filters also survive the post-mutation reload.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Presentation | Option A only (builder dialog + kebab) | Smallest slice that closes S-02's loop; flat "Merged" badge stays | Research |
| Child sharing | Many-to-many allowed | Matches seed data + `unique(parent,child)`-only schema | Research |
| Teacher | Single shared teacher required, derived | Matches every seed family + grouping's `parent.teacher_id` read | Research |
| Dissolve | Deletes the orphan parent too | No stray composite rows linger | Research |
| Child picker UI | Popover + command (TeacherFilter style) | Reuses existing searchable multi-select verbatim; no net-new primitive | Plan |
| Manage-merge scope | Dissolve + edit hours (no membership change) | Smallest slice; avoids re-derive-on-membership complexity | Plan |
| Atomicity | Best-effort insert + compensating cleanup | Honors "no migration"; deletes orphan parent on link failure | Plan |
| Parent name | Auto-derived & locked; require shared base name | Matches seed; name + level are controlled outputs, never typed | Plan |
| Post-mutation refresh | `navigate()` reload | Matches create/edit/delete; parent is a brand-new row | Plan |
| Filter state | Persist cohort/teacher/hide-merged in URL | Fixes the reload reset for the whole catalog, not just merge | Plan |

## Scope

**In scope:** `mergeInput` schema + pure derivation/validation module (unit-tested); `createMerge`/`dissolveMerge`/`updateMergeHours` actions; read-path child-id projection; the builder dialog + "New merge" button; the "Manage merge" dialog (hours + dissolve); URL-backed catalog filter state.

**Out of scope:** any migration / Postgres RPC; algorithm/validator/placement changes; membership editing (add/remove children); Option C nested presentation; auto-zeroing child hours; cross-subject merges.

## Architecture / Approach

Bottom-up: a pure tested `src/lib/courses/merge.ts` derivation module is the single source of truth for the composite name/level/teacher and validation, used by both the dialog's live preview and the server action. Actions mirror `createOverlap`'s same-cohort pattern; `createMerge` re-validates server-side, inserts the parent then the links, and deletes the parent if any link insert fails (orphan-parent guard). The UI reuses `TeacherFilter` (picker), `CourseFormDialog` (RHF + `navigate()`), and `DeleteCourseDialog` (dissolve confirm).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Merge domain core | Pure derivation + validation helpers + `mergeInput` schema + unit tests | Composite-level ordering drift between preview and stored value |
| 2. Server mutation + read path | 3 actions (with cleanup) + child-id projection onto parent rows | Orphan parent on partial-write failure |
| 3. Merge builder dialog | Picker + live preview + hours + "New merge" button | Preview/derivation mismatch; candidate filtering |
| 4. Manage merge | Kebab → edit hours + dissolve confirm | Dissolve cascade correctness (children must survive) |
| 5. Filter-state persistence | URL-backed cohort/teacher/hide-merged | Unknown ids in URL; client/server hydration edge |

**Prerequisites:** None beyond current `main` (S-02 catalog merged). Local Supabase stack for manual verification.
**Estimated effort:** ~2–3 sessions across 5 phases; mostly UI + thin mutations, no migration.

## Open Risks & Assumptions

- **Atomicity is best-effort, not transactional** — a process crash strictly between parent insert and link insert could orphan a parent (rare; recoverable via dissolve). Accepted to honor "no migration".
- Assumes selected children always share a base name in practice (no cross-subject merge exists in seed data); the builder blocks otherwise.
- Phase 5 touches shared catalog code (create/edit/delete benefit too) — a slightly wider blast radius than the merge feature alone.

## Success Criteria (Summary)

- An author can create a composite merge from the UI and it appears (badged) and is picked up by the grouping algorithm with no code change.
- Dissolve removes the parent + links while leaving the atomic children intact; a failed create leaves no orphan parent.
- Catalog filter state (cohort, teacher, hide-merged) survives every catalog mutation's reload.
