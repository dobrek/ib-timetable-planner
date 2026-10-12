---
change_id: give-integration-lane-a-signed-in-client-per-role
title: Give integration lane a signed in client per role
status: archived
created: 2026-10-12
updated: 2026-10-12
archived_at: 2026-10-12T14:30:49Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Roadmap ID: F-401** (split out of S-403 on 2026-10-12). This change implements health-check Fix 1's harness half; S-403 keeps role assignment and the expectation flip.
- **Decision (2026-10-12):** Option 1 from `research.md`: ship the harness plus a characterization role matrix that pins today's posture. No migration and no schema.
- GitHub (2026-10-12): F-401 is [#155](https://github.com/dobrek/ib-timetable-planner/issues/155) and F-402 is [#156](https://github.com/dobrek/ib-timetable-planner/issues/156). #144 (S-403) now depends on #155 and keeps only role assignment and the matrix flip; #150 (S-409) depends on #156; tracker #153 lists both.
- **Out of scope here: CI key format.** Switching `SUPABASE_KEY` from the legacy anon JWT to `sb_publishable_…` and pinning the Supabase CLI are roadmap item **F-402** (`ci-publishable-key-and-pinned-cli`), added 2026-10-12. This harness reads the key through `readPublishableKey()`, so it works with either key format.

## Deny drill (2026-10-12)

The role matrix has been shown to fail, for the right reason. Scripts: `drill/deny-authenticated.sql` and `drill/restore.sql`, run against the local stack only (local Supabase CLI 2.117.0) at commit `968c4e4`.

- **Applied:** the restrictive policy `"f401 drill: deny authenticated"` (`using (false) with check (false)`) on all 16 public tables. Grants, `anon`, `service_role` and the solver were untouched; `solver_job_writer` is not a member of `authenticated`.
- **Red, 32 of 69:** exactly the `noRole` cells: 16 reads, 15 writes and `clone_plan`. Every one failed with `expected 'denied' to be 'allowed'`.
- **Green, 37 of 69:** all 32 `anon` cells, the catalog check (grants unchanged), the fixture check and the 3 token sanity rows.
- **Red for a different reason:** none. No probe threw: no non-access error, no partial visibility, no contradiction, no failed read-back. So the probe classified all four denial shapes (an empty SELECT, a 0-row UPDATE or DELETE, an INSERT 42501 including `place_course`'s, and `clone_plan`'s P0001) as `denied`. The two RPC shapes were confirmed directly, as `authenticated` with the drill policy applied inside rolled-back transactions: `clone_plan` raised `P0001: clone_plan: source plan … not found`, and `place_course` raised `42501: new row violates row-level security policy "f401 drill: deny authenticated" for table "bundles"`.
- **Restored:** `restore.sql` left 0 `f401 drill%` policies in `pg_policies`, and the matrix re-ran green, 69 of 69.
