---
change_id: board-view-state-store
title: Challenge the no-Context/no-store rule for board view flags
status: archived
created: 2026-07-03
updated: 2026-07-03
archived_at: 2026-07-03T13:39:58Z
---

## Notes

Trigger is **prop-drill accumulation**, not perf — the highlight/discovery lens is roughly the Nth board-level view flag threaded `PlannerBoard → PlannerGrid → CellWiring → SlotCell → PlacedChip` (after `hintMode`, `zoom`, `activeDragCohort`, `inspection`, exploded cells). Question: does a per-island **selector store** beat the `{...wiring}` prop-spread for board view state?

Rule to challenge: `context/foundation/ui-conventions.md:219-235` ("State management" + the "Cell wiring is a spread, not a Context" amendment).

Key points that came out of the `planner-board-search-discovery` research:

- The rule **conflates Context (broadcast, memo-exempt — every consumer re-renders on value change, even under the React Compiler) with selector stores (granular — only components whose selected slice changed re-render).** They have opposite re-render semantics; the rule bans both in one breath (`ui-conventions.md:221`).
- Its perf rationale is scoped to **high-frequency** state ("`dropHints`/`hintMode` change on every drag tick", `ui-conventions.md:233`) against the <200 ms drag-drop budget. It should not be reflexively applied to **low-frequency** view flags like a lens selection.
- A **selector store** (`useSyncExternalStore` + a stable store ref) would kill the prop-drill AND drop the per-tick **parent** re-render (today `PlannerGrid` re-renders each drag tick to recompute per-cell scalars, then children bail via compiler memo). The "stable store ref in Context" pattern also dodges the rule's literal objection — the context *value* never changes.

Costs to weigh (stack-specific):

- **SSR/island safety on Cloudflare Workers** — no module-global `create()` singleton (leaks state across requests/islands); scope per-island (Jotai `Provider`, store-ref-in-Context, or a store created at an island root).
- **React Compiler compat** — fine; `useSyncExternalStore` is the sanctioned escape hatch, left alone by the compiler.
- **Novelty tax** — first store in the codebase; "one new way to do things" is exactly what the no-store default buys. `deriveHighlight` and other pure `model/` fns stay pure either way — a store would hold only *selection/view state*, not derivations.

Suggested route: **`/10x-frame`** first to fix the adoption threshold/trigger (when is a selector store warranted board-wide?) before planning. Outcome may update `ui-conventions.md:219-235` and the lens plan's §4 "trap" note.

Sibling context: `context/changes/planner-board-search-discovery/research.md` §4 (Architecture fit & performance). The lens itself threads the spread regardless of how this lands — this change does not block it.

## Follow-up recommendation (deferred)

The frame's Narrowing Signals + Reframed Problem Statement (`frame.md`) located the real per-flag authoring cost — ~15 edit sites — in three cost centers *outside* the prop-spread transport this change debated:

1. **Persistence-module cloning** — five near-identical ~50-line `lib/` `useSyncExternalStore` micro-stores (`drag-hint-mode.ts`, `board-zoom.ts`, `shelf-pinned.ts`, `palette-cohort.ts`, `palette-collapsed.ts`).
2. **Control-surface widening** — `BoardSettingsMenu` value/setter pairs plus a bespoke control file per flag.
3. **Derivation-seam plumbing** — `use-board-derivations.ts → useCohortDerivations → toCohortState → useCombinedBoardState`.

A consolidation change targeting these is worth considering **after the highlight/discovery lens lands** — the lens reshapes what's worth consolidating, so this change deliberately opens **no follow-up folder now** (per plan "What We're NOT Doing"). Recorded here so the cost-center evidence isn't lost.
