---
change_id: users-page-roles
title: "S-406 Users page: list users and change roles, last-admin guard"
status: implementing
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
