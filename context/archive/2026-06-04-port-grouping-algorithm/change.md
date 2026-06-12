---
change_id: port-grouping-algorithm
title: Port grouping algorithm
status: archived
created: 2026-06-04
updated: 2026-06-12
archived_at: 2026-06-12T10:28:00Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Dev seed deviation**: the plan named `supabase/seed-dp2.sql` / `scripts/seed-dp2.ts`; implemented instead as `scripts/gen-seed.mjs`, which generates `supabase/seed.sql` from both dp1 and dp2 fixtures. Same intent (seed the local stack for the dual-adapter cross-check), broader scope.
