---
change_id: extract-share-polling-store
title: Hub-badge eviction, then the shared polling-store factory (F6)
status: impl_reviewed
created: 2026-08-31
updated: 2026-09-01
archived_at: null
---

## Notes

@context/archive/2026-08-25-drift-decided-delivery/follow-ups/review-fixes.md

Scope widened 2026-08-31 (research): F6 (the polling-store factory) plus the proposal
provenance note — when it should stop being visible. See `research.md`.

Narrowed again the same day: the deletion-integrity defects the research turned up were split
into `context/archive/2026-08-31-generation-deletion-integrity/` (a delivered proposal's deletion flips its
job to `failed`; a stale-running source's deletion strands the clone pending). They share no code
with either half of this change, and neither is fixed by an acknowledgement.

Impact-checked 2026-09-01 after `generation-deletion-integrity` shipped and was archived. F6 is
unaffected; three provenance findings narrowed and open question 3 largely closed; one residual
defect from that change (the hub badge's `merge` eviction gap) lands in this change's F6 scope.
See the follow-up section in `research.md`.

Scoped 2026-09-01 for planning: **two phases — the eviction fix first, then F6.** The provenance
note is PARKED (own change later); Q2 was decided in passing — acknowledged hides the strip
entirely, which means that change must re-ground FR-308 rather than re-word it. See the
"Decisions 2026-09-01" section in `research.md`.

Phase 1 adaptation 2026-09-01 (found at the manual gate, in preview): the store-side eviction was
correct and polling stopped, but the badge stayed on screen. `PlansHub.indicatorsFor` fell back to the
row's SSR'd `plan.indicators` whenever the live snapshot had nothing for that row — which under
union-merge was unreachable and under replace semantics resurrects the badge the poll just evicted, on
the very next render. Since the store is SEEDED from exactly those indicators, the fallback could
never add anything anyway. Phase 1 therefore also extracts the helper to
`model/row-indicators.ts` (`indicatorsForRow`, pure + unit-tested) with both `plan.indicators`
fallbacks removed, so the poll's snapshot is the single input to what each row renders.
