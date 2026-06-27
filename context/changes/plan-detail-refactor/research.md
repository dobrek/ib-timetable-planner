---
date: 2026-06-27T19:11:10+0200
researcher: Dobromir Kropielnicki
git_commit: f6e168b
branch: main
repository: 10xdev3
topic: "plan-detail slice refactor — what planning needs before sequencing the work"
tags: [research, codebase, plan-detail, fsd, refactor, dnd-kit, react-compiler, ui-conventions]
status: complete
last_updated: 2026-06-27
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Resolved the 5 open questions; split the combined-view park-to-shelf gap into a prerequisite change (combined-view-park-gap); this refactor is now fully behavior-preserving and depends on that fix"
---

# Research: plan-detail slice refactor

**Date**: 2026-06-27T19:11:10+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: f6e168b
**Branch**: main
**Repository**: 10xdev3

## Research Question

Collect every missing fact a separate planning session needs to safely sequence the
`src/_pages/plan-detail/` refactor captured in `change.md`: shared per-cohort board-state assembler,
`BoardShell` + shared `PLUGINS` + unified drop router, the cell-wiring prop-drill fix, folder grouping
(`ui/palette/` first), file renames, and `api/` cleanup. Surface the structural-lint constraints, the
test safety net and its blind spots, the behavioral-parity traps, the React-Compiler reality, and the
UI-convention decisions — explicitly treating the conventions as **challengeable** for this module
(the largest and most important in the app), not as hard blockers.

## Summary

The refactor is structurally safe to do (steiger permits nested segment folders; the palette move is
slice-internal with zero external consumers), and the **pure model core is densely unit-tested** — it
is the strong safety net. The risks are concentrated in three places that planning must treat
carefully:

1. **The board-wiring layer is barely tested.** The single board's `handleDrop` has _no_ unit test,
   `use-board-derivations.ts` and every board/grid/shell/shelf component have _no_ co-located test, and
   the combined route has _one_ e2e spec that never mutates inside the combined view. Several
   refactor targets route straight through these untested seams. → **Add characterization tests
   before the architectural moves.**

2. **Unifying the drop router is not a free extraction — it would silently drop two features.**
   `resolveCombinedDrop` has no "park" action; the single board's _course→shelf_ and _grouping→shelf_
   park branches have no equivalent. Unifying as-is deletes them. This item needs design (a park
   action variant + a target cohort for cohort-free palette drags) and a product decision (does the
   combined view gain park-to-shelf parity?).

3. **The "obvious" fixes collide with conventions — and research changes the verdict on each.**
   - The **wiring Context** (finding #3) is not just convention-discouraged; it is **technically worse
     here**: there is no React Compiler transform (only a lint plugin), memoization is all manual, and
     drag-hint state changes on _every drag_, so a single Context value would re-render all cells on
     every hint update — against the <200ms budget. The better fix already exists in-codebase: the
     `PairedPlannerGrid` **bundled-object + `{...wiring}` spread** pattern. No Context needed.
   - The **shared assembler** (finding #1) is _consistent_ with conventions if framed as a per-cohort
     derived-state unit (which `useCohortBoardState` already is) and the board keeps its own
     orchestration visible — not collapsed into a `usePlannerBoard` bag.

So: conventions were challenged (per the user's steer) and mostly **hold for good reasons** — but the
challenge surfaced a _better_ non-Context wiring fix and clarified that the assembler is fine. One
convention genuinely needs amending: the folder-with-barrel idiom is documented narrowly (one
orchestrator + private children) and should be widened to bless the multi-public-component
feature-folder (`ui/palette/`), which the `model/constraints/` barrel already precedents.

## Detailed Findings

### A. Structural lint / FSD — the moves are safe

- **steiger config** is just `fsd.configs.recommended` (`@feature-sliced/steiger-plugin` 0.6.0) —
  `steiger.config.ts`. Enabled rules include `fsd/public-api` (slice must _have_ an `index.ts` —
  checks existence, not usage), `fsd/no-segmentless-slices`, `fsd/repetitive-naming`,
  `fsd/excessive-slicing`, `fsd/inconsistent-naming`, `fsd/ambiguous-slice-names`. CI runs
  `pnpm steiger` = `steiger src --fail-on-warnings` (`package.json:13`, `.github/workflows/ci.yml`).
- **Nested folders inside a segment are already used and pass CI**: `model/constraints/`,
  `ui/slot-cell/`, `ui/shelf/`. So `model/collision/`, `ui/palette/`, etc. are permitted. ✅
- **plan-detail is the _only_ slice with nested segment folders** — `courses/`, `teachers/`,
  `students/`, `plans-list/`, `dashboard/`, `sign-in/` are all flat. The grouping is precedented
  _within_ plan-detail but introduces a pattern other slices don't use (fine — plan-detail is the
  large one; the others are small).
- **Barrel precedents**: `ui/slot-cell/index.ts` = single default barrel
  (`export { default } from "./SlotCell";`); `model/constraints/index.ts` = **multi-named-export
  barrel** (`CELL_CONSTRAINTS`, `explainCell`, `violatesAny`, types); `ui/shelf/` = **no barrel**
  (deep import `./shelf/ShelfDrawer`). → `ui/palette/` with a multi-public barrel mirrors
  `model/constraints/`.
- **All intra-slice imports are relative** (`./`, `../model/`); zero `@/_pages/plan-detail/…`
  self-imports. File moves are **relative-path rewrites only**. (Matches `ui-conventions.md:161`.)
- **Zero external consumers** of any palette component; the only external imports of the slice are
  `@/_pages/plan-detail/api` (actions/loaders, from `src/actions/index.ts` + test factories). The
  root `index.ts` (`export … PlannerBoard`) is **not imported anywhere** — routes import the `.astro`
  wrappers via deep paths. The vestigial-API finding stands; `fsd/public-api` won't complain (it only
  needs the file to exist).
- **Minor watch-item**: `fsd/repetitive-naming` / `fsd/ambiguous-slice-names` — keep folder names
  distinct from their single dominant export (a `palette/` folder is fine; avoid e.g. a `collision/`
  folder whose barrel re-exports a `collision`). `model/constraints/` proves a concept-named folder
  with named exports passes.

### B. Test & build safety net — strong core, thin board layer

- **CI gate (exact)** — `verify` job: `astro sync` → `pnpm check` (astro check, the _only_ type gate
  — see lessons) → `pnpm lint` (incl. `react-compiler/react-compiler: error`) → `pnpm steiger` →
  `pnpm audit --audit-level=high` → `pnpm test` (vitest unit+dom+**perf**; integration excluded) →
  `pnpm build`. Separate `integration` job (`*.integration.test.ts`) and `e2e` job (Playwright over
  `pnpm build && pnpm preview`). `/verify` skill runs the verify-job steps locally (no integration/e2e).
- **Densely unit-tested pure core** (the safety net): constraints registry, `collisions`/`collision`,
  `drop-hints`, `placement-transitions`, `shelf-transitions`, `resolveCombinedDrop`
  (`combined-drop.test.ts`), `assembleCombinedProps` (`combined-props.test.ts`), `indexFromPlacements`
  (`use-cohort-board-state.test.ts`), the full `usePlacements` hook (`use-placements.test.tsx`),
  palette filter model, `week`, `hours`, `score`, `enumerate`, plus a perf test
  (`collisions.perf.test.ts`) and the parity oracle tables (`collision-parity.test.ts`).
- **E2E covers both routes but asymmetrically**: single `/plans/[id]` = 7 specs (place/move, bundle
  ops, duplicate, **shelf durability incl. grouping→shelf park**, staleness/recompute, cohort
  switching, co-teaching). Combined `/plans/[id]/combined` = **one** spec
  (`combined-view.spec.ts`): cross-cohort clash on adjacent cells + cross-column drag _guard_. It
  **seeds placements via the single boards**, then only reads/guards — it never mutates inside the
  combined view.
- **Move-fragility**: co-located tests import the unit-under-test by relative path, so a source move
  breaks the test import unless the test moves with it (e.g. `ui/PlannerPalette.test.tsx:4-5`,
  `ui/GroupingStalePanel.test.tsx:5`, `ui/slot-cell/SlotCell.test.tsx:6-8` with depth-sensitive
  `../../`). Plan the test as part of each move.
- **Blind spots a behavior-preserving refactor must respect (no failing test would catch a break):**
  1. Single board `handleDrop` — **no unit test**, no `PlannerBoard.test`. (Combined's
     `resolveCombinedDrop` _is_ tested → unification merges a tested router with an untested one.)
  2. **course→shelf park** — no unit, no e2e. grouping→shelf park — e2e only.
  3. **Live re-validation inside the combined view** — only the `indexFromPlacements` leaf is tested;
     the full `useCombinedBoardState` cycle is not, and e2e never mutates in the combined view. "Edit
     one cohort → sibling re-validates live" is unproven end-to-end.
  4. `use-board-derivations.ts` — **no test**; the shared assembler routes through it.
  5. Boards, `PairedPlannerGrid`, `CombinedPalettePanel`, `PlanSummaryBar`, `board-disclosure`,
     `board-inspection`, `shelf/*` — no co-located tests; only indirect e2e.
  6. Week A/B toggle — no e2e, no UI test (model-level only).

### C. Board parity — the drop-router unification trap

`resolveCombinedDrop` (`model/combined-drop.ts:10-51`) has **6 action variants and no park**:
`addCourse | dropGroup | movePlacement | moveBundle | liftBundle | placeBack`.

Parity matrix (single board = reference):

| drag × target        | Single `PlannerBoard`                     | Combined `resolveCombinedDrop` | Parity          |
| -------------------- | ----------------------------------------- | ------------------------------ | --------------- |
| course × cell        | `addCourse`                               | `addCourse`                    | ✅              |
| **course × shelf**   | **park course** (`PlannerBoard.tsx:124`)  | **null / no-op**               | ❌ **gap**      |
| placement × cell     | `movePlacement`                           | `movePlacement` + cohort guard | ✅              |
| placement × shelf    | no-op                                     | null                           | ✅              |
| grouping × cell      | `dropGroup`                               | `dropGroup`                    | ✅              |
| **grouping × shelf** | **park members** (`PlannerBoard.tsx:132`) | **null / no-op**               | ❌ **gap**      |
| bundle × cell        | `moveBundle`                              | `moveBundle` + cohort guard    | ✅              |
| bundle × shelf       | `liftBundle`                              | `liftBundle`                   | ✅              |
| parked × cell        | `placeBack` + collapse                    | `placeBack` + collapse + guard | ✅              |
| parked × shelf       | no-op                                     | null                           | ✅ (both no-op) |

- **Unifying onto `resolveCombinedDrop` as it stands deletes course→shelf and grouping→shelf park.**
  The per-cohort `actions` already expose `parkMembers` and carry `weekModeByCourseId`
  (`use-cohort-board-state.ts:155,167`), but `CombinedPlannerBoard` never calls them. To unify
  behavior-preservingly the router needs a **park action variant** (cohort + resolved
  `ParkedMember[]`), and the cohort-free course/grouping shelf-park needs a **target cohort** — the
  only signal available in the combined view is `paletteCohort` (`CombinedPlannerBoard.tsx:43,82`).
- **Open product question**: the combined view currently _cannot_ park a palette course/grouping to
  the shelf. Is that an intended limitation or an oversight? Unifying is the natural moment to grant
  parity, but that is a feature change, not a pure refactor.
- **Structural divergences a shared `BoardShell` must reconcile:**
  - Single board has an **early return** when `paletteView === "empty"` that renders only
    `BoardHeader` + `ComputeGroupingsEmptyState` and **skips the whole island** (no DragDropProvider,
    grid, shelf) — `PlannerBoard.tsx:191-200`. Combined **never early-returns**; it handles
    empty/stale **per cohort inside `CombinedPalettePanel`**, grid always mounted.
  - Single has `PlanSummaryBar` (incomplete/parked badges); combined has a custom inline header with
    `CohortSwitcher`, no summary bar.
  - `GroupDragOverlay` gets `placementsByCohort` in combined (disambiguates a bundle overlay to its
    column); single doesn't.
  - `CollisionDetailsDialog`: single uses the `useCollisionInspection` hook; combined hoists a single
    shell-owned inspection across both columns (open one closes the other) with an inline
    adjust-state-during-render close.
  - Error banner: one (single) vs up to two per-cohort (combined).
- `@dnd-kit/dom` and `@dnd-kit/react` are both pinned **exact 0.5.0** (`package.json:29-30`). The
  `PLUGINS` const is **byte-for-byte identical** in both boards (`PlannerBoard.tsx:293-295`,
  `CombinedPlannerBoard.tsx:260-262`) — a clean shared-shell extraction.

### D. React Compiler reality + the cross-cohort cycle

- **The React Compiler build transform is NOT wired.** `@astrojs/react` is called with no babel
  options (`astro.config.mjs:37`); `babel-plugin-react-compiler` is absent from deps and lockfile.
  What exists is **only the ESLint plugin** `eslint-plugin-react-compiler` (`package.json:70`,
  `eslint.config.js:8,62,68`), rule severity `error`, in the `pnpm lint` CI gate. So "the compiler
  forbids …" comments mean **lint-enforced purity**, not auto-memoization. **Memoization is all
  manual** (`useMemo` everywhere). This is decisive for the wiring-Context question (see E).
- **Purity constraints the refactor must preserve** (lint-enforced): _no refs read during render_
  (`placementsRef.current` is read only in handlers/async, never render —
  `use-cohort-board-state.ts:30-31`, `use-placements.ts:121,138-208`); _no setState-in-effect for
  derived state_ — derive during render / adjust-state-during-render instead (`use-board-derivations.ts:80-97`,
  `PlannerPalette.tsx:183-187`, `CombinedPlannerBoard.tsx:69-75`). A wiring Context value computed in
  render must still satisfy these.
- **Cross-cohort cycle** (`use-cohort-board-state.ts:16-64`): both `usePlacements` run first with the
  **static SSR seed** index → each cohort's **live** index is `useMemo`'d from the _other_ cohort's
  current placements (`indexFromPlacements`, fresh Map identity each build) → the fresh index feeds
  `useCollisions`/`useDragHints`. The seed (not live) goes into `usePlacements` because the live index
  forms a hook-order cycle and feeding a one-render-lagged value would require a render-time ref read
  (forbidden). The seed reaches **only** `duplicateBundle`'s cross-cohort term
  (`use-placements.ts:187` → `duplicate-target.ts`), argued unobservable.
- **Single board can pass its one static index as both seed and fresh** — that is exactly what
  `PlannerBoard` does today (`PlannerBoard.tsx:52` → `:78` usePlacements, `:87` useCollisions, `:95`
  useDragHints). So a shared `useCohortBoardState(props, seedIndex, freshIndex)` reproduces the single
  board's wiring when both args are the same static index. ✅ The cycle test
  (`use-cohort-board-state.test.ts`) pins the `not.toBe` fresh-identity property — the regression guard
  for the assembler step.
- **Context within an island is single-provider** (one `client:load` island, one DragDropProvider per
  board, mutually exclusive routes) — so a wiring Context would never cross islands (the
  no-Context escape clause "cross multiple islands" is _not_ met).

### E. The wiring prop-drill — the better fix already exists, and Context is worse here

- `CellWiring` = **11 fields** (`ui/slot-cell/SlotCellHost.tsx:17-33`). The **single path** threads them
  by hand through **4 hops** (`PlannerBoard → PlannerGrid → PeriodRow → SlotCellHost → SlotCell`),
  re-listing all 11 at each hop (~44 re-listings). The **paired path already does it right**: builds one
  `wiring: CellWiring` object (`CombinedPlannerBoard.tsx:155-171`), passes it as one field, and spreads
  `{...column.wiring}` once (`PairedPlannerGrid.tsx:104`), with one fewer hop (no `PeriodRow`).
- **Recommended fix: adopt the paired pattern in the single path** — one bundled `wiring` object +
  `{...wiring}` spread. Zero convention friction (it's already in the codebase), removes the
  hand-listing, low risk.
- **Why NOT a wiring Context** (research-driven, beyond the convention): no compiler transform → manual
  memo only; **`dropHints`/`hintMode` change on every drag**, so a single Context value re-renders
  _all_ cell consumers on every hint update — exactly what the current per-cell structure limits, and
  directly relevant to the **<200ms drag budget**. Context is both convention-discouraged _and_
  technically inferior here.

### F. UI-convention decision points (challenged, per the user's steer)

The user asked to treat `context/foundation/ui-conventions.md` as challengeable here. Outcome per item:

1. **No global store / no Context (`ui-conventions.md:197-203`)** — _holds, for a better reason._ The
   wiring Context fails both escape clauses (single-island; optimistic path already lives fine in
   `usePlacements`) **and** is a perf regression (E). Recommend: keep the rule; document the _real_
   rationale (frequent drag-state updates + manual memo + 200ms budget) so it's principled, not dogma.
2. **`usePlannerBoard` bag-hook anti-pattern (`ui-conventions.md:7,33,35`)** — _holds, with a
   clarification._ The shared assembler should be a **per-cohort derived-state unit** (what
   `CohortBoardState` already is), not a board-orchestration bag. The board keeps its drop dispatch,
   disclosure, and inspection visible. Recommend: amend the convention to distinguish "orchestration
   bag (bad)" from "per-cohort state unit (fine — the combined view already relies on it)."
3. **Folder-with-barrel idiom (`ui-conventions.md:64-68`)** — _needs widening._ It's written only for
   "one orchestrator + private children, single default barrel" (`slot-cell/`). `ui/palette/` is a
   **multi-public-component feature folder**; `model/constraints/` already precedents the multi-export
   barrel. Recommend: amend the convention to bless the feature-folder + multi-public barrel form.
4. **Pre-recorded deltas already in the convention (`ui-conventions.md:218-222`)** — `api/grouping-client.ts`
   should align to the `callAction` `{ error }` shape and swap `location.reload()` for `refreshPage()`;
   `api/placement-client.ts` **stays throw-on-error by design** (optimistic reconcile needs `data`).
   So finding #6's "inconsistent error contract" is a _known, pre-blessed_ cleanup, not a discovery.

## Code References

- `steiger.config.ts` — `fsd.configs.recommended`; `package.json:13` — `steiger src --fail-on-warnings`
- `src/_pages/plan-detail/index.ts` — vestigial root barrel (exports only `PlannerBoard`; unused externally)
- `src/_pages/plan-detail/model/combined-drop.ts:10-51` — `CombinedDropAction` (no park) + router + cohort guard
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:109-185` — single `handleDrop` + park helpers (124,132); `:191-200` empty early-return; `:293-295` PLUGINS
- `src/_pages/plan-detail/ui/CombinedPlannerBoard.tsx:87-139` — combined drop dispatch; `:260-262` identical PLUGINS
- `src/_pages/plan-detail/ui/slot-cell/SlotCellHost.tsx:17-33` — `CellWiring` (11 fields)
- `src/_pages/plan-detail/ui/PlannerGrid.tsx:76-136` — hand-listed wiring across hops (the laggard)
- `src/_pages/plan-detail/ui/PairedPlannerGrid.tsx:104` — `{...column.wiring}` spread (the good pattern)
- `src/_pages/plan-detail/model/use-cohort-board-state.ts:16-64,177-191` — the cycle + `indexFromPlacements` seam
- `src/_pages/plan-detail/model/use-board-derivations.ts:21-98` — shared derivations (no test)
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:52,78,87,95` — single board: one static index → seed + fresh
- `astro.config.mjs:37` / `eslint.config.js:8,62,68` / `package.json:70` — React Compiler is lint-only
- `context/foundation/ui-conventions.md:7,33,35,64-68,197-203,218-222` — the convention decision points
- e2e: `e2e/specs/combined-view.spec.ts` (sole combined spec); `e2e/specs/shelf-durability.spec.ts:72,90` (grouping→shelf park)
- regression guard: `src/_pages/plan-detail/model/use-cohort-board-state.test.ts` (`not.toBe` fresh-identity)

## Architecture Insights

- **The pure model core is the safety net; the board-wiring layer is the exposure.** Lean on the
  former; _create_ coverage for the latter before the architectural moves.
- **The combined view already invented the right patterns** the single board lacks — bundled `wiring`
  object + spread (E), and a per-cohort state unit (`CohortBoardState`, finding #1). Much of the
  refactor is "make the single board adopt the combined view's better seams," not "invent new
  abstractions." This also de-risks it: the target patterns are already tested-in-production on the
  combined route.
- **"Unify the drop router" is the one item that is genuinely a design + product task**, not a
  mechanical extraction — because of the park-to-shelf asymmetry and the empty-view early-return
  divergence. Sequence it last and gate it on new tests + a parity decision.
- **No React Compiler means manual memoization is load-bearing**; any new shared value (assembler
  return, a wiring object) must be referentially stable, and broad-fan-out Context values are a
  re-render hazard against the 200ms budget.

## Historical Context (from prior changes / foundation)

- `context/foundation/ui-conventions.md` — the courses-refactor conventions; §"Applicability to
  `plan-detail`" (lines 214-222) already lists the `grouping-client` / `placement-client` deltas and
  confirms the hooks-over-pure-transitions pattern is the intended shape.
- `context/foundation/lessons.md`:
  - "Green build/test/lint ≠ type-safe — `astro check` is the mandatory type gate" → the plan's
    success criteria must cite `pnpm check`, never `pnpm build`/`lint` as a type gate.
  - "Prefer declarative pipelines over imperative accumulator loops" (cites `duplicate-target.ts`,
    drop-hint/collision derivations) → keep refactored model code declarative.
  - "Guard `localStorage` with try/catch + `useSyncExternalStore`" (cites
    `plan-detail/lib/drag-hint-mode.ts`) → relevant if disclosure/hint-mode hooks are touched.
- The combined two-cohort view (S-06) was the most recent work on this slice and was just archived
  (`git log`: combined-two-cohort-view). The combined board is the newer, more-evolved half; the
  single board is the one that has drifted behind.

## Related Research

- None prior for this slice under `context/changes/**/research.md`. The S-06 combined-view change is in
  `context/archive/` (combined-two-cohort-view) — useful background on the cross-cohort cycle design.

## Open Questions (decisions for the planning session)

1. **Drop-router unification**: add a park action variant + give cohort-free palette drags a target
   cohort (from `paletteCohort`) — i.e. grant the combined view **course→shelf / grouping→shelf park
   parity** (a small feature add)? Or keep the two `handleDrop`s separate and only share the shell?
2. **Characterization-tests-first**: agree to add tests for single-board `handleDrop` (incl.
   course→shelf park), a `useCombinedBoardState` live-mutation test, and `use-board-derivations`
   before the assembler/shell/router moves? (Strongly recommended.)
3. **Convention amendments** (the user's explicit invitation to challenge): adopt the three edits in F
   — (a) keep no-Context but document the real rationale, (b) clarify per-cohort-unit vs
   orchestration-bag, (c) widen folder-with-barrel to bless multi-public feature folders. Land these
   as `ui-conventions.md` edits _as part of_ the change so the doc supports the new structure.
4. **Wiring fix scope**: bundled-object + spread only (recommended), or still evaluate Context? (Research
   says spread; Context is worse here.)
5. **Scope/sequencing**: one big change or split (e.g. `plan-detail-refactor` = palette folder + wiring
   - assembler + shell; a follow-up for the drop-router unification + remaining `model/`/`ui/` folders +
     `api/` cleanup)? The architectural core (assembler → shell) is cohesive; the router unification is
     separable and riskier.

### Revised sequencing (research-informed)

1. **Characterization tests** for the untested board seams (close blind spots B1–B4).
2. **`ui/palette/` folder** move (+ multi-public barrel; move co-located tests with sources).
3. **Single-path wiring → bundled-object + `{...wiring}` spread** (adopt the PairedPlannerGrid pattern).
4. **Shared `useCohortBoardState(props, seed, fresh)`** assembler; single board passes one static index
   as both; pin with the cycle test.
5. **`BoardShell` + shared `PLUGINS`**; reconcile the empty-view early-return + PlanSummaryBar divergence.
6. **Unified drop router** (riskiest) — only after step 1; needs the park variant + parity decision.
7. **Renames** (`collision.ts`→intersects, `combined-drop`/`combined-props`, drop `cellKey` re-export) +
   **`model/` folder grouping**.
8. **`api/` cleanup** — `grouping-client` → `callAction`/`refreshPage`; dedup `toPlannerPlacement`.
9. **`ui-conventions.md` amendments** (F) landed alongside the structural changes.

## Follow-up Research 2026-06-27T19:26:13+0200 — palette-header hierarchy + finalized ui/ structure

The user raised a real UX bug that steers the `ui/` structure, and asked to push the folder grouping
further (root = orchestration/entry points only). Decisions below were taken with the user.

### The palette-header bug

In the combined view the cohort switcher (`Tabs`) is a **sibling rendered _above_** `PlannerPalette`
(`ui/CombinedPalettePanel.tsx:52-69`), so it floats over the palette's _own_ header (`Boxes` +
"Groupings" + count + collapse chevron, `ui/PlannerPalette.tsx:76-95`). The hierarchy reads inverted —
the switcher looks detached and the panel's identifying header looks subordinate to it. (Note: this
palette `Tabs` is distinct from the route-level `CohortSwitcher` in the board header that switches
dp1/dp2/**combined** _views_ — `CombinedPlannerBoard.tsx:181`.)

**The palette and shelf are the same drawer.** `PALETTE_ICON_BUTTON` (`PlannerPalette.tsx:28`) and
`SHELF_ICON_BUTTON` (`shelf/ShelfDrawer.tsx:26`) are **byte-for-byte identical**; both render a
width-animated `<aside>` (`w-9`↔open), a collapsed rail/tab (icon + count, display-class toggle so the
draggable sources survive collapse), and an expanded `header` of `icon + label + count + ml-auto
icon-buttons`. The shelf differs only by a pin button + an auto-collapse/pinned-disable rule and by
being the island-wide droppable; the palette differs only by its filter body and by never being a drop
target.

### Decision 1 — Shared `CollapsibleEdgePanel` (chosen)

Extract ONE shell that both palette and shelf consume (kills the mirrored chrome + the duplicated
`*_ICON_BUTTON`). Shape:

```
CollapsibleEdgePanel
  side: "left" | "right"          // chevron direction + rail edge
  icon, label, count              // header identity + collapsed-rail content
  collapsed, onCollapsedChange    // disclosure (shelf adds pin → disable-collapse-when-pinned)
  headerActions?: ReactNode       // shelf: pin button (right of header, before collapse)
  toolbar?: ReactNode             // rendered BELOW the header, above the body — palette: cohort Tabs
  children: ReactNode             // body: palette filter+list | shelf parked cards
```

The `toolbar` slot is the fix: the cohort switcher moves from _above the panel_ to _below the panel's
header_ → clean hierarchy. It only renders in the expanded body, so it auto-hides when collapsed
(preserves today's "switcher hidden when collapsed" behavior). Body becomes `children`.

Scope impact: this pulls the **shelf** (currently under-tested — only e2e) into the change. Gate with a
`CollapsibleEdgePanel` unit test + keep the existing shelf e2e green. The shared shell lands in a
neutral spot (`ui/chrome/` or its own `ui/panel/`) since both `ui/palette/` and `ui/shelf/` import it.

### Decision 2 — Unify the combined palette's empty/stale states under the shell (chosen)

Today `CombinedPalettePanel` swaps its whole body between `PlannerPalette` / `GroupingStalePanel` /
`ComputeGroupingsEmptyState` with the switcher floating above all three. New shape: the
`CollapsibleEdgePanel` (header + `toolbar` switcher) is **always** rendered; only the **body** swaps on
`resolvePaletteView(active)` → `ready` (filter+list) / `stale` (recompute) / `empty` (compute prompt).
Consistent header+switcher across states; the author can switch cohorts even when one cohort is
empty/stale.

**Boundary (do not over-apply):** this is the **combined** palette (per-cohort, because one cohort can
be empty while the other isn't). The **single** board's `empty` state is genuinely board-level — it
early-returns a full-width compute prompt and skips the whole island (`PlannerBoard.tsx:191-200`),
since with zero groupings there is nothing to place. That divergence stays justified; the unification
here does not force the single board to change its full-screen empty state. (Still the right moment to
decide whether the single board's _stale_ column also routes through the shared shell — Open Q.)

### Decision 3 — Finalized `ui/` tree, root = orchestration/entries only (5 folders, chosen)

```
ui/
  PlanDetailPage.astro  PlanDetailCombinedPage.astro  PlanDetailError.astro   ← route entries
  PlannerBoard.tsx  CombinedPlannerBoard.tsx                                   ← island-root orchestrators
  palette/   PlannerPalette · CombinedPalettePanel · GroupingFilter · GroupingBox · PaletteCourseChip ·
             HoursCounter · ComputeGroupingsEmptyState · GroupingStalePanel   (+ tests, index.ts)
  grid/      PlannerGrid · PairedPlannerGrid · slot-cell/  (folded in)         (+ index.ts)
  shelf/     ShelfDrawer · ParkedBundleCard                                    (existing)
  overlay/   GroupDragOverlay · CollisionDetailsDialog
  chrome/    BoardHeader · PlanSummaryBar · CohortSwitcher · DragHintModeToggle · ErrorBanner ·
             board-disclosure.ts · board-inspection.ts · CollapsibleEdgePanel.tsx (shared shell)
```

Root = 3 `.astro` + 2 boards only. (A future `BoardShell` extraction, finding #2, also lands in
`chrome/` or stays at root as a third orchestrator — decide during that step.)

### slot-cell → grid/ (user question — yes)

`slot-cell/` is consumed only by the two grids (`PlannerGrid.tsx:2`, `PairedPlannerGrid.tsx:4` →
`SlotCellHost`), so it folds under `grid/`. Two mechanical notes:

- Its ~25 cross-segment relative imports (`../../model/…`, `../../lib/…`) and its co-located tests
  (`SlotCell.test.tsx`, `tone-class.test.ts`) gain one `../` level → `../../../`. `astro check` +
  `steiger` catch any miss.
- One cross-folder edge: `shelf/ParkedBundleCard.tsx:8` imports `slot-cell/drag-inert`. `drag-inert.ts`
  (`stopDrag` for interactive drag children) is a generic drag utility used by both slot-cell and
  shelf — **promote it to the slice `lib/`** to remove the shelf→grid coupling (cleaner than
  repointing to `../grid/slot-cell/drag-inert`).

### Updated open questions / sequencing deltas

- **New scope item:** `CollapsibleEdgePanel` extraction (palette + shelf) + combined palette
  state-unification. Slots into the revised sequence right after the `ui/palette/` move and pairs with
  the `ui/grid/`(+slot-cell) and `ui/{overlay,chrome}/` moves — i.e. the folder-restructure phase now
  also delivers the palette-header UX fix.
- **Test gate:** add a `CollapsibleEdgePanel` unit test; the palette move must carry
  `PlannerPalette.test.tsx` / `GroupingStalePanel.test.tsx`; keep `shelf-durability.spec.ts` green
  (shelf chrome is now refactored).
- **Open Q (single board stale column):** route the single board's `stale` palette column through the
  shared shell too (consistency), or leave its board-level `paletteView` branch as-is? Decide in plan.

## Decisions (resolved 2026-06-27, with the user)

The five open questions are now decided. This change's scope narrows accordingly.

- **Q4 — wiring fix → bundled-object + `{...wiring}` spread; NO Context.** Settled by research: no React
  Compiler transform (manual memo), and `dropHints`/`hintMode` change every drag tick, so a single
  Context value would re-render all cells against the 200ms budget. The single path adopts the pattern
  `PairedPlannerGrid` already uses.
- **Q3 — land the three `ui-conventions.md` edits as part of this change**: (a) keep no-Context but
  document the real rationale, (b) distinguish "per-cohort state unit (fine)" vs "orchestration bag
  (bad)", (c) widen folder-with-barrel to bless multi-public feature folders. So the new structure is
  self-justifying.
- **Q2 — characterization-tests-first**, written immediately before the seam each protects. Extracting
  the single board's inline `handleDrop` into a pure, tested resolver is the same move as characterizing
  it — the safe on-ramp to the eventual router unification.
- **Q1 + Q5 — the combined-view park gap is a BUG, split into its own prerequisite change.** The combined
  view cannot park a palette course/grouping onto the shelf (single view can); `resolveCombinedDrop`
  returns `null` for course→shelf / grouping→shelf (`combined-drop.ts:30,32`) vs `PlannerBoard.tsx:124,132`.
  **Decision: fix it FIRST as a separate small PR (new change `combined-view-park-gap`), before this
  refactor.** Rationale: ship the user-facing fix on its own merits, and — crucially — fixing it makes
  the two boards **symmetric**, which dissolves the only risky/behavioral item in this refactor. The
  previously-proposed "Change B" (router unification + park parity) **evaporates**: once both boards
  park, unifying the single board onto `resolveCombinedDrop` is ordinary behavior-preserving refactor
  work that folds back into this change as a mechanical step.

### What this change becomes (post-decision)

`plan-detail-refactor` is now **fully behavior-preserving** and assumes the park gap is already fixed:
ui/ 5-folder restructure (+ slot-cell→grid, drag-inert→lib), shared `CollapsibleEdgePanel` +
palette-header fix + combined palette state-unification, single-path wiring→spread, shared per-cohort
assembler, `BoardShell` + shared `PLUGINS`, the (now mechanical) drop-router unification onto the
park-capable `resolveCombinedDrop`, renames, `model/` grouping, `api/` cleanup, and the
`ui-conventions.md` amendments — with characterization tests written first.

**Dependency:** sequence after `combined-view-park-gap` merges (the park-capable `resolveCombinedDrop`

- the lifted `groupingMembers`/`defaultParkedWeek` model helper are produced there and consumed here).
