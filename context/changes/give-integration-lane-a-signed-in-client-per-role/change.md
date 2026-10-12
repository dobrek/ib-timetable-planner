---
change_id: give-integration-lane-a-signed-in-client-per-role
title: Give integration lane a signed in client per role
status: implementing
created: 2026-10-12
updated: 2026-10-12
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Roadmap ID: F-401** (split out of S-403 on 2026-10-12). This change implements health-check Fix 1's harness half; S-403 keeps role assignment and the expectation flip.
- **Decision (2026-10-12):** Option 1 from `research.md`: ship the harness plus a characterization role matrix that pins today's posture. No migration and no schema.
- GitHub (2026-10-12): F-401 is [#155](https://github.com/dobrek/ib-timetable-planner/issues/155) and F-402 is [#156](https://github.com/dobrek/ib-timetable-planner/issues/156). #144 (S-403) now depends on #155 and keeps only role assignment and the matrix flip; #150 (S-409) depends on #156; tracker #153 lists both.
- **Out of scope here: CI key format.** Switching `SUPABASE_KEY` from the legacy anon JWT to `sb_publishable_…` and pinning the Supabase CLI are roadmap item **F-402** (`ci-publishable-key-and-pinned-cli`), added 2026-10-12. This harness reads the key through `readPublishableKey()`, so it works with either key format.
