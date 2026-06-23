# Cohort Switching (S-04) — Plan Brief

> Full plan: `context/changes/cohort-switching/plan.md`
> Research: `context/changes/cohort-switching/research.md`

## What & Why

Unlock free DP1/DP2 cohort switching on the planner board and add a **symmetric, week-aware cross-cohort teacher-occupancy** constraint. Today the board is pinned to DP1 and the validator never sees the other cohort — so the same teacher can be silently double-booked across cohorts at the same slot (FR-006). This slice closes that gap and is built so the eventual combined DP1|DP2 view (S-06) becomes a reuse, not a rewrite.

## Starting Point

The board is pinned by a single constant (`BOARD_COHORT = "dp1"` in `load.ts:15`); cohort is absent from the route. S-02/S-03 pre-staged this slice: placements already carry `cohort` + `week` (zero schema change), the `BoardContext` doc comment names cross-cohort as the next additive field, `weeksDisjoint` was exported for this reuse, `teacher-availability.ts` is the board-only pattern to mirror, and six `it.todo` parity guards are already written as the acceptance spec.

## Desired End State

Opening a plan shows DP1 by default; a switcher next to the plan name navigates to `?cohort=dp2`, remounting onto the other cohort. A teacher placed in a slot already occupied by that same teacher in the other cohort, in an overlapping week, is flagged **blocking** — symmetrically, both directions, week-aware (opposite A/B is fine; agnostic `both` overlaps every week). The same signal shows during drag and in the detail dialog.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Cross-cohort load strategy | Eager-load-both, server-side projected week-rich index | Per-drag validation stays an in-memory lookup (<200ms); S-06 becomes a reuse | Research / change.md |
| Switch mechanism | Navigate to `?cohort=` → island remount | Matches init-once state hooks; no re-sync; no stale snapshot | Research |
| Phasing | One slice, three phases (constraint → switcher → E2E) | Constraint lands tested before UI; ships whole | Plan |
| Switcher UI | Segmented DP1/DP2 control next to the plan name (`PlanSummaryBar`) | Discoverable, uses switcher-ready `COHORTS` config | Plan |
| Drag-hint surfacing | Reuse `blocked` / `opposite-week`, week-aware | Same mental model as within-cohort teacher conflict; parity-guarded | Plan |
| Violation message | Generic — teacher + other cohort only | Honors "ship only the index, not sibling objects"; smallest payload | Plan |
| Severity | Blocking, same as within-cohort teacher conflict | A teacher can't be in two cohorts at once (FR-006 "enforced") | Plan |
| Invalid `?cohort=` | Default/coerce → dp1 | Preserves today's default; no broken state from a bad URL | Plan |

## Scope

**In scope:** sibling-occupancy index (server-projected, week-rich, co-teacher-expanded); board-only `cross-cohort-teacher` constraint; committed + drag-hint + dialog wiring; six parity guards; `?cohort=` route param; DP1/DP2 switcher; E2E spec.

**Out of scope:** combined DP1|DP2 side-by-side view (S-06); dual-live editable stores; any schema/migration change; client-side tab swap; naming the conflicting sibling course; changes to availability or student/duplicate constraints.

## Architecture / Approach

`load.ts` projects the sibling cohort's placements → a co-teacher-expanded `{teacherKey, day, period, week}[]` shipped as a board prop; the island rebuilds it into `Map<teacherKey, Map<cellKey, Set<week>>>` (mirroring `availability-index.ts`). A new board-only constraint (no `test`, reuses `weeksDisjoint`) reads it from an additive `BoardContext` field and emits a blocking violation; the same index is mirrored week-aware into `drop-hints.classifyCell`. The hot combinatorial drag path (`violatesAny`) is untouched, preserving the <200ms budget. Phase 2 swaps the `BOARD_COHORT` constant for a `?cohort=` param; switching is plain navigation.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Constraint core | Sibling index + constraint + committed/drag/dialog wiring + 6 parity guards | Week-aware drag mirroring in `classifyCell` (the one novel piece) |
| 2. Switcher | `?cohort=` route param + DP1/DP2 switcher (remount) | Switcher must work in the empty-state header too |
| 3. E2E | Playwright spec for switch + symmetric flag | Driving cross-cohort seed state through the real workerd preview |

**Prerequisites:** local Supabase + `pnpm env:local`; the recorded eager-load-both decision (`change.md`) holds.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Drag-hint week semantics are the main correctness risk; the parity harness exists to catch committed↔drag divergence and the six guards assert it.
- Assumes the sibling snapshot can't go stale because switching is remount (no dual-live store until S-06).
- Generic messaging assumes authors don't need the specific other-cohort course named to act.

## Success Criteria (Summary)

- A cross-cohort teacher double-booking (overlapping week) is flagged blocking, symmetrically on both cohorts, week-aware.
- DP1↔DP2 switching works from the board with default/fallback to DP1; per-drag validation stays under 200ms.
- The six parity guards and the E2E spec pass; the full local gate (`/verify`) is green.
