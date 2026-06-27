# Combined-view park-to-shelf gap — Plan Brief

> Full plan: `context/changes/combined-view-park-gap/plan.md`
> Bug + fix sketch: `context/changes/combined-view-park-gap/change.md`
> Research (parity matrix §C): `context/changes/plan-detail-refactor/research.md`

## What & Why

In the combined two-cohort view (`/plans/[id]/combined`), dragging a palette **course** or **grouping**
onto the shelf does nothing — the drag is silently dropped. The single-cohort board parks it. This is a
gap, not a design choice: the combined view should park it too. Fixing it also makes the two boards
symmetric, which is the **prerequisite** that de-risks the larger `plan-detail-refactor`.

## Starting Point

`resolveCombinedDrop` (`model/combined-drop.ts:30,32`) returns `null` for `course→shelf` and
`grouping→shelf` — it has no park action. The single board parks them via inline, pure member-resolvers
(`PlannerBoard.tsx:124,132,174-185`). Everything the combined board needs already exists: it holds
`paletteCohort` (`:43`) and each cohort exposes `actions.parkMembers`, `weekModeByCourseId`, and
`groupings` (`use-cohort-board-state.ts:155,167`).

## Desired End State

A palette course/grouping dropped on the combined-view shelf **parks under the palette's active cohort**:
the card is tagged with that cohort and places back into that cohort's column, and the shelf
auto-collapses unless pinned — exactly mirroring the single board. Both boards resolve parked
members/weeks through one shared `model/` helper. Every other drop path is unchanged.

## Key Decisions Made

| Decision                       | Choice                                              | Why (1 sentence)                                                                 | Source   |
| ------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| Is the gap a bug or a feature? | Bug — fix it, no product question                   | Single board parks; combined should match.                                       | Frame    |
| Cohort source for shelf drop   | New `activeCohort` arg = `paletteCohort`            | A cell-less shelf drop has no cohort signal but the palette's active one.         | Research |
| Router shape                   | Two park variants carrying ids; board resolves members | Keeps the router pure of catalog/grouping data, matching existing variants.       | Plan     |
| Single-board scope             | Migrate both boards onto the shared helper now      | One source of truth, provably identical, sets up the refactor; pure → low risk.   | Plan     |
| E2E scope                      | Park + cohort-routed place-back (no reload leg)     | Tests combined-specific routing; durability already proven by the single spec.    | Plan     |

## Scope

**In scope:** park-capable `resolveCombinedDrop` (+ `activeCohort` arg); shared `model/parked-members`
helper; combined board's two park branches; single board migrated to the helper; router + helper unit
tests; one combined-route e2e.

**Out of scope:** the drop-router unification, `BoardShell`/shared-`PLUGINS`, `ui/` restructure, renames,
`api/` cleanup (all `plan-detail-refactor`); any schema/migration; single-board behavior changes; a
reload-durability e2e leg.

## Architecture / Approach

Pure model first (helper + router, fully unit-tested → the safety net + the contract), then wire both
boards onto it, then one e2e for the combined-specific routing. Data flow on a shelf drop:
`paletteCohort → resolveCombinedDrop → {parkCourse|parkGroup} → groupingParkedMembers / defaultParkedWeek
→ byCohort[cohort].actions.parkMembers → collapseUnlessPinned`. No new state, no constraint-core touch.

## Phases at a Glance

| Phase                              | What it delivers                                          | Key risk                                                        |
| ---------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Pure model core                 | Shared resolver + park-capable router + unit tests       | Flipping the existing `course→shelf` null assertion / 3rd arg  |
| 2. Board wiring                    | Combined park branches + single board on the helper      | Single board's `handleDrop` area has no unit test — manual smoke + the pure helper test mitigate |
| 3. E2E                             | Combined park + cohort-routed place-back spec            | Combined palette defaults collapsed — expand before dragging   |

**Prerequisites:** local Supabase + `pnpm env:local` (for e2e); no schema work.
**Estimated effort:** ~1 session across 3 phases (small, behavior-preserving).

## Open Risks & Assumptions

- The single-board migration is behavior-preserving because the resolvers are pure and lifted verbatim;
  the new helper unit test + manual smoke guard against a subtle change.
- `paletteCohort` is always a valid cohort even when the palette is collapsed (state persists), so a
  collapsed-palette shelf drop still routes correctly.
- The combined palette defaults collapsed — the e2e must expand it first (unlike the single-board spec).

## Success Criteria (Summary)

- In the combined view, a palette course/grouping dropped on the shelf parks under the active cohort,
  tagged + place-back routable to that cohort's column, with auto-collapse-unless-pinned.
- The single board is unregressed; both boards share one member-resolution helper.
- Router + helper unit tests and the combined-route e2e are green; full local CI gate (`/verify`) passes.
