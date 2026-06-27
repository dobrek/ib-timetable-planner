<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Plan-Detail Slice Refactor

- **Plan**: context/changes/plan-detail-refactor/plan.md
- **Scope**: All 9 phases (full plan)
- **Date**: 2026-06-28
- **Verdict**: APPROVED
- **Findings**: 0 critical · 1 warning · 2 observations
- **Triage**: all three findings FIXED inline (no deferred follow-ups)

## Gates (re-run live this review)

`pnpm check` 0 errors · `pnpm test` 686/686 (82 files) · `pnpm steiger` clean · `pnpm lint` clean —
matching the plan's recorded final state. Build + integration (53/53) + e2e (18/18) were recorded
green at the final phase commits; NOT re-run in this review (they need the local Supabase stack /
browser). Re-run after the triage edits: check / test / lint still green.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Phase 7 router mechanism inverted vs. the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/_pages/plan-detail/model/cross-cohort/drop-router.ts:29-35,44,56,62,71
- **Detail**: The plan made cohort-TAGGING the single board's cells/drags the *primary* mechanism for
  routing through `resolveCombinedDrop` ("Single-board SlotCellHost receives cohort={cohort} …
  harmless"), with the `?? activeCohort` fallback explicitly demoted to belt-and-suspenders ("do not
  let the fallback mask a missing tag"). The implementation ships the inverse: single-board cells/drags
  stay UNTAGGED and the `cell.cohort ?? activeCohort` / `data.cohort ?? activeCohort` fallback is the
  sole mechanism. Justified in-code: the single-board `cohort` prop also drives the cell `aria-label`
  and the parked-card tag, so tagging would have changed visible/ARIA output (a behavior break) — the
  plan's "harmless to tag" was wrong. Safer, fully tested (drop-router.test.ts:100-169 single-cohort
  cases), behavior-preserving; the masking risk the plan feared cannot bite (one provider → one cohort
  → untagged cell deterministically resolves to it).
- **Fix**: Add a one-line addendum to change.md / plan.md Phase 7 recording the documented inversion.
- **Decision**: FIXED — appended "Implementation deviation — Phase 7 router mechanism" section to
  change.md.

### F2 — useCellWiring memo gives no real stability; doc/test overstate it

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/ui/grid/use-cell-wiring.ts:4-16
- **Detail**: The doc comment claimed the `useMemo` yields a referentially-stable `CellWiring` on an
  idle board (tied to the <200ms budget), and Phase 4's success criterion 4.3 asserts a "render twice
  → toBe" test. But the live inputs are NOT stable: `usePlacements` returns plain `function`
  declarations (use-placements.ts:126,145) and PlannerBoard feeds those + a local `function liftBundle`
  (PlannerBoard.tsx:89-94,153) into the hook, so the memo recomputes every render; the `toBe` test
  passes only with synthetic stable inputs. Harmless — SlotCell/PlacedChip are deliberately un-memoized
  (SlotCell.tsx:102), so wiring identity never gates a re-render. The hook earns its keep as the
  11-field→1-prop bundler, not as an active optimization.
- **Fix**: Trim the comment's referential-stability claim; describe the hook as the prop-bundler and
  note 4.3 asserts an idealized stable-inputs contract.
- **Decision**: FIXED — rewrote the use-cell-wiring.ts doc comment.

### F3 — Trailing public exports below private helpers (newspaper order)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/model/use-cohort-board-state.ts:184,199 (pre-fix)
- **Detail**: Exported `useCohortBoardState` and `indexFromPlacements` sat below the private helpers
  (`useCohortPlacements`, `useCohortDerivations`, `toCohortState`). The primary public hook
  `useCombinedBoardState` was correctly first; the two trailing exports were grouped with their seam.
  Minor deviation from the project's public-function-first convention.
- **Fix**: Hoist the two exported functions above the private helpers.
- **Decision**: FIXED — reordered so all three exported functions precede the private helpers
  (cross-references resolve at call-time; check/test/lint still green).

## What went right (evidence)

- Scope: only the slice + the planned `ui-conventions.md` changed — zero out-of-slice creep.
  Constraint-core files (`collision/constraints/*`) diff to import-path-depth changes only; zero
  algorithm edits.
- No store / no wiring Context introduced (grep: 0 `createContext`/`useContext`) — the `{...wiring}`
  spread is the fix, as planned.
- `callActionData` preserves the throw-on-error contract 1:1; optimistic-rollback catch path intact.
  `toPlannerPlacement` dedup is a byte-identical row→domain map (no name/ID conflation).
- Cross-cohort live-index cycle sequencing preserved; combined view correctly does NOT call the new
  assembler twice; `not.toBe` identity guard kept + extended with a live-mutation case.
- Drop-router unification verified branch-by-branch — no silent drops (course/grouping→shelf park,
  placement/parked×shelf no-ops all intact).
- Theme tokens clean (0 hardcoded colors in changed .tsx); barrels are pure; localStorage guarded;
  FSD layering clean (drag-inert→lib/ removed the shelf→grid edge); single-board `empty` early-return
  preserved.
