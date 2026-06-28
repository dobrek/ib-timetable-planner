---
change_id: plan-detail-unify-views
title: Make combined the one plan-detail board; single cohort becomes a focus mode
status: implemented
created: 2026-06-28
updated: 2026-06-28
archived_at: null
---

## Notes

### Product direction

The combined two-cohort board becomes **the** plan-detail board. The single-cohort view
stops being a separate component/route/loader and becomes a **focus mode** of the combined
board (show one cohort's column, the other collapsed/hidden). The user-facing model: single
vs combined is a *convenience choice* about how to build a plan, not two architectural
intents. Goal: one main component, a few presentation modes, one entry point to evolve.

Target shape (sketch, to be confirmed in plan):
- One board component parameterized by `focus: Cohort | "combined"`.
- One loader that loads both cohorts (the combined loader is already a data superset of single).
- `focus = "dp1" | "dp2"` → render one column, lock palette to that cohort, filter shelf, no
  cohort switcher, no sibling-dim; `focus = "combined"` → today's combined behavior.

This came out of a critic review of `src/_pages/plan-detail/` after the `plan-detail-refactor`
(p1–p9). The conclusion: full unification is feasible **and** defensible *given this product
direction* — but it relocates/recenters complexity rather than deleting it, so go in knowing
which payoffs are real.

### What is ALREADY shared (the p1–p9 refactor already did the valuable 90%)

- All of `model/` — collisions, constraints, grouping, placement, drag-hints, cross-cohort index.
- `BoardShell` (`ui/chrome/BoardShell.tsx`) — one `DragDropProvider`, shared `PLUGINS`, the
  3-column layout. Both boards render into it. Its docstring already enumerates the known
  divergences reconciled *outside* the shell.
- Per-cohort state pipeline: `useCohortPlacements → useCohortDerivations → toCohortState`
  (`model/use-cohort-board-state.ts`). Single calls the `useCohortBoardState` wrapper once;
  combined composes the pieces per column in `useCombinedBoardState`.
- One drop router — `resolveCombinedDrop` (`model/cross-cohort/drop-router.ts`). Single board
  is explicitly the "degenerate one-cohort case" (untagged cells/drags resolve via `?? activeCohort`).
- Cell internals: `SlotCellHost` + `SlotCell` + `PlacedChip`/`WeekLane`/etc. — already used
  unchanged by BOTH grids.
- Palette body: `PaletteBody` (filter + list, ~125 lines) already shared by both palettes.
- Shelf (`ShelfDrawer`), chrome hooks (`useHintMode`, `useShelfDisclosure`, `usePaletteDisclosure`),
  overlay (`GroupDragOverlay`), dialog (`CollisionDetailsDialog`).

So the module already "serves both cases." This change is about folding the two thin
top-level orchestrators (and their routes/loaders) into one.

### The two entry points today

| | Single | Combined |
|---|---|---|
| Component | `ui/PlannerBoard.tsx` (266 ln) | `ui/CombinedPlannerBoard.tsx` (282 ln) |
| State hook | `useCohortBoardState(props, idx, idx)` | `useCombinedBoardState(dp1, dp2)` |
| Grid | `ui/grid/PlannerGrid.tsx` (90 ln, 1 col/day) | `ui/grid/PairedPlannerGrid.tsx` (114 ln, 2 sub-cols/day) |
| Palette | `ui/palette/PlannerPalette.tsx` (69 ln, no switcher) | `ui/palette/CombinedPalettePanel.tsx` (97 ln, tabbed) |
| Header | `PlanSummaryBar` (incomplete + parked counts) | inline title + `CohortSwitcher active="combined"`, NO summary bar |
| Route | `src/pages/plans/[id]/index.astro?cohort=` | `src/pages/plans/[id]/combined.astro` |
| Wrapper | `ui/PlanDetailPage.astro` | `ui/PlanDetailCombinedPage.astro` |
| Loader | `loadPlannerData(supabase, id, cohort)` | `loadCombinedPlannerData(supabase, id)` |

`CohortSwitcher` (`ui/chrome/CohortSwitcher.tsx`) already treats the three surfaces (dp1 / dp2 /
combined) as one mutually-exclusive choice across three SSR routes.

### The key technical insight (the crux)

**The cross-cohort index forms a cycle.** Each cohort's *live* occupancy index is derived from
the OTHER column's current placements. `useCombinedBoardState` resolves this by sequencing in
ONE render: both `usePlacements` first → each cohort's fresh index from the sibling's
placements → both derivations. This makes editing one column re-validate the other in the
**same render** (load-bearing for the <200ms drag budget and correct hint/collision display).
See the long Critical Implementation Detail comment at `model/use-cohort-board-state.ts:16-32`.

Why this matters for unification:
- You CANNOT express combined as "call the single-cohort hook twice" — that's a hook in a
  variable-length loop (Rules of Hooks violation), and the "clean" escape (a state-provider
  child per cohort) reintroduces the one-render lag the current design eliminated.
- **BUT** the user's "always load both cohorts, single = focus mode" framing DISSOLVES the
  Rules-of-Hooks blocker: if both cohorts are always instantiated, the hook count is constant
  (always 2). `useCombinedBoardState(dp1, dp2)` is always called with two real cohorts; the
  cycle still works (it's built for exactly 2). There is no N=3. So the hardest technical
  objection does not apply to THIS specific proposal.

### Costs / tradeoffs (go in eyes-open — this is relocation, not deletion, of complexity)

1. **Hot-path over-fetch.** `/plans/[id]?cohort=dp1` is the default landing route. Today its
   loader is deliberately light: one cohort full + the sibling as a *flat read-only snapshot*
   (`crossCohortOccupancy`). "Always combined" makes that route load the sibling FULLY
   (groupings, shelf, full catalog, a 2nd staleness hash) to render one column.
   - Severity: MODEST. This is SSR-time cost; the <200ms budget is *client-side drag
     validation*, not page load. And the hidden cohort's client derivations memoize away in
     steady state (its inputs never change). So: ~2× a sub-second SSR load + a little memory,
     not a budget blow. (Possible mitigation: keep a lighter loader path that synthesizes a
     partial sibling props from placements+catalog only — but that adds a "partial cohort
     props" concept; weigh vs just always loading both.)
2. **Presentation branches.** The surviving component absorbs ~6–7 `focus === "combined" ? …`
   branches: grid 1-vs-2 cols, palette switcher shown-vs-locked, shelf both-vs-filtered, header
   summary-bar (combined currently shows NONE — would need conditional re-add), `activeDragCohort`
   dimming (meaningless single), empty-state (single does a full-screen early-return at 0
   groupings; combined keeps switcher + in-panel empty — pick one for focused).
3. **Loss of a crisp intent.** Today the split cleanly encodes "edit one cohort against a fixed
   read-only sibling" vs "edit two live cohorts." Folding makes the default/most-used view
   secretly a two-cohort live board with one column hidden — the simple case now requires
   understanding the full two-cohort machinery. Acceptable IF the product genuinely treats this
   as one board with modes (it does, per the direction above).

### UI dividends — which code ACTUALLY gets simpler (verified by reading the files)

- **Palette wrapper merge — REAL, ~60 ln.** `PlannerPalette` is documented as "Mirrors
  `CombinedPalettePanel`, minus the cohort-switcher toolbar." `PaletteBody` already shared.
  Merge into one panel taking an optional `toolbar` (the switcher); focused mode passes none.
  Genuinely tied to the mode question (switcher exists only because of multiple cohorts).
  (Also available independently of board unification.)
- **Cohort-optionality removal — REAL, with a behavior change.** Going always-combined makes
  `cohort` always-present, so the "single board stays untagged" branches collapse to one path:
  `drop-router.ts` three `?? activeCohort` fallbacks; `SlotCell.tsx` `cohort ? scopedKey : key`
  + the conditional `aria-label` (`SlotCell.tsx:114-118`, `useCellDnd` 172-189); `SlotCellHost`
  optional `cohort`/`dimmed`. CATCH: the focused single view's cells would then carry
  cohort-namespaced dnd ids and **cohort-prefixed aria-labels** ("DP1, Monday, Period 1") and
  the parked-card cohort tag would show in single-focus. Arguably a consistency improvement, but
  it IS a behavior change — characterization/parity tests will (correctly) flag it.
- **Grid merge — OPTIONAL, modest.** One parametric grid taking `columns: PairedColumn[]`
  (length 1–2). Removes one grid file but taxes the trivial single-column case with two-column
  scaffolding (dead dim/sub-label guarded by `length > 1`). Worth it only if "one grid to
  maintain" beats "two simple grids."

### What does NOT get simplified (correct a tempting misattribution)

- **`SlotCell` / `SlotCellHost` split is ORTHOGONAL** to single-vs-combined. The Host was lifted
  out of `PlannerGrid` so BOTH grids feed `SlotCell` the same shape without re-inlining the
  per-cell derivation (`dropHints.get(key)`, `hintActive`, `bundled`, `justDuplicated` match) —
  see `SlotCellHost.tsx:11-15, 35-40`. It already serves both grids unchanged. Unifying the
  boards leaves this split intact. (Weak, separate case for folding Host into Cell exists, and
  gets marginally stronger if the two grids merge → one call site — but that's a grid refactor,
  not a board-state dividend.)

### Page/route layer

- Do NOT merge the two loaders into "always load combined" without weighing the hot-path
  over-fetch above; the split currently encodes two intents (read-only sibling snapshot vs
  both-live). If we adopt always-combined, the single loader's flat-sibling-snapshot path
  (`projectSiblingOccupancy` in `api/load.ts`) likely goes away.
- Route: collapsing `index.astro` + `combined.astro` into one `?view=`/`?focus=` route is
  possible but trades a clean `/combined` path for a query param and fights Astro's
  one-shape-per-route grain. Alternative: keep routes thin, share the ~15 ln of error/layout
  boilerplate via a helper. Decide in plan.

### Open questions for /10x-research and /10x-plan

1. Loader: always-load-both vs a lighter focused path (partial sibling props)? Quantify the
   real SSR cost on a representative plan before deciding.
2. URL scheme: keep `/combined` + `?cohort=` (focus via route) or a single `?focus=` param?
3. Header: does focused mode keep `PlanSummaryBar` (incomplete + parked counts)? Combined
   currently drops it — is that intentional, and should unification add it to combined too?
4. Empty state: full-screen early-return (single today) vs in-panel empty (combined today) for
   focused mode?
5. a11y/behavior change: are cohort-prefixed aria-labels + cohort-tagged dnd ids in focused
   mode acceptable? Update characterization/parity tests accordingly.
6. Compact-first defaults: single seeds palette-collapsed from an SSR cookie
   (`lib/palette-collapsed.ts`); combined is always compact-first. Reconcile.

### Safety net already in place

`api/adapter-parity.integration.test.ts`, `api/parity.test.ts`,
`model/collision/collision-parity.test.ts`, plus the p1 characterization tests for board seams.
These enforce behavioral equivalence at the shared seam and should be the guardrail for this
change.
