# Split `usePlacements` into a WriteContext + writer factories — Implementation Plan

## Overview

Extract the `usePlacements` forward write path — the 10 async `persist*` orchestrators and their thin public handlers — into two plain factory modules (`board-writes.ts`, `shelf-writes.ts`) driven by a shared `WriteContext`. The hook collapses from a ~520-line body of inner functions to state + `ctx` assembly + factory calls. **Behavior-preserving**: the public return surface is unchanged, so `use-placements.test.tsx` stays green throughout. This is the deliberate next increment on top of the merged `use-placements-cleanup` work (`makeRpcs`, `useReconcileExecutor`, React Compiler).

## Current State Analysis

`src/_pages/plan-detail/model/use-placements.ts` (664 lines) owns island-local placement + parked-bundle state and the optimistic write path. After the `use-placements-cleanup` change it already sits on the foundation this split needs:

- **`rpcs`** — `const rpcs = useMemo(() => makeRpcs(planId, cohort), [planId, cohort])` (`use-placements.ts:155`); persisters call `rpcs.placeCourse(…)` etc. `Rpcs` = 8 pre-bound methods (`api/rpcs.ts:13-35`).
- **`useReconcileExecutor`** — the undo/redo machinery is already a separate hook taking a ref+setter deps object (`history/use-reconcile-executor.ts:49-57`), consumed at `use-placements.ts:159-167`.
- **Pure transitions** — `placement/placement-transitions.ts`, `placement/shelf-transitions.ts` (framework-free, unit-tested without rendering).
- **React Compiler** — enabled in `astro.config.mjs:41-43` (`babel-plugin-react-compiler`, `target: "19"`), so handlers are auto-memoized; the no-`useCallback` style is justified.
- **Two known limits** documented in-code: single last-writer-wins error slot (`use-placements.ts:145-147`); `useLatest` one-commit ref lag (`use-placements.ts:653-657`).

What's left dense: the hook body is one long list of inner functions — **12 public handlers** (`use-placements.ts:180-284`, ~9 of which are logic-free `void persist*` forwarders) + **10 `persist*` orchestrators** (`use-placements.ts:286-614`) + helpers (`weekModeOf` 169, `recordEdit` 176, `courseIdsAt` 267, `cellScope` 617, `snapshot` 623).

### Key Discoveries:

- **`WriteContext` is a superset of the executor's deps.** `ReconcileExecutorDeps` = `{ snapshot, placementsRef, parkedBundlesRef, setPlacements, setParkedBundles, setError, rpcs }` (`use-reconcile-executor.ts:23-32`). The proposed `WriteContext` adds only `recordEdit` (shared by every forward persister). `weekModeOf` is read **only** by the board persisters (`persistAdd`, `persistAddGroup`), so it rides in `boardDeps`, not the shared `ctx` (keeps `WriteContext` to genuinely-shared members). So `useReconcileExecutor(ctx)` typechecks **with no change to the executor** (structural subtyping; excess-property checks fire only on fresh object literals, not a `ctx` variable).
- **The recorder-bypass invariant is structural and must stay that way.** The executor *cannot* record undo entries because `recordEdit` is not in its deps (`use-reconcile-executor.ts:47`). `WriteContext` *does* carry `recordEdit`. Keep the executor's **param type as the narrow `ReconcileExecutorDeps`** so `recordEdit` is never in scope inside it — passing the wider `ctx` is fine, retyping the param to `WriteContext` is NOT (it would re-open the bypass).
- **Tests intercept by module path.** `use-placements.test.tsx` mocks `../api/placement-client` / `../api/shelf-client` by path; `makeRpcs` re-binds those same exports (`api/rpcs.ts:8-9` doc comment), and the factories will call through the same `rpcs`. So interception is preserved — the existing suite stays green.
- **`findDuplicateTarget` oracle inputs** (`use-placements.ts:241-250`) = `catalogById, availabilityIndex, crossCohortIndex, days, periods` — exactly the board factory's extra deps.
- **Test precedent**: `placement/*-transitions.test.ts` test pure functions with plain data, no `renderHook`/`render`. New factory tests follow this style with a fake `WriteContext`.

## Desired End State

`use-placements.ts` is a short orchestrator: state hooks, `rpcs`, `ctx` assembly, `useReconcileExecutor(ctx)`, `createBoardWrites(ctx, boardDeps)`, `createShelfWrites(ctx)`, `busy`, and a return that spreads `...board` and `...shelf`. The forward write logic lives in `placement/board-writes.ts` and `placement/shelf-writes.ts`, each unit-tested against a fake `WriteContext` without rendering. `placement/write-context.ts` defines the `WriteContext` type + the `cellScope` helper. **Verification**: `use-placements.test.tsx` passes unchanged; new `board-writes.test.ts` / `shelf-writes.test.ts` pass; `pnpm check`, `lint`, `steiger`, `build` clean; the planner board behaves identically in the app (add/move/remove/duplicate/shelve/place-back/park, undo/redo).

## What We're NOT Doing

- **No behavior changes.** No RPC/action/schema changes; no change to undo/redo semantics, optimistic/rollback logic, or the two-store atomicity of shelve/place-back.
- **Not retyping `useReconcileExecutor`'s param** to `WriteContext` (preserves the structural recorder-bypass invariant — see Key Discoveries).
- **Not moving `useLatest`** out of `use-placements.ts` (report §11.2 — cosmetic; the footgun note stays next to the only ref consumers).
- **Not memoizing the factories** (`useMemo` on a stabilized `ctx`). React Compiler is enabled and `use-cohort-board-state.ts`'s `toCohortState` already rebuilds its `actions` object every render unmemoized — same precedent. Revisit only if profiling shows a problem.
- **No generic `runOptimistic` wrapper** (explicitly out of scope in the predecessor change too).

## Implementation Approach

Four independently-shippable phases, smallest-risk first. Phase 0 (fold wrappers) is a zero-risk warmup. Phase 1 introduces `WriteContext` and proves the shape by wiring it into its first consumer (the executor) before any forward-path code moves. Phases 2–3 move the shelf path (smaller, validates the seam) then the board path. Each phase keeps the public surface identical, so `use-placements.test.tsx` is the live regression guard; run `/verify` (which includes `pnpm check`) before each phase lands.

## Critical Implementation Details

- **State sequencing (Phase 1).** `ctx` is consumed by `useReconcileExecutor` at the top of the hook (currently `use-placements.ts:159`), but `recordEdit` (176) — a `ctx` member — is a `const` arrow defined *below* that call. To assemble `ctx` before the executor call, `recordEdit` must be defined above it (move it up, or make it a hoisted `function` declaration like `snapshot`/`cellScope`). `snapshot`/`cellScope` are already hoisted function declarations and need no move. `weekModeOf` (169) is **not** a `ctx` member (it joins `boardDeps`), so it only needs to be in scope before the `createBoardWrites(ctx, boardDeps)` call (after the executor) — no move required, though moving it up alongside `recordEdit` is harmless.
- **Recorder-bypass invariant (Phase 1).** Pass `ctx` to `useReconcileExecutor` but leave its parameter type as `ReconcileExecutorDeps`. Do not destructure or reference `recordEdit` inside the executor. This keeps "the executor cannot record" a type-level guarantee, not a convention.

## Phase 0: Fold logic-free wrappers into the return object

### Overview

Delete the ~9 public handlers that are pure `void persist*` forwarders and express them inline in the returned object. Removes ~9 declarations and puts the public contract in one place. Zero behavior risk; this is report "Move 1" and the first step of the full split.

### Changes Required:

#### 1. Inline the trivial handlers

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Remove the standalone function declarations for the logic-free forwarders (`addCourse`, `addGroup`, `setWeek`, `moveBundle`, `removeBundle`, `shelveBundle`, `placeBack`, `parkMembers`, `removeParked`) and define them inline in the `return {…}` object as `void persist*` arrows. Leave the handlers with real logic (`movePlacement`, `removePlacement`, `duplicateBundle`) as declarations.

**Contract**: Public return type `UsePlacements` is unchanged (same keys, same signatures). Each inlined handler is a one-line `void persist*` forwarder. `addGroup` keeps its `opts` unpacking; `moveBundle`/`removeBundle` keep their `courseIdsAt(day, period)` call.

**Internal caller (don't miss this)**: `duplicateBundle` (kept as a declaration) calls the `addGroup` handler internally (`use-placements.ts:259`). Once `addGroup` is inlined into the return object it is no longer an in-scope binding, so that call must be rewired to the persister directly: `persistAddGroup(placeable.map((p) => p.courseId), target, false, weekByMember, "duplicate")`. This is behavior-identical — the removed `addGroup` wrapper only unpacked those same args (`oppositeWeek` defaults to `false`, `editKind` to `"duplicate"`). Skipping this breaks the `pnpm check` gate ("Cannot find name 'addGroup'") and pre-resolves the same internal call for Phase 3 (both move into `board-writes`).

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Existing hook tests pass: `pnpm test use-placements`
- Lint + structure pass: `pnpm lint && pnpm steiger`
- Build clean: `pnpm build`

#### Manual Verification:

- Add/move/remove/duplicate, shelve/place-back/park, and undo/redo all behave identically in the planner board with no console errors.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 1.

---

## Phase 1: Introduce `WriteContext` + assemble `ctx`, rewire the executor

### Overview

Add `placement/write-context.ts` (the `WriteContext` type + the `cellScope` helper), assemble a `ctx: WriteContext` in the hook, and pass it to `useReconcileExecutor` in place of the inline deps literal. No forward-path persister is moved yet — this phase only proves the `ctx` shape against its first consumer. (Covers report Phase 1 + Phase 4.)

### Changes Required:

#### 1. New `WriteContext` module

**File**: `src/_pages/plan-detail/model/placement/write-context.ts`

**Intent**: Define the injected dependency bundle the writers (and the executor) consume, plus the pure `cellScope` helper the persisters use. `WriteContext` is a superset of `ReconcileExecutorDeps`.

**Contract**: Exports `type WriteContext` and `const cellScope`. The type is the executor's deps plus `recordEdit` (the genuinely shared addition; `weekModeOf` is board-only and rides in `boardDeps` — see Phase 3):

```ts
export type WriteContext = {
  rpcs: Rpcs;
  placementsRef: RefObject<LocalPlacement[]>;
  parkedBundlesRef: RefObject<LocalParkedBundle[]>;
  setPlacements: Dispatch<SetStateAction<LocalPlacement[]>>;
  setParkedBundles: Dispatch<SetStateAction<LocalParkedBundle[]>>;
  setError: Dispatch<SetStateAction<PlacementError | null>>;
  recordEdit: (kind: EditKind, scope: AffectedScope, before: AffectedSlice, cell?: CellData) => void;
  snapshot: (scope: AffectedScope) => AffectedSlice;
};

export const cellScope = (cell: CellData): AffectedScope => ({ cells: [cellKey(cell.day, cell.period)], cardSets: [] });
```

#### 2. Assemble `ctx` and pass it to the executor

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Build a single `ctx: WriteContext` object from the existing state setters, refs, `rpcs`, `recordEdit`, `snapshot`. Replace the inline object literal passed to `useReconcileExecutor` with `ctx`. Replace the inner `cellScope` declaration with the import from `write-context.ts`. (`weekModeOf` stays a hook-local arrow — it is not a `ctx` member; it joins `boardDeps` in Phase 3.)

**Contract**: `useReconcileExecutor(ctx)` — its parameter type stays `ReconcileExecutorDeps` (unchanged file). `ctx` is assembled *after* `recordEdit` is in scope (see Critical Implementation Details → State sequencing). No change to `busy`, the persisters, or the return object this phase.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Existing hook tests pass: `pnpm test use-placements`
- `use-reconcile-executor` tests pass: `pnpm test use-reconcile-executor`
- Lint + structure pass: `pnpm lint && pnpm steiger`
- Build clean: `pnpm build`

#### Manual Verification:

- Undo/redo (the executor's path) works identically — multi-step undo, redo, and reconcile after a merge all behave as before.
- Forward edits still record undo entries; reconcile still does NOT create new history entries.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Extract `createShelfWrites(ctx)`

### Overview

Move the shelf write path — `shelveBundle`, `placeBack`, `parkMembers`, `removeParked` and their persisters (`persistShelve`, `persistPlaceBack`, `persistParkMembers`, `persistRemoveParked`) — into a plain factory `createShelfWrites(ctx)`. The two-store atomic ops (`shelve`, `placeBack`) live here because `ctx` carries both setters. Add unit tests. Smaller, lower-coupling surface — validates the seam before the board move.

### Changes Required:

#### 1. New shelf-writes factory

**File**: `src/_pages/plan-detail/model/placement/shelf-writes.ts`

**Intent**: Export `createShelfWrites(ctx: WriteContext)` returning `{ shelveBundle, placeBack, parkMembers, removeParked }`. Move the four shelf persisters in as module-private functions, rewriting their captured identifiers to `ctx.*` (`ctx.setPlacements`, `ctx.setParkedBundles`, `ctx.placementsRef`, `ctx.parkedBundlesRef`, `ctx.rpcs`, `ctx.setError`, `ctx.recordEdit`, `ctx.snapshot`). Public handlers are one-line `void persist*` forwarders defined in the returned object.

**Contract**: `createShelfWrites(ctx: WriteContext) => { shelveBundle, placeBack, parkMembers, removeParked }` with the same signatures as today's handlers. Behavior byte-for-byte identical (same optimistic/rollback/two-store sequencing). Uses `cellScope` from `write-context.ts`.

#### 2. Wire the factory into the hook

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Call `const shelf = createShelfWrites(ctx)`; remove the migrated handlers + persisters from the hook; spread `...shelf` into the return object. Remove now-unused imports (the shelf transitions move with the factory).

**Contract**: Return object includes `...shelf`; `UsePlacements` shape unchanged.

#### 3. Shelf-writes unit tests

**File**: `src/_pages/plan-detail/model/placement/shelf-writes.test.ts`

**Intent**: Test `createShelfWrites` against a fake `WriteContext` (stub `setPlacements`/`setParkedBundles` capturing updater results, stub refs, stub `rpcs` resolving/rejecting, spy `recordEdit`/`setError`). Assert optimistic add → settle on success and rollback on RPC failure, for each of the four ops, incl. two-store rollback for `shelve`/`placeBack`. No rendering.

**Contract**: Mirrors `placement/shelf-transitions.test.ts` style — plain data builders, `vitest`, no `renderHook`. Covers: successful `shelve` reconciles temp→server id; failed `shelve` restores both stores; `placeBack` merge-filter via `eligibleMembers`; `removeParked`/`parkMembers` shelf-only paths.

### Success Criteria:

#### Automated Verification:

- New shelf-writes tests pass: `pnpm test shelf-writes`
- Existing hook tests pass unchanged: `pnpm test use-placements`
- Type check passes: `pnpm check`
- Lint + structure pass: `pnpm lint && pnpm steiger`
- Build clean: `pnpm build`

#### Manual Verification:

- Shelve a bundle, place it back (onto empty and onto an occupied cell — merge), park a palette grouping, discard a parked card — all behave identically, with correct rollback on a forced failure.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Extract `createBoardWrites(ctx, boardDeps)`

### Overview

Move the board write path — `addCourse`, `addGroup`, `movePlacement`, `removePlacement`, `setWeek`, `moveBundle`, `removeBundle`, `duplicateBundle` and their persisters (`persistAdd`, `persistAddGroup`, `persistMember`, `persistMoveMembers`, `persistRemoveMembers`, `persistSetWeek`) plus the duplicate search and `courseIdsAt` — into `createBoardWrites(ctx, boardDeps)`. Move the `DuplicateOutcome` type with it. Add unit tests. After this phase the hook is a thin orchestrator.

### Changes Required:

#### 1. New board-writes factory

**File**: `src/_pages/plan-detail/model/placement/board-writes.ts`

**Intent**: Export `createBoardWrites(ctx, boardDeps)` returning the eight board handlers. Move the six board persisters + `persistMember` + `courseIdsAt` + the `duplicateBundle` search in as module-private functions rewritten to `ctx.*` and `boardDeps.*`. Move the `DuplicateOutcome` type here.

**Contract**: `createBoardWrites(ctx: WriteContext, boardDeps: BoardDeps) => { addCourse, addGroup, movePlacement, removePlacement, setWeek, moveBundle, removeBundle, duplicateBundle }`, where `BoardDeps = { catalogById, availabilityIndex, crossCohortIndex, days, periods, weekModeOf, setLastDuplicated }`. `weekModeOf` lives here (not in `ctx`) because only the board persisters read it (`persistAdd`, `persistAddGroup`). `findDuplicateTarget` is called with `boardDeps` oracle inputs (unchanged). Behavior identical (same week-precedence, partial-failure banner, duplicate nonce). Handlers with real logic stay as functions; the trivial ones are inline forwarders.

#### 2. Wire the factory into the hook

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Call `const board = createBoardWrites(ctx, { catalogById, availabilityIndex, crossCohortIndex, days, periods, weekModeOf, setLastDuplicated })`; remove the migrated code; spread `...board` into the return. Drop now-unused imports (placement transitions, `findDuplicateTarget`, `GroupingCourse`, etc. move with the factory). The hook retains: state, `rpcs`, `ctx`, `useReconcileExecutor(ctx)`, `board`, `shelf`, `busy`, `lastDuplicated`, `snapshot`/`applyReconcile`/`clearError`, `useLatest`.

**Contract**: Final return = `{ placements, parkedBundles, error, lastDuplicated, busy, snapshot, applyReconcile, clearError, ...board, ...shelf }`. `UsePlacements` shape unchanged.

#### 3. Board-writes unit tests

**File**: `src/_pages/plan-detail/model/placement/board-writes.test.ts`

**Intent**: Test `createBoardWrites` against a fake `WriteContext` + fake `boardDeps`. Assert optimistic→settle/rollback for add/addGroup/move/remove/setWeek; group partial-failure banner; `duplicateBundle` finds a target (and sets `lastDuplicated` via the `setLastDuplicated` spy) or sets the "no empty slot" error.

**Contract**: Same framework-free style as `placement-transitions.test.ts`. Stubs `rpcs.placeCourse`/`moveBundleMembers`/etc.; provides a small `catalogById`/availability/cross-cohort fixture for the duplicate path.

### Success Criteria:

#### Automated Verification:

- New board-writes tests pass: `pnpm test board-writes`
- Existing hook tests pass unchanged: `pnpm test use-placements`
- Full unit suite passes: `pnpm test`
- Type check passes: `pnpm check`
- Lint + structure pass: `pnpm lint && pnpm steiger`
- Build clean: `pnpm build`
- Full CI gate clean: `/verify`

#### Manual Verification:

- Add a course/group, move a chip and a whole bundle (incl. merge), set week (A/B flip), remove, and duplicate a bundle — all behave identically, partial-failure banners and the duplicate pulse included.
- Full undo/redo across a mix of board + shelf edits behaves as before.

**Implementation Note**: After automated verification passes, this completes the change — pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `shelf-writes.test.ts` / `board-writes.test.ts` — drive each factory with a fake `WriteContext` (stub setters capturing updater output, stub refs, stub `rpcs` resolving/rejecting, spies on `recordEdit`/`setError`/`setLastDuplicated`). Assert: optimistic overlay applied; settle swaps temp→server rows; RPC rejection rolls back (both stores for `shelve`/`placeBack`); partial-failure banner for group ops; `duplicate` target-found vs no-slot.
- Edge cases: empty/pending-source no-ops; merge-filter in `placeBack`; week precedence in `addGroup`; same-cell move no-op.

### Integration Tests:

- Existing `api/reconcile.integration.test.ts` and the placement/shelf integration suites continue to exercise `applyReconcile` and the RPC paths end-to-end — unchanged by this refactor.

### Manual Testing Steps:

1. Add a single course and a palette group to a cell; verify chips + collision feedback.
2. Move a chip, move a whole bundle onto an occupied cell (merge); flip a bi-weekly chip A↔B.
3. Duplicate a bundle into a free slot; verify the pulse; duplicate when no slot is free → "No empty slot" banner.
4. Shelve a bundle; place it back onto empty and onto an occupied cell; park a palette grouping; discard a parked card.
5. Undo/redo a mixed sequence of the above; confirm reconcile creates no new history entries and rolls back cleanly on a forced RPC failure.

## Performance Considerations

No new hot path. Factories run each render and return fresh handler objects — fine under the React Compiler and consistent with `toCohortState`'s per-render `actions` rebuild. The <200ms drag-drop validation budget is unaffected (validation lives in the collision core, untouched here).

## Migration Notes

Pure code restructure; no data, schema, or API migration. Each phase is independently revertable. Rollback = revert the phase's commit(s); no persisted state is involved.

## References

- Research (corrected baseline): `context/changes/use-placements-writer-split/research.md`
- Proposal: `context/changes/use-placements-writer-split/report.md`
- Predecessor change (shipped the baseline): `context/archive/2026-06-29-use-placements-cleanup/plan.md`
- Pattern to mirror: `src/_pages/plan-detail/model/history/use-reconcile-executor.ts` (ref+setter injection)
- Test style to mirror: `src/_pages/plan-detail/model/placement/shelf-transitions.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: Fold logic-free wrappers into the return object

#### Automated

- [x] 0.1 Type check passes: `pnpm check` — 47fe9e8
- [x] 0.2 Existing hook tests pass: `pnpm test use-placements` — 47fe9e8
- [x] 0.3 Lint + structure pass: `pnpm lint && pnpm steiger` — 47fe9e8
- [x] 0.4 Build clean: `pnpm build` — 47fe9e8

#### Manual

- [ ] 0.5 Add/move/remove/duplicate, shelve/place-back/park, undo/redo behave identically with no console errors

### Phase 1: Introduce WriteContext + assemble ctx, rewire the executor

#### Automated

- [x] 1.1 Type check passes: `pnpm check` — c318076
- [x] 1.2 Existing hook tests pass: `pnpm test use-placements` — c318076
- [x] 1.3 `use-reconcile-executor` tests pass: `pnpm test use-reconcile-executor` — c318076
- [x] 1.4 Lint + structure pass: `pnpm lint && pnpm steiger` — c318076
- [x] 1.5 Build clean: `pnpm build` — c318076

#### Manual

- [ ] 1.6 Undo/redo (multi-step, redo, reconcile-after-merge) works identically
- [ ] 1.7 Forward edits record undo entries; reconcile creates none

### Phase 2: Extract createShelfWrites(ctx)

#### Automated

- [x] 2.1 New shelf-writes tests pass: `pnpm test shelf-writes`
- [x] 2.2 Existing hook tests pass unchanged: `pnpm test use-placements`
- [x] 2.3 Type check passes: `pnpm check`
- [x] 2.4 Lint + structure pass: `pnpm lint && pnpm steiger`
- [x] 2.5 Build clean: `pnpm build`

#### Manual

- [ ] 2.6 Shelve / place-back (empty + merge) / park / discard behave identically with correct rollback on forced failure

### Phase 3: Extract createBoardWrites(ctx, boardDeps)

#### Automated

- [ ] 3.1 New board-writes tests pass: `pnpm test board-writes`
- [ ] 3.2 Existing hook tests pass unchanged: `pnpm test use-placements`
- [ ] 3.3 Full unit suite passes: `pnpm test`
- [ ] 3.4 Type check passes: `pnpm check`
- [ ] 3.5 Lint + structure pass: `pnpm lint && pnpm steiger`
- [ ] 3.6 Build clean: `pnpm build`
- [ ] 3.7 Full CI gate clean: `/verify`

#### Manual

- [ ] 3.8 Add/move (incl. merge)/setWeek/remove/duplicate behave identically, banners + duplicate pulse included
- [ ] 3.9 Full undo/redo across mixed board + shelf edits behaves as before
