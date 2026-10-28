---
change_id: fail-closed-roles
title: S-403 fail-closed roles: authors keep access, role-less users see no access
status: implemented
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

## Browser verification of Phase 4's manual rows (Playwright, local)

On 2026-10-28, on `pnpm build && pnpm preview` (workerd) against the local stack after migration 2. A throwaway account `manual-s403@example.test` was created through the admin API, roles were changed with `scripts/assign-role.mjs`, and everything was deleted afterwards. **This is evidence for the human sign-off.** The Progress rows 4.7–4.10 stay unchecked until a human confirms them.

- **4.7, role-less** (`playwright-cli`):
  - `/dashboard` shows "No access yet — ask your admin", with a link to the account page. The Primary nav holds only Home: no Plans, no tiles.
  - `/plans`, `/plans/<random uuid>` and `/plans/<random uuid>/courses` all land on `/dashboard`.
  - `/account` saves a display name ("Display name saved.", and the `profiles` row is written) and changes the password ("Password changed.").
  - Sign-out lands on `/auth/signin`, and `/dashboard` then redirects there. Signing in with the new password works.
- **4.8, author:** promoted with `assign-role.mjs … author`. The next reload shows Plans in the nav and tiles. Creating a plan and cloning Seed Plan A both work. A group drag landed in 283 ms, the stepped-drag gesture included.
- **4.9 and 4.10, viewer, live role change** (a scripted Playwright run over `e2e/support` helpers):
  - Demoted to `viewer` from the shell, with the board still open and no sign-out. The next drag showed "You don't have permission to do that." and the optimistic move rolled back. A reload showed nothing changed.
  - Renaming the plan as viewer was refused with the same message, and the name was unchanged after a reload.
  - Promoted back to `author`, the next drag landed and survived a reload.
