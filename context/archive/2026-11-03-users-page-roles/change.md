---
change_id: users-page-roles
title: "S-406 Users page: list users and change roles, last-admin guard"
status: archived
created: 2026-11-03
updated: 2026-11-06
archived_at: 2026-11-06T14:23:16Z
---

## Notes

as S-406 from @context/foundation/roadmap.md

- 2026-11-05: Progress 1.2 (`supabase db reset`) is deferred, by the user's decision, to the end of
  Phase 2. One reset then covers all three new migrations, so the local admin account and the solver
  machine user are re-provisioned once. Until then, local migrations are applied with
  `pnpm exec supabase migration up --local`, which keeps local data.
- 2026-11-05: done. The reset ran at the end of Phase 2 over all three migrations, which satisfied
  both 1.2 and 2.2.
- 2026-11-05: Phase 4 found that a toast followed by `refreshPage()` never shows. No layout mounts
  Astro's `<ClientRouter />`, so `navigate()` falls back to a full page load (`location.href`). That
  is true app-wide (`useConfirmAction`, `submitForm`). By the user's decision, the Users page keeps
  the page on the last-admin refusal, so its message stays and the picker reverts locally. Success,
  `NOT_FOUND` and `FORBIDDEN` keep the repo's toast-then-reload, so the updated row, not a toast, is
  the feedback there, and manual check 4.6 and the Phase 5 spec assert the row. Follow-up, outside
  S-406: carry a toast across the reload, or mount `<ClientRouter />`, for every page.
- 2026-11-05: Phase 5's `lessons.md` entry (BEFORE/AFTER trigger depth in a cascade, BEFORE INSERT
  under upsert) was skipped by the user's decision. The rule is recorded in CLAUDE.md § Database &
  auth instead.
- 2026-11-06: impl-review F1. The cascade exemption in `guard_last_admin()` and
  `record_role_change()` now also requires the user's `auth.users` row to be gone. Depth alone
  (the plan's `pg_trigger_depth() > 1`) let a DELETE issued from another trigger remove the last
  admin with no refusal and no record, as a rolled-back probe showed. The migration was edited in
  place, since it is not yet on `main`. A post-condition asserts that the owner of `user_roles` may
  read `auth.users`, and the guard suite gained a nested-DELETE case.
- 2026-11-06: impl-review F8. Recorded after the fact, these are justified deviations from the
  plan:
  - **The `user_roles` SELECT policy.** The plan asked for a second policy, "Admins read every
    role". Instead, `20261105080343_role_management.sql` widens S-403's own-row policy in place to
    `user_id = auth.uid() or can_manage_users()`, using `alter policy`, and renames it "Users read
    their own role, admins every role". The reason: two permissive SELECT policies trip the
    `multiple_permissive_policies` advisor WARN, which would have failed criterion 2.7. Nothing is
    dropped. `USER_KEYED_POLICIES` pins the new shape.
  - **The directory count.** The plan's global `count(user_directory) = count(auth.users)` is a
    per-file check in `user-directory.integration.test.ts`: each user created there has exactly
    one row. The reason is that the role matrix's INSERT probe deletes directory rows in parallel.
    The migration's post-condition still proves the global count.
  - **The plan's simulated-session wording.** Testing Strategy (plan.md:795) says every refusal
    runs both as the owner and as a simulated admin session. The phase contract (:434) says to
    repeat one case. The guard suite follows the phase contract.
