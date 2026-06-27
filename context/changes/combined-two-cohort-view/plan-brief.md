# Combined Two-Cohort View (S-06) — Plan Brief

> Full plan: `context/changes/combined-two-cohort-view/plan.md`
> Research: `context/changes/combined-two-cohort-view/research.md`

## What & Why

Add the combined two-cohort view (the roadmap north star, US-01): a new `/plans/[id]/combined` route where an author assembles a collision-free DP1 | DP2 plan with both cohorts on screen at once, validated live across students, co-teaching, bi-weekly weeks, availability, and cross-cohort teacher occupancy — within the sub-200 ms budget. It's the final assembly stage the demo asked for and the only surface where the cross-cohort dimension is exercised end-to-end.

## Starting Point

The single-cohort board and the full enriched constraint core (S-02→S-05, S-07) already ship. Critically, the cross-cohort index is an **injected parameter** everywhere it's consumed and the pure transition core is **cohort-agnostic** — so this slice composes existing pieces rather than rewriting the core. Today the board is single-cohort, drag IDs aren't cohort-scoped, and the loader is asymmetric (one editable cohort + a static sibling snapshot).

## Desired End State

A header **Combined view** toggle opens a single **paired-column grid** — each day spans DP1 | DP2 sub-columns over shared period rows — both fully editable. Editing one column re-validates the other in the same render; a cross-cohort teacher clash shows on adjacent cells; cross-column drags are guarded (sibling cells dim, drop rejected). A single toggle palette and one shared cohort-tagged shelf serve both columns. The single-cohort boards are untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Layout | Paired-column (interleaved DP1\|DP2 per day) | Makes the cross-cohort constraint's related cells adjacent — the dimension the view exists to surface | Plan (conversation) |
| State ownership | Two `usePlacements` under one shell (not a new reducer) | Preserves the hook + its tests; live cross-index needs a both-seeing parent anyway | Research + Plan |
| Cross-cohort index | Derived live from the *other* column's placements | Combined view edits must re-validate both cohorts at once | Research (D1) |
| Drag scoping | Opt-in `cohort` on payloads/ids at a wrapper; `SlotCell`/`cellKey` stay blind | Honors the documented trap; single-cohort board stays unchanged | Research (D3) |
| Palette | Single panel + DP1/DP2 toggle (compact-first) | One affordance; active cohort doubles as the drag-target/dimming signal | Plan (D6) |
| Shelf | One shared drawer, DP1/DP2-tagged cards | Fits the single grid, preserves width; place-back routed by card cohort | Plan (D6) |
| Entry point | Header toggle beside CohortSwitcher | Discoverable where authors already switch cohorts | Plan |
| Op scope | Full editing parity (no "replace") | It's the assembly stage — no bouncing to single boards; replace is unbuilt today | Plan |
| Perf check | Informational pure-derivation measure, not a CI gate | Honors the team's anti-flaky-wall-clock convention while still asserting the budget | Plan |

## Scope

**In scope:** new route + symmetric loader; plan-level shell (two `usePlacements`, live cross-index, cohort-routed drop + guard); paired-column grid reusing `SlotCell`; toggle palette; shared tagged shelf; sibling-cell dimming; S-06 parity test, integration, e2e, perf measure; two housekeeping fixes.

**Out of scope:** touching the single-cohort board/route or the constraint core; any schema/migration; bundle "replace"; week-aware recommendation enumeration; a side-by-side layout; a hard CI perf gate.

## Architecture / Approach

A new `CombinedPlannerBoard` island owns one `DragDropProvider` and calls a new `useCohortBoardState` hook twice (composing the existing `usePlacements` + derivation hooks, leaving `PlannerBoard` alone). Each cohort's `CrossCohortIndex` is `useMemo`-derived from the *other* column's live placements via a new model-layer `projectFromPlacements` + existing `buildCrossCohortIndex`. A new `PairedPlannerGrid` interleaves each cohort's `SlotCell`s with opt-in cohort-scoped drag ids. A new `loadCombinedPlannerData` fetches each cohort once and builds each index from the other's placements.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundational seams | `projectFromPlacements` + opt-in cohort scoping on drag payloads/ids | Accidentally changing single-cohort drag behavior |
| 2. Loader + route | Symmetric `loadCombinedPlannerData` + `/combined` route + entry toggle | Redundant sibling double-fetch; loader asymmetry |
| 3. Orchestrator + grid | Working combined board: shell, live cross-index, guard, paired grid | Live-index render sequencing; dnd id collisions |
| 4. Palette + shelf | Toggle palette + shared tagged shelf with routed place-back | Place-back routed to wrong cohort |
| 5. Verify & harden | S-06 parity test, integration, e2e, perf, housekeeping | Holding <200 ms with both columns live |

**Prerequisites:** S-04 (cross-cohort constraint) and S-05 (bundle identity) — both done. No DB access changes; existing middleware covers the new route.
**Estimated effort:** ~4–5 sessions across 5 phases (Phase 3 is the largest).

## Open Risks & Assumptions

- **Live cross-index sequencing** — deriving each index from the other column's live placements has a one-batched-render staleness window for `duplicateBundle`'s sibling term; argued unobservable, documented as a Critical Implementation Detail.
- **Sub-200 ms with both columns** — re-proven by the informational perf test + manual DevTools; cross-cohort/availability constraints stay out of the drag fast path, so risk is low.
- **Assumption:** holding the cross-cohort guard at the drop handler (plus cohort-scoped ids) is sufficient — server RPCs are already single-cohort, so a slipped cross-cohort write can't persist.

## Success Criteria (Summary)

- An author assembles a complete, collision-free DP1 | DP2 plan in the combined view (US-01), with cross-cohort clashes flagged live and cross-column moves prevented.
- The S-06 parity, integration, and e2e suites pass; the perf measure stays within budget; `/verify` is green.
- The single-cohort boards and the constraint core are demonstrably unchanged.
