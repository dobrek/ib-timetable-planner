---
change_id: users-page-roles
title: "S-406 Users page: list users and change roles, last-admin guard"
status: implemented
created: 2026-11-03
updated: 2026-11-05
archived_at: null
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
