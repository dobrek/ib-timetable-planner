# Frame Brief: Board view-state store (challenge the no-Context/no-store rule)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Board-level view flags accumulate as prop-drills — the highlight/discovery lens
would be "roughly the Nth board-level view flag threaded `PlannerBoard →
PlannerGrid → CellWiring → SlotCell → PlacedChip` (after `hintMode`, `zoom`,
`activeDragCohort`, `inspection`, exploded cells)". Secondary observation as
stated: "today `PlannerGrid` re-renders each drag tick to recompute per-cell
scalars, then children bail via compiler memo". (`change.md` Notes, verbatim.)

## Initial Framing (preserved)

- **User's stated cause or approach**: The no-store rule
  (`ui-conventions.md:219-235`) is over-broad — it conflates Context (broadcast,
  memo-exempt) with selector stores (granular re-renders), and its perf
  rationale is scoped to high-frequency drag state, so it should not reflexively
  apply to low-frequency view flags.
- **User's proposed direction**: Fix the adoption threshold/trigger (when is a
  per-island selector store warranted board-wide?) before planning; likely
  amend `ui-conventions.md:219-235` and the lens plan's §4 "trap" note. Working
  question: does a selector store beat the `{...wiring}` spread for board view
  state?
- **Pre-dispatch narrowing**: Lead concern is **authoring friction of the
  drill** (not perf, not doc purity); pain felt **both** retrospectively and as
  a worsening trend; scope is **the plan-detail board only**.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Transport mechanism (props vs. store)** — friction inherent to prop
   threading; a store would collapse the hops.  ← initial framing
2. **Channel fragmentation** — friction is per-flag *decision* cost: each flag
   picks a bespoke lane (wiring bundle / direct grid prop / derived scalar /
   `ChipWiring`) with no stated rule.
3. **Stale magnitude read** — the pain memory dates from pre-refactor threading;
   current per-flag cost is small/falling, so "worsening" is false.
4. **Stale convention text** — the rule's factual claims no longer match the
   code; the doc reads arbitrary and invites mechanism challenges.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Transport is the friction origin | At the change note's own scope ("store holds only selection/view state, not derivations", `change.md`), a store saves **~1 of ~8** chain edit sites — the chain's payload is per-cohort derived data (`dropHints`, `justDuplicated`, collisions, 7 handlers) exiting `toCohortState` (`use-cohort-board-state.ts:219-259`) regardless of transport. ~3–4 further per-flag sites are transport-independent derivation plumbing (`use-board-derivations.ts` → `useCohortDerivations` → `toCohortState` → `useCombinedBoardState`). The rule's multi-island exception is unmet: the page mounts **one** island (`PlanDetailPage.astro:29`). `hintMode` already IS a `useSyncExternalStore` store (`lib/drag-hint-mode.ts`, `board-disclosure.ts:21`) — a leaf could subscribe today; threading it via wiring is a choice. | NONE (refuted) |
| 2. Channel fragmentation | Two lanes exist with no rule choosing between them (`hintMode` rides per-column wiring, `PlannerBoard.tsx:152`; `zoom`/`activeDragCohort` ride direct grid props, `PlannerBoard.tsx:245-246`) — but placements are altitude-correct (`zoom` is *consumed* at the grid, `PlannerGrid.tsx:89`) and history shows zero decision churn or missed-hop fixes. | WEAK (real doc gap, not felt friction) |
| 3. Stale magnitude read (of the *drill*) | Chain-threading cost is **falling**: pre-refactor flags re-listed props per hop (`onInspect` ~6×, `3213909`); `bc794a0` (shared `CellWiring` type) + `bd0a1fa` (bundle + spread, −44 re-listings) engineered it down; `zoom` (post-refactor) cost 2 files/~4 lines. Zero missed-hop follow-up fixes across all 6 flags, ever. The stated chain is also overstated: 4 hops not 5; `zoom` stops at the grid; `inspection` state never drills (only its callback); `activeDragCohort` becomes `dimmed` at the grid. The "per drag tick" re-render premise is false — `dropHints` is set once per drag start/clear (`use-board-derivations.ts:52-65`); hover reactivity is per-cell `useDroppable` (`SlotCell.tsx:174`). | STRONG |
| 4. Stale convention text | Three factual claims in `ui-conventions.md:228-235` are contradicted by code: `useCellWiring` + its stabilizing `useMemo` (hook deleted in unify-views, `9c41cba`/`fec7b18`; wiring rebuilt fresh per render, `PlannerBoard.tsx:150-166`), `PairedPlannerGrid` (gone), and "dropHints/hintMode change on every drag tick" (see H3). The rule also bans Context and stores in one breath with exceptions that don't discriminate between them. Inverse check: the stale text already propagated three false premises into `change.md` itself (5-hop chain incl. `zoom`/`inspection`, memoized wiring hook, per-tick re-render). | STRONG |

## Narrowing Signals

- User: authoring friction is the lead concern; board-scoped.
- Independent no-preconception investigation **confirmed the friction is real
  but relocated it**: a new cell-reaching flag costs ~15 edit sites across
  ~6–7 files, ranked (1) wiring chain incl. duplicate type declarations
  (`PlannerGrid.tsx:26-42` + `SlotCell.tsx:19-46`), (2) per-flag persistence
  cloning — five near-identical ~50-line micro-store modules
  (`lib/drag-hint-mode.ts`, `board-zoom.ts`, `shelf-pinned.ts`,
  `palette-cohort.ts`, `palette-collapsed.ts`), (3) control-surface widening
  (`BoardSettingsMenu` value/setter pairs + a bespoke control file per flag).
  The store-replaceable transport is a minority share of that cost.
- Prior occurrence: the project already faced this observation and resolved it
  by consolidation, not a store — `bc794a0 refactor(planner-prop-drilling)`
  (2026-06-22), then `bd0a1fa` (2026-06-28).

## Cross-System Convention

This codebase's established response to prop-drill pain is a **consolidation
refactor of the existing path** (shared type → bundled object + spread), and it
already sanctions per-value `useSyncExternalStore` micro-stores for persisted
preferences (`board-disclosure.ts`). Convention amendments are recorded with
rationale and drift when the code moves (the `plan-detail-refactor` amendment
outlived its own mechanism). The leading hypothesis — fix the doc, not the
transport — matches both precedents.

## Reframed Problem Statement

> **The actual problem to plan around is**: the state-management convention
> (`ui-conventions.md:219-235` + the `PlannerGrid.tsx:17-25` docblock) is
> factually stale and states no adoption threshold or lane-choice rule — while
> the real per-flag authoring cost sits mostly *outside* the transport it
> debates, in per-flag origin/persistence ceremony, control-surface widening,
> and transport-independent derivation plumbing.

The user's rule critique was **correct** (the conflation and the mis-scoped
perf rationale are real, and the text is provably stale), but the implied
remedy — a per-island selector store for board view state — would not
materially reduce the observed friction: at its own stated scope it saves ~1 of
~8 chain sites (~1 of ~15 lifecycle sites), on a page with one island where the
rule's store exception doesn't even apply. Addressing the reframed problem
means the convention becomes evidence-based (correct facts, explicit
store/Context distinction, a concrete adoption trigger, a lane-choice rule for
new flags), and any future friction work aims at the measured cost centers
rather than the spread.

## Confidence

**HIGH** — four convergent investigations (live trace, git history, comparative
edit-site count, independent no-preconception check), a prior-occurrence
precedent, and passing inverse checks (stale doc demonstrably propagated false
premises into this change's own notes).

## What Changes for /10x-plan

The plan should be a **convention rewrite, not a store introduction**: correct
the stale claims, separate Context from selector stores with their actual
re-render semantics, and state an explicit adoption threshold (e.g.
multi-island state, cross-cutting selection consumed at many leaves, N
store-shaped micro-modules worth consolidating) plus a lane-choice rule for new
board flags — updating `ui-conventions.md:219-235`, the `PlannerGrid.tsx:17-25`
docblock, and the lens research's §4 "trap" note. Whether the measured cost
centers (persistence-module cloning, control-slot widening, derivation-seam
plumbing) warrant their own consolidation change is a separate scoping decision
the plan may propose or defer — it is not this frame's mandate.

## References

- Source files: `src/_pages/plan-detail/ui/PlannerBoard.tsx:70-79,144-168,245-246`,
  `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:17-42,162-179`,
  `src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx:19-46,104`,
  `src/_pages/plan-detail/ui/grid/slot-cell/PlacedChip.tsx:19-29`,
  `src/_pages/plan-detail/model/use-board-derivations.ts:45-95`,
  `src/_pages/plan-detail/model/use-cohort-board-state.ts:184-259`,
  `src/_pages/plan-detail/ui/chrome/board-disclosure.ts:21-32`,
  `src/_pages/plan-detail/lib/drag-hint-mode.ts`,
  `src/_pages/plan-detail/ui/PlanDetailPage.astro:29`,
  `context/foundation/ui-conventions.md:219-235`
- Related research: `context/changes/planner-board-search-discovery/research.md` §4
- Key commits: `3213909`, `83783a5`, `bc794a0`, `bd0a1fa`, `d886183`, `9c41cba`, `fec7b18`, `6b32973`
- Investigation tasks: #1 (transport — refuted), #2 (fragmentation — weak),
  #3 (stale magnitude — strong), #4 (stale text — strong)
