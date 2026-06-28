<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Editing Undo / Redo (S-08, FR-013)

- **Plan**: context/changes/editing-undo-redo/plan.md
- **Scope**: Full plan — Phases 1–4 of 4
- **Date**: 2026-06-28
- **Verdict**: NEEDS ATTENTION → **resolved at triage** (both warnings fixed; both observations consciously skipped)
- **Findings**: 0 critical, 2 warnings, 2 observations
- **Triage outcome (2026-06-28)**: F1 FIXED (Fix A — identity-safe pop-at-dispatch commit), F2 FIXED (synchronous `inFlightRef`), F3 SKIPPED (documented trade-off), F4 SKIPPED (benign extraction). Post-fix gates: `pnpm test` 782✓ · `pnpm check` 0 errors✓ · `pnpm lint`✓ · `pnpm steiger`✓ · `pnpm build`✓.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (integration + e2e not re-run — infra-gated; marked passing at 31673f6) |

Gates re-run during review: `pnpm test` 780✓ · `pnpm check` 0 errors✓ · `pnpm lint`✓ · `pnpm steiger`✓ · `pnpm build`✓.

14/14 planned files faithfully implement their contracts. Minor benign drifts: store held in lazy `useState` vs `useRef`; tooltip prefixed "Undo:"/"Redo:"; new reconcile transitions authored rather than reusing the (ill-fitting) existing ones.

## Findings

### F1 — Commit removes by position, not identity → forward edit during in-flight reconcile corrupts the stacks

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability / Data safety)
- **Location**: src/_pages/plan-detail/model/history/history-store.ts:55-62 · src/_pages/plan-detail/model/history/use-history.ts:75-86
- **Detail**: `step` peeks the top entry (no pop) and defers the stack mutation into the async `.then`, where `commitUndo`/`commitRedo` do `undoStack = undoStack.slice(0, -1)` (remove-by-position). The in-flight `busy` guard gates undo/redo but NOT forward edits — `usePlacements.busy` is consumed only by `useHistoryControls` (confirmed by grep; the board's drag-drop/chip handlers never read it). A drop whose RPC settles during an in-flight undo calls `record()` → `store.push()`, appending a new entry and clearing redo. When the undo's `.then` runs, `slice(0,-1)` strips the NEW edit (not the undone one); the undone entry stays on the undo stack and the redo entry points at a stale target. A later ⌘Z then issues a real Supabase reconcile to the wrong target — defeating the "commit-on-success / always durable" guarantee.
- **Fix A ⭐ Recommended**: Make the commit identity-safe — pop synchronously at dispatch (before `applyReconcile`) and re-push on `{ok:false}`, instead of peek + positional `slice(0,-1)` in `.then`.
  - Strength: Closes the corruption at the source (the store); the same change also hardens F2's double-dispatch. Board stays interactive during undo.
  - Tradeoff: Slightly more bookkeeping (restore the entry on failure).
  - Confidence: HIGH — the entry object is already in hand at dispatch; pop/re-push is local to history-store + step.
  - Blind spot: Must re-push to the correct stack on failure so a retried undo still converges.
- **Fix B**: Surface `busy` to the board and ignore/queue forward edits while a reconcile is in flight.
  - Strength: `busy` is already computed — just not wired up; smallest conceptual change.
  - Tradeoff: Blocks legitimate fast editing during an undo RPC; doesn't fix F2.
  - Confidence: MED — depends on every edit entry point honoring it.
  - Blind spot: Haven't enumerated all forward-edit call sites.
- **Decision**: FIXED via Fix A — `history-store.ts` transfer API changed to pop-at-dispatch + non-clearing `pushUndo`/`pushRedo`; `use-history.ts` `step` pops synchronously, restores on failure, commits the exact popped entry on success. Store tests rewritten to the new transfer model + added "transfer push must not clear redo" test.

### F2 — In-flight guard is render-derived, not synchronous; `step` has no reentrancy guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability / race)
- **Location**: src/_pages/plan-detail/model/history/use-history.ts:71-86 · src/_pages/plan-detail/model/use-placements.ts:624 · src/_pages/plan-detail/model/history/use-undo-keymap.ts:18-39
- **Detail**: `busy` is plain render state; `applyReconcile` flips it via `setReconciling(true)` (use-placements.ts:624), visible only after a re-render + the deferred keymap effect re-subscribes. `step` checks `if (busy) return` against the render closure and peeks (no synchronous in-flight ref). In the window between a keydown firing and React re-rendering, a second keydown — a fast double ⌘Z landing inside one render frame — is handled by the still-attached old listener with stale `busy === false`, peeks the SAME entry, and launches a second `applyReconcile` → both `.then`s commit → double `slice(0,-1)`, same corruption as F1. (Auto-repeat is a narrower trigger; the realistic trigger is a fast deliberate double-press.) Shares root cause and remedy with F1.
- **Fix**: Back the guard with a synchronous in-flight ref — set it at the top of `step`, clear it in `.then`/`finally`, check it synchronously. (Fix A on F1 plus this ref fully serializes dispatch.) Once synchronous, `undo`/`redo` can be `useCallback`-stabilized to also stop the every-render keymap re-subscribe.
- **Decision**: FIXED — added `inFlightRef = useRef(false)` in `useHistoryControls`; `step` early-returns on `busy || inFlightRef.current`, sets the ref at dispatch, clears it in `.finally`. Added a "synchronous double-undo runs only one reconcile" regression test. (The `useCallback` memoization noted as optional was left as-is — now a perf nicety, no longer load-bearing for correctness.)

### F3 — Decomposed merge-undo path is non-atomic (documented trade-off)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Safety & Quality (Data safety)
- **Location**: src/_pages/plan-detail/model/history/reconcile-exec.ts:65-78 · src/_pages/plan-detail/model/use-placements.ts:662-669
- **Detail**: The decomposed fallback (card-deletes → board-removes → board-places → card-creates) is several independent RPCs. If a later step rejects after earlier ones committed, the catch rolls the CLIENT back to pre-reconcile while the server retains the partial application — silent divergence until reload, and a retry diffs from the rolled-back client, not the diverged server. This is the plan's explicitly-accepted "lone non-atomic path, bounded to merge-undo," so it's a known trade-off, not a defect. Ordering is correct.
- **Fix**: Optional — refetch/resync the affected scope on a decomposed-path failure so a retry diffs from true server state. Defer unless merge-undo failures show up in practice.
- **Decision**: SKIPPED — documented, accepted trade-off bounded to the rare merge-undo; revisit only if it surfaces in practice.

### F4 — Unplanned file `reconcile-apply.ts` (benign, justified extraction)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/_pages/plan-detail/model/history/reconcile-apply.ts (+ .test.ts)
- **Detail**: The plan placed `applyReconcile` inside `use-placements.ts`. The impl keeps `applyReconcile` there (line 611) but extracts its pure single-pass transitions (`reconcilePlacementsOptimistic`, `settleReconcile*`, `rollbackReconcile*`) into a new file. Justified: the plan's "reuse existing optimistic transitions" don't fit (`removeManyOptimistic` removes by id, reconcile by business key; `addManyOptimistic` is single-cell, merge-undo re-places at two). The new file is framework-free, unit-tested, and mirrors the `placement-transitions.ts` / `shelf-transitions.ts` concept-file convention. No "What We're NOT Doing" boundary crossed.
- **Fix**: No code change. Optionally note the extraction as a one-line plan addendum so the file list stays the source of truth.
- **Decision**: SKIPPED (no action) — clean, convention-following extraction; no code change warranted.
