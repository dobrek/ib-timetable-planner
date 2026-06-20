# Co-teaching Teacher Sets — Plan Brief

> Full plan: `context/changes/co-teaching-teacher-sets/plan.md`
> Research: `context/changes/co-teaching-teacher-sets/research.md`

## What & Why

A course currently has exactly one (nullable) teacher. This change makes a course **co-taught by a set of equal teachers** — every co-teacher must be available in a placed slot, and each is checked for double-booking. It mirrors how the system already models a *set* of students per course, so the riskiest layers become near-copies of proven, budget-tested code.

## Starting Point

`courses.teacher_id` is a single nullable composite FK. The constraint core already carries `studentKeys: string[]` next to the scalar `teacherKey`, the catalog hash serializes that scalar, authorship is a single `<Select>` on the courses page, and teacher deletion leans on `ON DELETE SET NULL`. There is no teacher/course-authoring E2E coverage today.

## Desired End State

A course carries 1+ equal teachers stored in a `course_teachers` junction (the `teacher_id` column is gone). Authors pick teachers via a multi-select; the table shows teacher chips. The board flags a double-booking when co-placed courses share any teacher, and an availability warning names *each* unavailable co-teacher. Deleting a sole teacher is blocked (with the orphaned courses surfaced); deleting one of several co-teachers just drops the link. Merging requires identical teacher sets. A fresh seed contains real co-taught courses, and Playwright proves the authoring round-trip + delete-guard.

## Key Decisions Made

| Decision                         | Choice                                              | Why (1 sentence)                                                              | Source   |
| -------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Teacher relationship             | Symmetric set, no lead                              | No product need for a "primary"; a role column is a cheap additive later.     | Research |
| Persistence                      | Pure `course_teachers` junction; drop `teacher_id`  | Composite-FK junction keeps clone fail-loud; arrays silently drop bad UUIDs.  | Research |
| ≥1-teacher invariant             | App-enforced (`.min(1)` + delete-guard + seed abort)| Matches the codebase's RPC/app-guard style — no trigger precedent exists.     | Research |
| `updateCourse` write             | `replace_course_teachers` RPC (atomic)              | Mirrors `replace_cohort_groupings`; avoids partial-write zero-teacher hazard. | Research |
| Merge validation                 | Teacher-*set* equality                              | Co-taught children must share the same set, not a single teacher.             | Research |
| E2E scope                        | Authoring round-trip + delete-guard block           | Covers the new UI write path + biggest behavioral change; board stays unit-tested. | Plan |
| Seed data                        | Add a few co-taught courses                          | Feature is demonstrable on a fresh `db reset`; E2E/manual have real data.      | Plan     |
| Teacher cap                      | None (no hard or soft limit)                        | Self-correcting; keeps the form simple.                                       | Plan     |
| Catalog-hash invalidation        | Self-heal (regenerate fixed-digest test only)       | Existing recompute paths refresh stale hashes; no prod data to protect.        | Plan     |

## Scope

**In scope:** junction table + `replace_course_teachers` RPC + clone block; `teacherKey`→`teacherKeys[]` across the constraint core, catalog hash, drop-hints, and availability fan-out; courses write/form/table/loader; teachers reverse-lookup + sole-teacher delete-guard; merge set-equality; seed fixtures + generator; legacy column drop; E2E specs.

**Out of scope:** lead/primary teacher or a `role` column; DB trigger for ≥1; teacher count cap; `uuid[]` array storage; explicit hash-recompute migration; board-level drag-drop E2E; client-side update diff.

## Architecture / Approach

The teacher set rides the existing student-set machinery: `teacher-conflict` becomes a set-intersection copy of `student-conflict`, the board load path aggregates `teacherKeys` from the junction the way `studentKeys` is aggregated from `student_choices`, and the hash sorts the array like it already sorts students. The one departure with no student analog — availability — fans out per co-teacher. Writes use the two in-repo atomicity precedents (`writeParentWithLinks` on create, the `security invoker` replace-RPC on update). Sequencing is **additive-first, drop-last** so each phase ends on a green gate.

## Phases at a Glance

| Phase                                   | What it delivers                                        | Key risk                                                       |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Persistence foundation               | Junction table, replace-RPC, clone block (additive)     | Clone-RPC remap correctness; keeping the build green          |
| 2. Constraint core + read path + hash   | `teacherKey`→`teacherKeys[]`, junction-sourced board    | The one breaking type change; hash fixed-digest regen         |
| 3. Courses authorship & UI              | Multi-select, write path, table chips                   | Atomic update via RPC; RHF-array binding in a Dialog          |
| 4. Teachers page, delete-guard, merge   | Reverse-lookup, sole-teacher guard, set-equality merge  | Delete-guard is the biggest behavioral change                 |
| 5. Seed fixtures & generator            | Co-taught seed + abort-on-zero                          | Byte-stable seed (fixed `randomUUID` order)                   |
| 6. Legacy cleanup                       | Drop `teacher_id` + dead null-handling                  | Catching every dangling reference before the drop             |
| 7. E2E                                  | Authoring round-trip + delete-guard specs               | Flaky UI selectors; entity teardown                           |

**Prerequisites:** local Supabase running; `pnpm env:local`. Builds directly on the resolved research doc.
**Estimated effort:** ~4–6 implementation sessions across 7 phases (Phase 2 is the heaviest).

## Open Risks & Assumptions

- Assumes the research's resolved decisions stand (symmetric, pure junction, app-enforced ≥1).
- The one-time catalog-hash invalidation is assumed cosmetic and self-healing — no prod data exists to contradict this.
- The destructive column DROP (Phase 6) intentionally deviates from the additive-migration guideline; acceptable pre-prod.

## Success Criteria (Summary)

- An author can co-teach a course and see/validate the whole teacher set on the board within the <200ms drag budget.
- The ≥1-teacher invariant holds at every layer (form, delete-guard, seed) without a DB trigger.
- `pnpm build`, `test`, `test:integration`, `test:e2e`, `lint`, `steiger` all green; a fresh seed shows co-taught courses.
