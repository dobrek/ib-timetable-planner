# Plan-Detail Slice Refactor — Plan Brief

> Full plan: `context/changes/plan-detail-refactor/plan.md`
> Research: `context/changes/plan-detail-refactor/research.md`

## What & Why

A fully behavior-preserving refactor of `src/_pages/plan-detail/` (the app's largest slice), done now
that its feature set is complete. The single board (`/plans/[id]`) and the combined board
(`/plans/[id]/combined`) carry hand-synced duplication: two per-cohort state assemblies, a copy-pasted
DnD shell, hand-threaded cell wiring, and mirrored palette/shelf chrome. We collapse both onto a shared
core, restructure `ui/`, and clean the tail — so the two boards become thin shells over one set of seams.

## Starting Point

The slice is well-built (pure `model/` core, disciplined optimistic writes, a deliberate cross-cohort
live-index cycle) and the pure core is densely unit-tested. The prerequisite `combined-view-park-gap` is
**merged and green at HEAD `4039b66`**, so both boards now park-to-shelf symmetrically — which removed
the only behavioral/product risk. The exposure is the board-wiring layer: the single board's `handleDrop`
has no test, and the combined live-revalidation cycle is only tested at its leaf.

## Desired End State

Both boards are thin shells over a single per-cohort state assembler, a single `BoardShell` layout, one
shared `PLUGINS`, and one `resolveCombinedDrop` router (single board = degenerate one-cohort case). `ui/`
root holds only the 3 `.astro` entries + 2 board orchestrators; the rest lives under
`palette/`/`grid/`/`shelf/`/`overlay/`/`chrome/`. A shared `CollapsibleEdgePanel` backs palette + shelf
and fixes the combined cohort-switcher hierarchy. `model/`/`api/` are grouped/cleaned and
`ui-conventions.md` documents the new structure.

## Key Decisions Made

| Decision                          | Choice                                              | Why (1 sentence)                                                                                  | Source   |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| Wiring fix                        | Bundled object + `{...wiring}` spread; **no Context** | No compiler transform → manual memo; drag state changes every tick → Context re-renders all cells | Research |
| Park-gap (the one behavioral risk) | Split out + already merged (`combined-view-park-gap`) | Fixing it first made the boards symmetric → router unification became mechanical                  | Research |
| Drop-router unification           | Full unify onto `resolveCombinedDrop`, gated by char. test | Both boards now park symmetrically; only risk is the untested single `handleDrop` seam            | Plan     |
| Single-board palette via shell    | ready + stale via `CollapsibleEdgePanel`; empty stays board-level | The full-screen empty early-return is genuinely board-level and skips the island                  | Plan     |
| Verify cadence                    | Fast gate every phase; integration + e2e at wiring boundaries | e2e (the only board-wiring catch) is slow + needs Supabase — spend it where the blind spot is     | Plan     |
| Scope                             | All in; tail (renames, `model/` grouping, `api/`) as final droppable phases | Everything is behavior-preserving + cohesive; cheap tail lands while context is hot               | Plan     |
| Convention edits                  | Land 3 `ui-conventions.md` amendments with the phases they justify | Make the new structure self-documenting                                                           | Research |

## Scope

**In scope:** characterization tests; `ui/` 5-folder restructure (+ `slot-cell/`→`grid/`, `drag-inert`→`lib/`);
shared `CollapsibleEdgePanel` + palette-header UX fix + combined palette state-unification; single-path
wiring → spread; shared per-cohort assembler; `BoardShell` + shared `PLUGINS`; unified drop router; renames
+ `model/` grouping; `api/` cleanup; 3 `ui-conventions.md` amendments.

**Out of scope:** any behavior change beyond the cohort-switcher reposition; constraint-core algorithm
changes; the single board's full-screen empty state; a wiring Context; rewriting the superseded research §C body.

## Architecture / Approach

Sequence risk *after* its safety net: characterization tests first; then low-risk structural moves
(folders, shared edge panel); then board-core unification in increasing-risk order (wiring → assembler →
shell → router); then the droppable mechanical tail. The combined view already invented the better seams
(bundled wiring + spread, the per-cohort `CohortBoardState`), so most work is making the single board adopt
tested-in-production patterns, not inventing abstractions.

## Phases at a Glance

| Phase                          | What it delivers                                          | Key risk                                                  |
| ------------------------------ | -------------------------------------------------------- | --------------------------------------------------------- |
| 1. Characterization tests      | Pure single-drop resolver + hook tests for untested seams | Must capture current behavior exactly before any move     |
| 2. `ui/` 5-folder restructure  | Final folder tree + barrels + `drag-inert`→`lib`          | Moved-import / test-depth misses (steiger + check catch)  |
| 3. `CollapsibleEdgePanel`      | Shared palette/shelf shell + switcher hierarchy fix       | Touches palette + shelf render; the one intended UX change |
| 4. Single-path wiring spread   | One `wiring` object + `{...wiring}`                       | Referential stability (manual memo)                       |
| 5. Shared per-cohort assembler | One assembler, both routes                                | Must preserve the cross-cohort live-index cycle exactly   |
| 6. `BoardShell` + `PLUGINS`    | Both boards as thin shells                                | Reconciling empty-return / summary / inspection divergences |
| 7. Unified drop router         | One `resolveCombinedDrop` for both boards                 | **Riskiest** — needs cohort-tagging the single board; gated by Phase 1 |
| 8. Renames + `model/` grouping | Naming collisions resolved + grouped folders             | Pure move; depth/steiger                                  |
| 9. `api/` cleanup              | `callAction`, `{error}` align, `toPlannerPlacement` dedup | Loader output parity (api integration tests)              |

**Prerequisites:** `combined-view-park-gap` merged (✅ done, HEAD `4039b66`); local Supabase stack for
integration + e2e at the wiring boundaries.
**Estimated effort:** ~6–9 focused sessions across 9 phases; the architectural core (Phases 4–7) is the bulk.

## Open Risks & Assumptions

- **Router unification (Phase 7) is the one real risk**: the single board's cells/drags carry no cohort
  today, so unification requires tagging them with the board's one cohort to make the cross-cohort guard a
  trivial pass. Mitigated by Phase 1's characterization test and the combined board already exercising the
  cohort-carrying path.
- The cross-cohort live-index cycle must be preserved verbatim through Phase 5; the `not.toBe`
  fresh-identity test is the guard.
- e2e is the only catch for board-wiring breaks; relying on the fast gate alone for the pure-move phases
  assumes those phases truly can't change behavior (they only move/rename files).

## Success Criteria (Summary)

- Both routes behave identically to today (modulo the intended cohort-switcher reposition) under manual smoke.
- Full local gate green (`pnpm check` · `lint` · `steiger` · `test` · `build`) + `pnpm test:integration`
  + `pnpm test:e2e` pass.
- The two boards are thin shells over one shared assembler, shell, `PLUGINS`, and drop router; `ui/` is the
  finalized 5-folder tree; `ui-conventions.md` carries the three amendments.
