---
change_id: bundle-holding-container
title: Bundle holding container
status: implemented
created: 2026-06-26
updated: 2026-06-26
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Post-implementation review refinements (PR #62)

Author review of the shipped feature surfaced six follow-ups, all addressed on the PR branch:

1. Shelf drawer now scrolls (bounded height) so parked cards past the fold stay reachable.
2. Parked card dropped the redundant "N courses" header; it is now **week-aware** (A/B summary badge + per-member week tag). Student-count was considered but skipped to keep the card decoupled from the validation catalog (author's call).
3. A palette grouping (or promoted single course) can be parked **directly** by dragging it onto the shelf — new `shelve_courses` RPC + `parkMembers` verb (no board round-trip).
4. The collapse button is disabled while the drawer is pinned (was a confusing silent no-op).
5. ~~Parking a course-set already on the shelf notifies instead of duplicating~~ — **reverted after user testing**: dropping an already-parked bundle intentionally parks a second copy (duplicates). The dedup guard + toast were removed.
