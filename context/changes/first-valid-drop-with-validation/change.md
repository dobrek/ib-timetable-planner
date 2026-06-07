---
change_id: first-valid-drop-with-validation
title: First valid drop with validation
status: impl_reviewed
created: 2026-06-05
updated: 2026-06-07
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Accepted risks

- **Placements API tenancy/IDOR (accepted for S-01, 2026-06-07).** `POST /api/placements` trusts client-supplied `variant_id`/`cohort_id`/`course_id` with no relationship check, and `DELETE /api/placements` removes by row `id` alone — so any authenticated user could read/delete any placement by UUID. This is consistent with the documented MVP posture: RLS grants full access to the `authenticated` role and S-01 assumes a single trusted author. Multi-tenant authz (a `user → plan` ownership relation enforced via RLS or an explicit join) is deferred; revisit before opening the planner to multiple school staff. (Impl-review F3.)
