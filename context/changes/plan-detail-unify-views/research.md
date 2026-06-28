---
date: 2026-06-28T01:26:17+0200
researcher: Dobromir Kropielnicki
git_commit: 7f6295fb710d6f661621ebffc002849888e7db79
branch: main
repository: 10xdev3
topic: "Unify plan-detail entry points: combined is the board, single cohort is a focus mode"
tags: [research, codebase, plan-detail, fsd, unification, drop-dispatch, ssr-loader]
status: complete
last_updated: 2026-06-28
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Settled the 5 implementation sub-decisions"
---

# Research: Unify plan-detail entry points (combined = the board, single = a focus mode)

**Date**: 2026-06-28T01:26:17+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 7f6295fb710d6f661621ebffc002849888e7db79
**Branch**: main
**Repository**: 10xdev3

## Research Question

Two parts:
1. **Discuss & ground the open questions** from `change.md` for the product-direction shift "combined
   is the board; single cohort is just a user-selectable focus mode" — and lock the product-judgment
   decisions.
2. **Check the feasibility** of extracting/simplifying the inner handler functions (e.g. `handleDrop`)
   out of the final unified board component into shared, testable units.

## Summary

The unification is **feasible and well-supported by the evidence**, and the four product-judgment
decisions are now **locked** (see "Decisions" below). Highlights:

- **Loader (always load both): confirmed safe.** The extra cost is **SSR-only** (~+44% query count,
  fully parallelized) with **zero per-drag cost** — the <200ms budget lives in the pure constraint
  core and is unaffected by load strategy. Data scale is tiny (39/45 courses per cohort in seed).
  Historical precedent backs this: the cross-cohort index was deliberately designed so the combined
  view is "a reuse, not a rewrite."
- **Cohort-always-tagged (focus mode): blast radius is small.** Only **one** test block needs
  rewriting (`drop-router.test.ts:96-169`, the 11 "untagged single board" cases); ~49 other test
  files are unaffected because the data layer (cellKey, collisions, drop-hints) is cohort-free. The
  visible change: focus-mode cells get cohort-prefixed aria-labels + namespaced dnd ids, and parked
  cards show a cohort badge.
- **Chrome divergence is real but contained** (summary bar, empty-state, palette cookie) — all three
  are localized presentation branches, now resolved by the "preserve + upgrade combined" decision.
- **`handleDrop` extraction: GO.** The `switch(action.kind)` body is duplicated near-verbatim across
  both boards and is the **only un-extracted, untested handler logic**. It extracts cleanly into one
  pure `applyDropAction(action, resolveState, effects)` in `model/cross-cohort/drop-dispatch.ts`,
  parameterized by a `resolveState(cohort)` callback — single passes `() => theState`, combined/unified
  passes `c => byCohort[c]`. Net LOC ≈ flat; real win = one canonical dispatch + ~8-12 new unit tests
  on logic with **zero coverage** today. It is directly compatible with (and de-risks) the unification.

## Decisions (locked this session)

| # | Question | Decision | Consequence to plan for |
|---|----------|----------|-------------------------|
| 1 | Loader strategy | **Always load both cohorts** | One loader (`loadCombinedPlannerData`) for every mode; delete the single loader's flat-sibling-snapshot path. SSR-only cost, negligible at this scale. |
| 2 | Routing / URL | **Single `?focus=` param** | Collapse to one route `/plans/[id]?focus=dp1\|dp2\|combined`. **Removes** the `/combined` path and the `?cohort=` param → update `CohortSwitcher` hrefs and add a redirect/alias for old links (sub-decision below). |
| 3 | Focus-mode chrome | **Preserve single's UX in focus mode, AND upgrade combined** | Focus mode keeps `PlanSummaryBar` (incomplete + parked counts) and the full-screen empty state; **add the summary bar to the combined view too** for consistency. Fold the parked-card cohort badge into this consistency theme. |
| 4 | Cell a11y | **Always tag cohort; delete the optionality branches** | Accept cohort-prefixed aria-labels + namespaced dnd ids in focus mode; rewrite `drop-router.test.ts:96-169`. Removes the `cohort?`/`?? activeCohort` branches across `SlotCell`, `SlotCellHost`, `drop-router`. |

**Why the Rules-of-Hooks blocker doesn't bite:** "single = combined focused on one cohort" means
**both cohorts are always instantiated** → `useCombinedBoardState(dp1, dp2)` is always called with a
constant hook count of 2. The cross-index cycle (the load-bearing reason the two state hooks were
separate) still works because it's built for exactly 2. See `model/use-cohort-board-state.ts:16-32`.

## Detailed Findings

### 1. Loader / SSR over-fetch (open Q1, Q6)

**Query comparison** (`src/_pages/plan-detail/api/load.ts`):
- `loadPlannerData` (single, `load.ts:33-134`): ~17-18 queries — plan + active groupings/placements/shelf
  + availability + **sibling placements (flat read-only snapshot, `load.ts:75`)** + active catalog (5
  sub-queries via `loadCohortCourses`) + **sibling catalog (5 sub-queries, `load.ts:83`)** + teacher/student
  names (union) + 1 staleness hash.
- `loadCombinedPlannerData` (combined, `load.ts:149-245`): ~26 queries — both cohorts' groupings/placements/shelf/catalog
  (5 each) + shared availability + union names + **2 staleness hashes** (`load.ts:209-211`).
- Net delta of "always load both" vs today's single load: **~+9 sub-queries (+44%)**, all the DP-sibling's
  groupings/shelf/full-catalog that the focus view won't render. (The single loader already ships *both*
  catalogs — active + a read-only sibling — so the marginal payload is the sibling's groupings/shelf, not a 2× catalog.)

**Data scale** (`supabase/seed.sql`): courses dp1=39 / dp2=45 (84 total); teachers 18 (shared pool); students
61 (shared). `course_groupings`, `placements`, `shelf_bundles`, `teacher_availability` are **0 in seed** —
populated at author runtime. Real plans: ~40 placed courses/cohort, ~200-400 `student_choices`/cohort. CSV
fixtures `data/dp1`/`data/dp2` are a few KB.

**The <200ms budget is client-side, not SSR** (`CLAUDE.md:10`, `README.md:3`). It's exercised by
`model/collision/collisions.perf.test.ts:49-72` — a 50ms ceiling on the pure `deriveCellViolations` +
`deriveDropHints` core, measured **sub-millisecond**. Neither loader adds per-drag work: the live
cross-index is a `useMemo`'d Map-from-placements rebuild (`use-cohort-board-state.ts:48-55`,
`indexFromPlacements` `:97-111`) with no DB cost, and validation memoizes identically whether a cohort
is active or a (never-changing) sibling.

**Verdict:** always-load-both is an SSR-only, modest, parallelized cost; **no lighter focused loader is
needed.** Supports Decision #1.

### 2. Chrome & defaults divergence (open Q3, Q4, Q6)

**Header / summary bar.** Single renders `PlanSummaryBar` (`PlannerBoard.tsx:195-205`) → incomplete-count
("N courses left to place"), parked-count badge with expand-shelf affordance (`PlanSummaryBar.tsx:28-50`),
and `CohortSwitcher` via `BoardHeader.tsx:16`. Combined's inline header (`CombinedPlannerBoard.tsx:206-213`)
shows only plan name + `CohortSwitcher active="combined"` + the hint toggle — **no summary metrics**.
→ Decision #3: add the summary bar to combined; keep it in focus mode.

**Empty state (zero groupings).** Single does a **full-screen early-return** (`PlannerBoard.tsx:177-188`)
via `resolvePaletteView` "empty" (`model/grouping/palette-view.ts:15-25`) — no grid/palette/shelf. Combined
keeps the switcher + grid and swaps only the palette **body** in-panel (`CombinedPalettePanel.tsx:88-94`),
so the author can still switch cohorts when one is empty. → Decision #3: focus mode keeps the full-screen
takeover; combined keeps in-panel. This becomes a `focus`-conditioned branch.

**Palette compact-first / cookie.** Single seeds palette-collapsed from an SSR cookie
(`src/pages/plans/[id]/index.astro:16-18` → `PlannerBoard.tsx:78` → `usePaletteDisclosure`,
`board-disclosure.ts:48-57`; cookie `planner-palette-collapsed`, `lib/palette-collapsed.ts:16`). Combined
ignores the cookie and hardcodes collapsed (`combined.astro:9-12`, `CombinedPlannerBoard.tsx:46`,
`usePaletteDisclosure(true)`). → Sub-decision below (lean: honor the cookie in all modes, since combined has
one tabbed palette).

### 3. Cohort-always-tagged: a11y + test blast radius (open Q5)

**Behavior-change inventory** (what flips when `cohort` is always present):
- `SlotCell.tsx:114-118` — aria-label gains the cohort prefix (`"Monday, P1"` → `"DP1, Monday, P1"`).
- `SlotCell.tsx:177` — droppable id namespaces (`"1:1"` → `"dp1:1:1"`); `:186` — bundle drag id
  (`"bundle:1:1"` → `"bundle:dp1:1:1"`); `:178` — droppable `data.cohort` always set.
- `drop-router.ts:44,56,62,71` — the `?? activeCohort` fallbacks become identity (single cohort can't
  differ from itself) → deletable once cohort is always present.
- `SlotCellHost.tsx:45,62,71` — `cohort?` becomes required.
- `ParkedBundleCard.tsx:50-54` — the cohort **badge** now renders in focus mode (visual change); `:32`
  parked drag data always tagged. `ShelfDrawer.tsx:18-20,98` — `cohortById` populated for focus mode.

**Data layer is cohort-free and SAFE:** `cellKey` stays bare, so collisions, drop-hints, occupant grouping,
and placement verdicts are unaffected (`drop-hints.test.ts`, `use-placements.test.tsx`, `cell-occupants.test.ts`).

**Test impact:** only **`drop-router.test.ts:96-169`** (the `describe("… single board (untagged, one cohort)")`
block, 11 cases + the `bareCell` builder at `:101`) **must be rewritten** to tag cells. `SlotCell.test.tsx`
is optional (no aria-label/id assertions today). Parity/characterization suites — `api/parity.test.ts`,
`api/adapter-parity.integration.test.ts`, `model/collision/collision-parity.test.ts`,
`api/combined.integration.test.ts`, `model/cross-cohort/assemble-combined-props.test.ts` — are **unaffected**
(domain/collision logic is cohort-agnostic). ~49 files total need no change. Supports Decision #4.

### 4. `handleDrop` / handler extraction feasibility (Part B) — verdict: GO

**Per-handler closure / divergence** (single `PlannerBoard.tsx` vs combined `CombinedPlannerBoard.tsx`):

| Handler | Single | Combined | Divergence |
|---|---|---|---|
| `handleDragStart` | `:103-106` (just `startDragHints`) | `:82-90` (resolve `dragCohort`, `setActiveDragCohort`) | Divergence dominates → **leave inline** |
| `handleDrop` wrapper | `:108-120` (clear 1 hint map) | `:92-106` (clear both + reset `activeDragCohort`; `activeCohort` arg = `paletteCohort`) | Legitimately divergent → **stays inline** |
| `handleDrop` switch body | `:121-149` | `:107-138` | **Near-verbatim** (combined only adds `state = byCohort[action.cohort]`) → **extract** |
| `dropGroup` | `:160-163` | `:141-145` | Identical modulo cohort resolution → folds into extraction |
| `parkToShelf` | `:169-173` | `:154-158` | Identical modulo cohort resolution → folds into extraction |
| `liftBundle` | `:153-156` | `:147-150` | Identical; **dual-use** (also the cell button `onLiftBundle`) — note asymmetry: combined inlines lift in its drop case (`:120-123`) |

**Recommended extraction** — `src/_pages/plan-detail/model/cross-cohort/drop-dispatch.ts` (beside `drop-router.ts`;
pure, calls no hooks, closes over nothing — fits the "guards/transitions in model/, hooks orchestrate" lesson):

```ts
export type DropDispatchState = {
  actions: CohortActions;
  groupings: PlannerGrouping[];
  weekModeByCourseId: Map<string, WeekMode>;
};
export type DropEffects = { collapseUnlessPinned: () => void };

export function applyDropAction(
  action: CombinedDropAction,
  resolveState: (cohort: Cohort) => DropDispatchState,
  effects: DropEffects,
): void
```

Works because `CombinedDropAction` already carries `cohort` on every variant (`drop-router.ts:10-18`). Single
passes `resolveState = () => theState`; combined/unified passes `c => byCohort[c]`. The body is the merged 8-case
switch (lift inlined, park empty-guarded once). Callers collapse to:
`const action = resolveCombinedDrop(...); if (action) applyDropAction(action, resolveState, { collapseUnlessPinned });`
— deleting the local `dropGroup` + `parkToShelf` in both boards.

**Effect classification:** `resolveCombinedDrop` / `defaultParkedWeek` / `groupingParkedMembers` = pure, already
extracted (don't re-extract). `actions.*` = impure but stable refs, injected via `resolveState`. `collapseUnlessPinned`
= a `useShelfDisclosure` setState wrapper (`board-disclosure.ts:36`) → **stays component-created, injected as a callback**.
Event unwrap (`event.operation`/`event.canceled`), hint clearing (one vs both), `setActiveDragCohort`, and the
`activeCohort` arg pick **stay inline** in each `handleDrop`.

**Coverage gap this closes:** there is **no test that calls `handleDrop`** today — the action→dispatch mapping is
reachable only via a full island + dnd-kit drag sim (which the repo avoids). `resolveCombinedDrop` is well-tested
(`drop-router.test.ts`, 17 cases) but the *dispatch* of its output is not. Extraction adds ~8-12 focused unit tests
(each `action.kind` → right `actions.*` call; `dropGroup`/`parkGroup` unknown-id no-ops; `collapseUnlessPinned` fires
on lift/placeBack/park but not add/move; `resolveState` routing proves the single==degenerate-combined equivalence).

**Net:** LOC ≈ flat (~50-60 removed from components, ~55 added in one shared file). The win is **one canonical dispatch
+ testability of the last untested handler logic**, and it **de-risks the unification** (the unified board just passes
`resolveState = c => byCohort[c]`; focus mode passes a single-cohort resolver — the seam already exists). **Build it as
a standalone first step** even before the bigger unification.

**Obstacles:** none blocking. Steiger-clean intra-slice import (`drop-dispatch.ts` → `CohortActions` from
`use-cohort-board-state.ts`, no cycle). No Workers/Node-API, no budget impact (same call count). Decide whether the
lift *button* also routes through `applyDropAction({kind:"liftBundle",…})` (cleaner; fixes the inline/helper asymmetry)
or keeps a thin helper.

## Code References

- `src/_pages/plan-detail/api/load.ts:33-134` — single loader; `:149-245` — combined loader; `:75` flat sibling snapshot; `:318` `projectSiblingOccupancy`.
- `src/_pages/plan-detail/model/use-cohort-board-state.ts:16-32` — the cross-index-cycle rationale; `:33-64` combined hook; `:82-90` single wrapper; `:48-55`/`:97-111` live index.
- `src/_pages/plan-detail/model/collision/collisions.perf.test.ts:49-72` — the budget perf test.
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:177-188` (empty early-return), `:195-205` (summary bar), `:108-173` (handlers).
- `src/_pages/plan-detail/ui/CombinedPlannerBoard.tsx:206-213` (header), `:92-158` (handlers), `:46` (compact-first).
- `src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx:28-50`; `BoardHeader.tsx:16`; `board-disclosure.ts:36,48-57`.
- `src/_pages/plan-detail/ui/palette/CombinedPalettePanel.tsx:88-94` (in-panel empty); `model/grouping/palette-view.ts:15-25`.
- `src/_pages/plan-detail/lib/palette-collapsed.ts:16` (cookie name); `src/pages/plans/[id]/index.astro:16-18`; `src/pages/plans/[id]/combined.astro:9-12`.
- `src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx:114-118,177,178,186`; `SlotCellHost.tsx:45,62,71`.
- `src/_pages/plan-detail/model/cross-cohort/drop-router.ts:10-18,37,44,56,62,71`; `drop-router.test.ts:96-169`.
- `src/_pages/plan-detail/ui/shelf/ParkedBundleCard.tsx:32,50-54`; `ShelfDrawer.tsx:18-20,98`.
- `src/_pages/plan-detail/model/placement/parked-members.ts:15,23` (`defaultParkedWeek`, `groupingParkedMembers`).

## Architecture Insights

- The p1–p9 refactor already shares the substance (model, `BoardShell`, `resolveCombinedDrop`, the per-cohort state
  pipeline, cell internals, `PaletteBody`). Unification is now about folding the two thin orchestrators + routes + loaders,
  not re-sharing logic.
- "Combined = the board, single = focus" is the framing that makes unification clean: always-instantiate-both keeps the
  hook count constant (dissolving the Rules-of-Hooks blocker) and the cross-index cycle keeps working (it's built for 2).
- The remaining single↔combined differences reduce to a handful of **`focus`-conditioned presentation branches** (grid
  1-vs-2 columns, palette switcher shown-vs-locked, shelf filtered-vs-merged, summary bar, empty-state style, sibling-dim)
  plus the now-deletable cohort-optionality branches.
- `applyDropAction` is the clearest standalone win and a natural seam for the unified dispatch.

## Historical Context (from prior changes)

- `context/archive/2026-06-22-cohort-switching/change.md:16` — the cross-cohort index was deliberately shaped so the
  combined view (S-06) is **"a reuse, not a rewrite — the index shape and symmetric rule don't change; S-06 only swaps
  the sibling's committed snapshot for the other column's live state."** This directly backs Decision #1 (always load both):
  the eager both-cohort load is the architectural seam that lets one validation core serve both modes.
- `context/changes/plan-detail-unify-views/change.md` — this change's seed notes (the critic review that produced the
  product direction + the "what does/doesn't get simpler" analysis).

## Resolved sub-decisions (settled this session)

1. **`?cohort=` / `/combined` migration → HARD CUT, no redirects.** Switch to `?focus=dp1|dp2|combined`; delete
   `src/pages/plans/[id]/combined.astro`; update `CohortSwitcher.tsx` hrefs to `?focus=`. **No** 301 redirects and
   **no** `?cohort=` alias — old bookmarks/links to `/combined` or `?cohort=` break. Acceptable: pre-GA internal tool,
   no external links to preserve; least code.
2. **Palette cookie → HONOR IN ALL MODES.** The `planner-palette-collapsed` cookie seeds collapse state in both focus
   and combined modes (one tabbed palette). Combined stops hardcoding `usePaletteDisclosure(true)`; the route seeds it
   from the cookie like the single route does today. Switching modes preserves the user's collapse choice.
3. **Lift button → ROUTE THROUGH `applyDropAction`.** The cell lift button dispatches `{kind:"liftBundle",…}` through
   the shared dispatcher, deleting the standalone `liftBundle` helper and fixing the current inline-vs-helper asymmetry
   between the two boards.
4. **`handleDragStart` → LEAVE INLINE.** Divergence dominates the 2-line shared surface; no extraction. (A 1-line
   `resolveDragCohort(data, activeCohort)` pure helper is optional, only if we later want that branch unit-tested.)
5. **Sequencing → `applyDropAction` FIRST.** Land `model/cross-cohort/drop-dispatch.ts` + its ~8-12 unit tests as an
   independent, low-risk PR; then build the component/route/loader unification on the already-tested seam.

## Open Questions

None blocking. All four product-judgment decisions and all five implementation sub-decisions are settled; remaining
detail (exact `focus`-branch placement per component, test fixture updates) is plan-level work.

## Related Research

- None prior for this slice beyond `context/archive/2026-06-22-cohort-switching/` (cohort switching + cross-index) and the
  in-repo p1–p9 `plan-detail-refactor` commit history.
