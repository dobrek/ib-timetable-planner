---
change_id: plan-detail-refactor
title: Refactor plan-detail slice — shared board core, kill duplication, group folders
status: archived
created: 2026-06-27
updated: 2026-06-27
archived_at: 2026-06-27T22:38:38Z
---

## Notes

Refactoring pass over `src/_pages/plan-detail/` after the feature set is essentially complete.
This is cleanup/architecture, not behavior change — the board must keep working identically
(both routes: `/plans/[id]` single-cohort and `/plans/[id]/combined`).

Verdict from the review: the slice is genuinely well-built (pure domain logic in `model/` cleanly
split from hooks split from UI; disciplined optimistic-write path; extensible constraint registry;
the cross-cohort live-index cycle is handled deliberately). Findings below are refinement, not rescue.
**No global state library** (Redux/Zustand) — it would fight the React Compiler and add ceremony.

### Findings & recommendations (ordered by leverage)

1. **No shared per-cohort board-state assembler (highest leverage / root of the duplication).**
   `PlannerBoard.tsx:49-97` assembles per-cohort state inline (weekModeByCourseId, catalogById,
   availabilityIndex, crossCohortIndex, usePlacements, useCollisions, useHours, useDragHints,
   useExplodedCells, useDuplicateHighlight). `use-cohort-board-state.ts:73-129`
   (`useCohortPlacements` + `useCohortDerivations`) re-assembles the _same set_ for the combined view.
   Two assemblies kept in sync by hand → drift risk. The code admits it: `use-cohort-board-state.ts:17`
   says "It would be cleaner to call one `useCohortBoardState` twice."
   → Make `PlannerBoard` consume the same `useCohortPlacements`/`useCohortDerivations` pieces,
   passing its static SSR `crossCohortIndex` as both seed and fresh (single-cohort has no live sibling).
   One assembler, both routes.

2. **Entire DnD board shell is copy-pasted across the two boards.**
   `PLUGINS` (Feedback `dropAnimation: null`) is verbatim identical: `PlannerBoard.tsx:293-295` ==
   `CombinedPlannerBoard.tsx:260-262`. Shell scaffold duplicated: `DragDropProvider` → flex column →
   3-col grid (`lg:grid-cols-[auto_minmax(0,1fr)_auto]`, same string) → ErrorBanner /
   DragHintModeToggle / ShelfDrawer / CollisionDetailsDialog / GroupDragOverlay. Drop dispatch is
   structurally parallel (`PlannerBoard.tsx:120-146` vs `CombinedPlannerBoard.tsx:100-122`).
   → Extract a `BoardShell` layout (header/palette/grid/shelf/dialog+overlay slots) + one shared
   `PLUGINS`. Deeper: route the single board's `handleDrop` through the same `resolveCombinedDrop`
   pure router the combined board uses (single = degenerate one-cohort case) → one drop dispatch.

3. **Cell-wiring prop-drill is the real "state management" pain (NOT a store).**
   `CellWiring` threads Board → Grid → PeriodRow → SlotCellHost → SlotCell (4 hops); all 11 fields
   are hand-re-listed at every level (nobody spreads). `PlannerGrid.tsx` re-lists the full wiring
   twice (27-37/78-84 and 100-106/130-136).
   → `BoardWiringContext` providing per-cohort wiring, consumed at `SlotCellHost`; Grid/PeriodRow stop
   threading handlers; combined view provides one context per column. Removes ~40 lines + drift risk.
   Interim if context is rejected: at least `{...wiring}` spread instead of enumerating fields.

4. **`model/` is a 30-file flat folder — group into sub-folders** (`constraints/` already proves
   nested folders pass steiger). Proposed: `collision/` (collisions, collision, cell-occupants,
   cell-tone, cell-key, constraints/), `grouping/` (grouping, enumerate, compute-groupings, score,
   palette-view, filter-groupings, sort-groupings, leading-course-options, companion-course-options,
   reconcile-companion), `placement/` (placement, placement-transitions, parked, shelf-transitions,
   duplicate-target), `cross-cohort/` (cross-cohort-index, combined-drop, combined-props,
   availability-index); `use-*.ts` hooks stay at root or → `hooks/`.

5. **Naming collisions that cost reading time.**
   - `collision.ts` (singular — fast-path boolean `hasIntersection`) vs `collisions.ts` (plural — full
     `deriveCellViolations`). Rename the singular (e.g. `intersects.ts`).
   - `combined-drop.ts` (drop router) vs `combined-props.ts` (SSR prop assembly). Rename for intent.
   - `cellKey` is re-exported from `collisions.ts` though it lives in `cell-key.ts`;
     `CombinedPlannerBoard.tsx:16` imports it from `collisions`. Import the leaf; drop the re-export.

6. **`api/` boilerplate + inconsistencies.**
   - `placement-client.ts` / `shelf-client.ts`: 8× near-identical
     `const {data,error} = await actions.X(args); if (error) throw new Error(error.message); return data`
     → generic `callAction(actions.X, args)`.
   - Inconsistent error contract: `grouping-client` _returns_ `{error}` while placement/shelf-client
     _throw_. Normalize or document the decision.
   - `toPlannerPlacement` duplicated: exported from `placements.ts:62` AND re-inlined as `mapPlacements`
     in `load.ts:297-314`. Import the exported one.
   - `load.ts` (361 lines): `loadPlannerData` and `loadCombinedPlannerData` repeat per-cohort
     fetch→map→staleness; combined loader's fetch helpers could serve both.

7. **Smaller notes.**
   - Vestigial public API: `index.ts` exports only `PlannerBoard`; routes import the `.astro` wrappers
     via deep paths and never go through it; `CombinedPlannerBoard` isn't exported at all. Make routes
     import through the slice public API (FSD intent) or drop the pretense.
   - `CombinedPlannerBoard` drop handler inlines `actions.shelveBundle(...) + collapseUnlessPinned()`
     (113-116) instead of calling the existing `liftBundle` helper (130).

### ui/ folder grouping (the user-confirmed first concrete step)

Cleanest cut in the slice — sharp public/internal boundary (verified from import edges). Mirrors the
existing `slot-cell/` and `shelf/` folders.

`ui/palette/` (10 files):

- public (consumed by the boards): `PlannerPalette`, `CombinedPalettePanel`, `ComputeGroupingsEmptyState`,
  `GroupingStalePanel`
- internal (used only inside the palette): `GroupingBox`, `GroupingFilter`, `PaletteCourseChip`,
  `HoursCounter` (HoursCounter has exactly two importers, both palette)
- tests: `PlannerPalette.test.tsx`, `GroupingStalePanel.test.tsx`
- `index.ts` barrel exporting only the 4 public entries (the absence of the internal pieces documents
  the boundary; matches the "index.ts = pure barrel" convention)

Import edges (evidence): `PlannerPalette → GroupingBox, GroupingFilter, PaletteCourseChip`;
`CombinedPalettePanel → ComputeGroupingsEmptyState, GroupingStalePanel, PlannerPalette`;
`GroupingBox → HoursCounter, PaletteCourseChip`; `PaletteCourseChip → HoursCounter`. External
consumers: `PlannerBoard → PlannerPalette, ComputeGroupingsEmptyState, GroupingStalePanel`;
`CombinedPlannerBoard → CombinedPalettePanel`.

Churn is tiny: only `PlannerBoard.tsx`, `CombinedPlannerBoard.tsx`, and the two test files change
import paths; `.astro` routes import the boards, not the palette, so **routes are untouched**.

Other natural `ui/` cuts (lower priority, follow-ups): `grid/` (PlannerGrid, PairedPlannerGrid + fold
`slot-cell/` under it), `chrome/` (BoardHeader, PlanSummaryBar, CohortSwitcher, DragHintModeToggle,
ErrorBanner, board-disclosure.ts, board-inspection.ts), `overlay/` (GroupDragOverlay,
CollisionDetailsDialog). Board orchestrators + `.astro` route entries stay at `ui/` root.

### Suggested sequencing

1. `ui/palette/` folder move (isolated, reviewable commit; verify `pnpm steiger` + `pnpm test`).
2. Shared per-cohort assembler (#1).
3. `BoardShell` + shared `PLUGINS` + unified drop router (#2).
4. `BoardWiringContext` (#3).
5. Renames (#5) + `model/` folders (#4).
6. `api/` cleanup (#6) — opportunistic.
   Items 2–4 are the architectural core and are related: done together, the two boards become ~80-line
   shells over a shared core.

### Added during prepare (see research.md + its follow-up)

- Research collected: steiger/FSD safety, test safety-net + blind spots, board drop-router parity
  (unifying onto `resolveCombinedDrop` would silently drop course→shelf / grouping→shelf park), React
  Compiler is **lint-only** (manual memo), and the cross-cohort cycle constraints. UI conventions were
  challenged: no-Context and no-bag-hook **hold for better-stated reasons**; folder-with-barrel needs
  **widening** — land `ui-conventions.md` edits as part of this change.
- **Palette-header UX fix is now in scope** (decided with the user): the combined-view cohort switcher
  currently floats above the palette's own header. Fix via a **shared `CollapsibleEdgePanel`** (one
  shell for palette + shelf; switcher moves to a `toolbar` slot _below_ the header) and **unify the
  combined palette's empty/stale/ready states** under that shell. Pulls the shelf into scope.
- **Finalized `ui/` structure** — root = orchestration/entries only (3 `.astro` + 2 boards); 5 folders:
  `palette/`, `grid/` (+ `slot-cell/` folded in; promote `drag-inert.ts` → slice `lib/`), `shelf/`,
  `overlay/`, `chrome/` (incl. the shared `CollapsibleEdgePanel`).

### Decision: park gap split out → this refactor is fully behavior-preserving

- The combined view's inability to park a palette course/grouping to the shelf (single view can) is a
  **bug**, not a design choice. Decided with the user to **fix it first as a separate PR** —
  change `combined-view-park-gap` — _before_ this refactor.
- Why this matters here: fixing it makes the two boards **symmetric**, which removes the only
  behavioral/risky item from this change. The drop-router unification stops being a design+product task
  and becomes ordinary behavior-preserving refactor work (folded back into this change). The earlier
  "Change B" follow-up is no longer needed.
- **Dependency:** sequence this refactor **after `combined-view-park-gap` merges**. That change produces
  the park-capable `resolveCombinedDrop` (with a third `activeCohort` arg + `parkCourse`/`parkGroup`
  actions) and lifts `groupingMembers`/`defaultParkedWeek` into a shared `model/` helper — both consumed
  here. See `research.md` → "Decisions (resolved 2026-06-27)".
- **✅ Dependency satisfied (verified 2026-06-27 @ HEAD `4039b66`).** `combined-view-park-gap` is merged
  to `main`; this branch is a clean base on top of it. Verified in **live code** (not just the closure
  docs): 3-arg park-capable `resolveCombinedDrop` (`combined-drop.ts:39,42`), shared pure
  `model/parked-members.ts` (`defaultParkedWeek` + `groupingParkedMembers`, tested), and **both boards
  parking symmetrically** through it. Full gate **green** (`check` 0 errors · `lint` · `steiger` ·
  `test` 659/79 · `build`). The two boards are now symmetric → the drop-router unification is **ordinary
  behavior-preserving work** (no product gate). **Ready for `/10x-plan`.** One cleanup to fold into the
  plan: the `research.md` §C parity matrix + ~12 line refs predate the park fix — see the verification
  follow-up at the end of `research.md` for the refresh list (two refs, `combined-drop.ts:30,32`, are now
  semantically inverted).

### Constraints / guardrails

- Workers runtime (no Node-only APIs); `pnpm build` stays clean.
- FSD steiger gate (`--fail-on-warnings`); layer import direction `app → _pages → shared`.
- Placement/constraint validation <200ms per drag-drop budget — don't regress the constraint core.
- Behavior-preserving refactor: existing Vitest + integration + e2e suites are the safety net.

### Implementation deviation — Phase 7 router mechanism (recorded at impl-review 2026-06-28)

- The plan made cohort-**tagging** the single board's cells/drags the *primary* mechanism for
  routing through `resolveCombinedDrop`, calling it "harmless." During implementation this proved
  **wrong**: the single-board cell `cohort` prop also drives the cell `aria-label` and the
  parked-card tag, so tagging would have changed visible/ARIA output (a behavior break).
- Resolved by **inverting** the mechanism: single-board cells/drags stay **untagged** and the
  `cell.cohort ?? activeCohort` / `data.cohort ?? activeCohort` fallback is the sole mechanism
  (`model/cross-cohort/drop-router.ts:29-35`). Safe here because one provider → one cohort → an
  untagged cell deterministically resolves to it; the masking risk the plan warned of cannot bite.
  Behavior-preserving and covered by `drop-router.test.ts:100-169` single-cohort cases.
