# Unify plan-detail views (combined = the board, single = a focus mode) — Plan Brief

> Full plan: `context/changes/plan-detail-unify-views/plan.md`
> Change notes: `context/changes/plan-detail-unify-views/change.md`
> Research: `context/changes/plan-detail-unify-views/research.md`

## What & Why

Today the plan-detail page has **two** parallel orchestrators — a single-cohort board and a combined two-cohort board — each with its own component, grid, palette, route, and loader. This change makes the combined two-cohort board **the** board (and the default landing surface) and turns a single cohort into a **focus mode** of it. The user-facing model: single vs combined is a *convenience choice about how to build a plan*, not two architectural intents. Goal: one main component, a few presentation modes, one entry point to evolve.

## Starting Point

The p1–p9 `plan-detail-refactor` already did the valuable 90%: all of `model/` (collisions, constraints, the cross-cohort index), `BoardShell`, the one drop router (`resolveCombinedDrop`), the per-cohort state pipeline (`use-cohort-board-state.ts`), the cell internals, and `PaletteBody` are shared. Only the two thin top-level orchestrators + their routes/loaders still diverge — plus a duplicated, untested drop `switch` and a `cohort?`-optionality thread kept solely so the single board's cells stay untagged.

## Desired End State

One board component parameterized by `focus: "dp1" | "dp2" | "combined"`, rendered from one route (`/plans/[id]?focus=…`, bare → combined) by one loader (`loadCombinedPlannerData`). `combined` is today's two-cohort board plus a summary bar; `dp1`/`dp2` render one column locked to that cohort. The drop dispatch is one canonical, unit-tested `applyDropAction`. The second grid, second palette, second wrapper, single loader, and `/combined` route are gone.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Loader strategy | Always load both cohorts | SSR-only ~+44% query cost, zero per-drag cost; one loader for every mode | Research |
| Routing / URL | Single `?focus=` param, hard cut | One route; no external links to preserve, least code | Research |
| Cell a11y / dnd ids | Always tag cohort; delete optionality | Collapses the `?? activeCohort` branches; small test blast radius (one block) | Research |
| Focus-mode chrome | Preserve single's UX + upgrade combined | Keep summary bar + full-screen empty in focus; add summary bar to combined; honor palette cookie everywhere | Research |
| `handleDrop` switch | Extract `applyDropAction`, build it first | Only untested handler logic; de-risks and seams the unification | Research |
| Default landing view | **Combined** | The bare URL should embody "combined is the board" | Plan |
| Grid | **Merge** to one parametric grid (`columns: PairedColumn[]`) | One grid to evolve; mirrors the "single = degenerate combined" framing | Plan |
| Palette | **Merge** to one panel + optional switcher toolbar | Deletes ~60 ln; the switcher exists only because of multiple cohorts | Plan |

## Scope

**In scope:** the `applyDropAction` extraction + tests; cohort-always-tagged (delete optionality, rewrite the affected test block); parametric grid + one-panel palette merge; one `focus` board; one `?focus=` route + one loader; summary bar added to combined; palette cookie honored in all modes; migrate the production read-boundary integration tests; retire the loader-parity tests.

**Out of scope:** redirects/aliases for old URLs; any change to the constraint/validation core or the per-drag latency path; folding `SlotCellHost` into `SlotCell`; extracting `handleDragStart`; a lighter "partial sibling props" loader.

## Architecture / Approach

The crux is the **cross-cohort index cycle**: each cohort's live occupancy index is derived from the other column's current placements, resolved in one render by `useCombinedBoardState`. "Single = combined focused on one cohort" means **both cohorts are always instantiated**, so the state hook is always called with a constant hook count of 2 — dissolving the Rules-of-Hooks blocker. The unified board therefore always runs `useCombinedBoardState(dp1, dp2)` and branches on `focus` **only when rendering** (one column vs two, switcher shown vs locked, full-screen vs in-panel empty, sibling-dim on vs off). The remaining single↔combined differences reduce to a handful of `focus`-conditioned presentation branches plus the now-deletable cohort-optionality.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. `applyDropAction` seam | One tested drop dispatch; both boards routed through it (standalone PR) | Subtle divergence in the merged switch — covered by new unit tests |
| 2. Cohort-always-tagged | Required cohort everywhere; optionality deleted | The one user-visible change (a11y labels, parked badge) — verify deliberately |
| 3. Grid + palette merge | One parametric grid, one palette panel | Must be a visual no-op — `length===1` path must match today's single render |
| 4. Orchestrator + route + loader collapse | One `focus` board, one route, one loader; dead code deleted | Atomic route/loader switch; migrate (not drop) the integration tests |

**Prerequisites:** Phase 1 is independent; Phases 2→3→4 are sequential. The parity/characterization tests are the guardrail throughout (the *loader*-parity ones retire in Phase 4, their job done).
**Estimated effort:** ~4 sessions, one per phase (Phase 1 shippable on its own; Phase 4 is the largest).

## Open Risks & Assumptions

- **Combined summary-bar semantics**: the plan specifies plan-wide *aggregate* counts (both cohorts) in combined mode — confirm during Phase 4 manual review that aggregate (not per-active-cohort) reads right.
- **Hint-toggle relocation**: focus mode's hint toggle moves from above-the-grid into the header for a single shared header — a small, intended visible change.
- **Phase 3 must be a visual no-op**: any pixel drift means the parametric grid/palette guards (`columns.length`) are wrong, not a behavior decision.
- Assumes data scale stays small (always-load-both is negligible); revisit only if a plan grows far beyond ~40 placed courses/cohort.

## Success Criteria (Summary)

- One board, one route, one loader: `/plans/[id]` lands on combined; `?focus=dp1|dp2|combined` each render correctly and the switcher cycles all three.
- Every drag/move/park/lift/place-back behaves as before in each mode; cross-cohort move rejection still holds in combined; per-drag latency unchanged.
- `pnpm steiger`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build` all clean; no `loadPlannerData`/`CombinedPlannerBoard`/`?cohort=`/`/combined` references remain.
