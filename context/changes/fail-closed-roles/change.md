---
change_id: fail-closed-roles
title: S-403 fail-closed roles: authors keep access, role-less users see no access
status: implementing
created: 2026-10-28
updated: 2026-10-28
archived_at: null
---

## Notes

as taks S-403 from roadmap

## Implementation decisions

- **2026-10-28 — the access model lives in `src/shared/config/`, not `src/shared/lib/access/`.** `src/shared/lib/` already holds 15 top-level modules, and steiger's `fsd/shared-lib-grouping` (threshold 15, a CI gate under `--fail-on-warnings`) fails at 16. The `extract-share-polling-store` precedent says to surface this rather than regroup drive-by, and relaxing the gate is out. `shared/config/cohorts.ts` is the precedent for a generated-enum projection with small pure helpers beside it, and `nav.ts`, which Phase 4 makes capability-aware, already lives there. So `AppRole` (Phase 1) and Phase 4's `capability.ts`, `access-state.ts`, `resolve-access.ts` and `role-gate.ts` are flat files in `shared/config/`, exported through `@/shared/config`. Only the location changes; the plan's contracts stand.

## Deny drill

- **Date:** 2026-10-28, local stack (Supabase CLI 2.117.0), on the Phase 2 schema: migration 1 applied, `20261028200630_fail_closed_policies.sql` not yet applied (22 `public` policies).
- **Command:** `pnpm test:integration src/test/role-matrix.integration.test.ts`, with the flipped `role-matrix-expectations.ts`.
- **Result: red, 51 of 247 failed**, and only on what the flip changed. The expectations diff flips exactly 49 cell values from `allowed` to `denied` (comments excluded: 153 → 104 `allowed`, 67 → 116 `denied`). Each of the 49 cells failed as "expected allowed to be denied". No setup failure, and no non-access error.
  - **Structural (2):**
    - `catalog: every plan-scoped table holds exactly the four capability policies, and no other`
    - ``catalog: no policy that authenticated or PUBLIC falls under is a literal `true` ``
  - **noRole (33):**
    - `SELECT` on all 16 plan-scoped tables (bundles, course_grouping_members, course_groupings, course_merges, course_overlaps, course_teachers, courses, generation_jobs, placements, plans, shelf_bundle_courses, shelf_bundles, student_choices, students, teacher_availability, teachers);
    - `SELECT others profiles row`;
    - `INSERT` / `UPDATE` / `DELETE` on plans, courses, students, placements and generation_jobs (15);
    - `RPC clone_plan`.
  - **viewer (16):** `INSERT` / `UPDATE` / `DELETE` on plans, courses, students, placements and generation_jobs (15), and `RPC clone_plan`.
  - **anon, author, admin:** 0. The author and admin columns did not move.
- **Green rerun, after migration 2** (`pnpm exec supabase db reset`, with all post-conditions passing; 70 `public` policies over 18 tables): the same command gives **247 / 247**. The full integration lane, with the native solver up, gives 39 files and 466 tests. `pnpm test:e2e` gives 48 / 48, with a freshly provisioned `author`.
