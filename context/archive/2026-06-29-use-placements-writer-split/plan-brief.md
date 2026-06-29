# Split `usePlacements` into a WriteContext + writer factories — Plan Brief

> Full plan: `context/changes/use-placements-writer-split/plan.md`
> Research: `context/changes/use-placements-writer-split/research.md`
> Proposal: `context/changes/use-placements-writer-split/report.md`

## What & Why

`usePlacements` is correct but function-dense: its body is ~22 inner functions (12 public handlers + 10 async `persist*` orchestrators). Extract the forward write path into two plain factory modules (`board-writes.ts`, `shelf-writes.ts`) driven by a shared `WriteContext`, collapsing the hook to state + assembly. This honors the house rule "pure logic in `model/`, hooks orchestrate," and makes each writer unit-testable without rendering — the payoff inline functions can't give.

## Starting Point

The hook (664 lines) already sits on the foundation this needs, shipped by the merged `use-placements-cleanup` change: RPCs bound via `makeRpcs`/`rpcs` (`api/rpcs.ts`), the undo/redo path already extracted into `useReconcileExecutor` with stores injected by ref + setter (`history/use-reconcile-executor.ts`), pure transitions in `placement/*-transitions.ts`, and the React Compiler enabled. The forward write path is what remains inline.

## Desired End State

`use-placements.ts` reads as a thin orchestrator: state, `rpcs`, a `ctx: WriteContext`, `useReconcileExecutor(ctx)`, `createBoardWrites(ctx, boardDeps)`, `createShelfWrites(ctx)`, `busy`, and a return that spreads `...board`/`...shelf`. The write logic lives in two cohesive, single-concern modules, each with its own unit tests. The planner board behaves identically — nothing user-visible changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Baseline | Build on `use-placements-cleanup` (now merged to `main`) | The report's premises (`makeRpcs`, `useReconcileExecutor`, React Compiler) are real once `main` is pulled. | Plan |
| Scope | Full split (Phases 0–4) | Cleanest end state; Phase 4 is nearly free since the executor already takes a `WriteContext` subset. | Plan |
| Split axis | `board-writes` / `shelf-writes` (by store) | Matches the axis the two stores already draw; intuitive board-vs-shelf mapping. | Plan |
| Testing | Add `board-writes`/`shelf-writes` unit tests | Realizes the proposal's core payoff (testability), in the framework-free `*-transitions.test.ts` style. | Plan |
| Executor param type | Keep narrow `ReconcileExecutorDeps` (pass `ctx`, don't retype) | Preserves the structural recorder-bypass invariant — the executor still *cannot* record undo entries. | Research |
| `WriteContext` shape | Superset of `ReconcileExecutorDeps` (+ `recordEdit`) | Lets the executor consume `ctx` unchanged via structural subtyping; `weekModeOf` is board-only so it rides in `boardDeps`, not `ctx`. | Research |
| `useLatest` home | Stays in `use-placements.ts` | Cosmetic; the ref-lag footgun note stays next to its only consumers. | Plan |
| Memoization | Leave factories unmemoized | React Compiler is on and `toCohortState` already rebuilds `actions` per render — same precedent. | Research |

## Scope

**In scope:** `WriteContext` + `cellScope` module; `createBoardWrites`/`createShelfWrites` factories; moving the 10 persisters + handlers + duplicate search + `DuplicateOutcome`; passing `ctx` to `useReconcileExecutor`; new factory unit tests.

**Out of scope:** any behavior change; RPC/action/schema changes; retyping the executor's param; moving `useLatest`; a generic `runOptimistic` wrapper; hand-written `useMemo`/`useCallback`.

## Architecture / Approach

Third application of one fracture pattern in this slice: pure transitions → reconcile executor (ref+setter injection) → forward writers (`WriteContext` injection). The hook builds one `ctx` object closing over its state setters/refs/`rpcs`/`recordEdit`/`snapshot`/`weekModeOf`; the executor and both factories consume it. `board-writes` additionally takes `boardDeps` (the duplicate-search oracle inputs + `setLastDuplicated`). Public return surface is preserved, so `use-placements.test.tsx` is the live regression guard.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 0. Fold wrappers | ~9 logic-free forwarders inlined into the return object | None (mechanical) |
| 1. WriteContext + ctx + executor | `write-context.ts`; `ctx` assembled; `useReconcileExecutor(ctx)` | Member ordering above the executor call; don't re-open recorder-bypass |
| 2. shelf-writes | `createShelfWrites(ctx)` + tests; two-store ops moved | Two-store rollback correctness for `shelve`/`placeBack` |
| 3. board-writes | `createBoardWrites(ctx, boardDeps)` + tests; hook is thin | Largest move — duplicate search + group partial-failure paths |

**Prerequisites:** `main` pulled to include the `use-placements-cleanup` merge (done — `f14612a`).
**Estimated effort:** ~1–2 sessions across 4 phases; Phase 0 is minutes, Phase 3 is the bulk.

## Open Risks & Assumptions

- The structural recorder-bypass invariant depends on **not** retyping the executor's param to `WriteContext` — called out as a Critical Implementation Detail.
- `ctx`-threading is exactly the change class where esbuild/Vitest pass but types break — gate every phase on `pnpm check` (per `lessons.md`).
- Existing-test interception holds only because `makeRpcs` re-binds the same `placement-client`/`shelf-client` modules the suite mocks (true today).

## Success Criteria (Summary)

- `use-placements.test.tsx` passes unchanged through all phases; new `board-writes`/`shelf-writes` tests pass.
- `/verify` (incl. `pnpm check`, lint, steiger, build) is clean.
- The planner board — add/move/remove/duplicate/shelve/place-back/park and undo/redo — behaves identically in the app.
