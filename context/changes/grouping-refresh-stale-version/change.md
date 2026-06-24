---
change_id: grouping-refresh-stale-version
title: Grouping refresh stale version
status: impl_reviewed
created: 2026-06-24
updated: 2026-06-24
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Research: `research.md` — feature is mostly built (`catalog_hash` + `isGroupingStale` + idempotent `computeGroupings`/`replace_cohort_groupings`); only UI wiring is missing. Historically the deferred "S-06" recompute/staleness slice.
- Decisions (2026-06-24): keep placements on recompute (Option A); palette-scoped stale notice + inline Recompute button; manual trigger only; reuse the catalog `loadPlannerData` already loads (no double-fetch).
- Deferred out of scope → **separate change candidate**: cohort-move orphaned placements (placement under old cohort whose course left that catalog is silently skipped by `collisions.ts:88-89` — shows clean while colliding). Pre-existing bug, independent of grouping refresh.
- Follow-up (deferred, Option B from planning): fuller palette-view consolidation — extract a `PaletteColumn` component that owns all three states (empty/stale/ready) and always render the grid + summary bar, so the empty state becomes the left column over an empty grid. This change took Option A (unify the _decision_ via `resolvePaletteView`, keep the two page layouts) to avoid changing empty-state UX. Revisit if/when the empty state should share the grid frame, or the next palette state lands.
