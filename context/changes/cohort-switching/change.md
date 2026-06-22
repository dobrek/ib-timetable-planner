---
change_id: cohort-switching
title: Cohort switching
status: implementing
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Decisions

- **2026-06-22 — Cross-cohort validation context: eager-load-both (DECIDED).** S-04 loads both cohorts' placements at SSR time and projects the sibling cohort to a week-rich teacher-occupancy index, rather than fetching the other cohort's occupancy on demand. Rationale: (1) per-drag validation stays a pure in-memory lookup, preserving the <200 ms budget — an on-demand round-trip inside the drag loop cannot meet it; (2) makes S-06 (combined view) a reuse, not a rewrite — the index shape and symmetric rule don't change, S-06 only swaps the sibling's committed snapshot for the other column's live state. Resolves the S-04 open unknown in `roadmap.md:128-129`. See `research.md` Open Questions #1.
  - **Watch-items carried into `/10x-plan`:** sibling index must be week-rich `Map<teacherKey, Map<cellKey, Set<PlacementWeek>>>` (NOT the week-agnostic availability-index shape) and reuse `weeksDisjoint`; expand each sibling placement to all `teacherKeys` (co-teaching); project the index **server-side** in `load.ts` and ship only the index (not full sibling objects); keep S-04 cohort switch as navigate/remount so the sibling snapshot can't go stale. The dual-live-store case is deliberately deferred to S-06.
