# use-placements.ts Cleanup Implementation Plan

## Overview

A behavior-preserving cleanup of `src/_pages/plan-detail/model/use-placements.ts` (the island-local optimistic write path for the two-cohort timetable), plus two small intentional behavior changes and one app-wide build change. The work derives from a critical review captured in `change.md`, with every item grounded in verified file:line references.

Five independently-shippable, independently-revertable phases:

1. Mechanical extractions & dedup (kills a verbatim-duplicated key fn; pulls repeated fragments into pure, tested helpers).
2. A `makeRpcs(planId, cohort)` binding factory (dedups RPC call sites and shrinks the reconcile `deps` object).
3. Small behavior changes (a `"duplicate"` undo label; clear stale error on success; document known concurrency limits).
4. Executor split — extract `useReconcileExecutor` so the forward write path reads on its own.
5. Enable the React Compiler app-wide (it is currently lint-only — no auto-memoization).

## Current State Analysis

`use-placements.ts` is 737 lines and is already well-factored: every state mutation is a named, separately-tested pure transition in `placement-transitions.ts` / `shelf-transitions.ts` / `history/reconcile-apply.ts`, and the hook is purely orchestration. It owns five responsibilities: (a) the board placement store + writes, (b) the shelf/parked store + writes, (c) history snapshotting (`snapshot`), (d) edit recording (`recordEdit`/`onRecord`), (e) the undo/redo reconcile executor (`applyReconcile`). It is consumed via `use-cohort-board-state.ts` (`useCohortPlacements`), and its `snapshot`/`applyReconcile`/`busy` surface feeds `history/use-history.ts`.

Verified facts that drive the plan:

- **React Compiler is lint-only.** `eslint-plugin-react-compiler` is wired as a rule (`eslint.config.js:68` → `"react-compiler/react-compiler": "error"`), but `babel-plugin-react-compiler` is **absent** from `package.json` and `node_modules`, and `astro.config.mjs` calls `react()` with no compiler babel option. There is no auto-memoization today; every handler is a fresh identity each render. Slice comments stating "the React Compiler forbids both" are accurate as *lint-discipline* statements but imply a payoff that isn't happening.
- **`businessKey` is verbatim-duplicated.** `placementBusinessKey` (use-placements.ts:711) is byte-for-byte identical to `businessKey` (history/reconcile-apply.ts:92): `` `${courseId}|${day}|${period}|${week}` ``. They must agree for reconciliation matching to work — a real drift hazard.
- **The api clients are not uniform.** `placeCourse` / `moveBundleMembers` / `removeBundleMembers` / `shelveBundle` / `unshelveBundle` / `shelveCourses` all take `{ planId, cohort, … }`, but `deleteShelfBundle` takes only `{ planId, shelfBundleId }` and `updatePlacementWeek` takes `(id, week)`. A binding factory cannot be perfectly uniform.
- **`@astrojs/react` accepts a `babel` option** (confirmed via Astro docs, same mechanism documented for `@astrojs/preact`), which is how the React Compiler is enabled. React 19 means the compiler runtime is built in — **no `react-compiler-runtime` package is needed.**

## Desired End State

`use-placements.ts` is shorter and reads as a forward write path: the reconcile/undo machinery lives in `useReconcileExecutor`; RPC calls go through one bound `rpcs` object; repeated fragments are pure tested helpers; the duplicated key fn is gone. A duplicate's undo tooltip reads "Duplicate", a successful edit clears a stale error banner, and the ref-lag footgun is documented at its source. The React Compiler runs in the build, so the discipline the slice already enforces yields auto-memoization. `pnpm check`, `pnpm test`, `pnpm lint`, `pnpm steiger`, and `pnpm build` are all clean, and the drag-drop placement/validation budget (<200ms) still holds.

### Key Discoveries:

- Pure logic already lives in transition modules (`placement-transitions.ts:1-234`) — new helpers belong there, following the **declarative-pipeline lesson** (`const`, `filter`/`find`/`map`, newspaper order; no mutable accumulators).
- The undo/redo executor surface (`snapshot` + `applyReconcile`) maps onto the existing `CohortHistoryApi` projection (`history/use-history.ts:13`) — the natural fracture line for the split.
- `resolveCardId` (use-placements.ts:654) is **not** an RPC — it closes over `cardIdByMemberSet` captured at call time, so it stays in the executor, not the `rpcs` factory.
- `astro check` is the only valid type-check gate (lesson) — success criteria cite `pnpm check`, never `pnpm build`/`pnpm lint` as a type proxy.

## What We're NOT Doing

- Not changing any Astro Action / RPC contract or the Supabase schema.
- Not splitting the two stores (placements vs. shelf) from each other — the two-store-atomic ops (`persistShelve`, `persistPlaceBack`, `applyReconcile`) need synchronous access to both; splitting them is a net loss (explicitly rejected in the review).
- Not introducing a generic `runOptimistic()` wrapper over all ~10 `persist*` functions — the batch variants diverge enough that one wrapper reads worse than the targeted extractions (rejected).
- Not changing undo/redo semantics, the history store, or the in-flight gating in `use-history.ts`.
- Not serializing the forward write path or queueing errors — the racing-`before`-capture and last-writer-wins behaviors are documented, not re-architected.
- Not hand-adding `useMemo`/`useCallback` anywhere — enabling the compiler (Phase 5) is the memoization strategy.

## Implementation Approach

Land the safe, test-covered mechanical work first (Phases 1–2), then the small behavior changes (Phase 3), then the one architectural refactor (Phase 4), and finally the isolated app-wide build change (Phase 5) so the hook is compiled in its final shape and the riskiest change can be reverted alone. Each phase keeps the full CI gate green before the next begins.

## Critical Implementation Details

- **Ref lag (timing).** `useLatest` (use-placements.ts:698) updates its ref in a `useEffect`, so the ref reflects the *last committed render*, not a `setState` issued earlier in the same tick. Every `persist*` already dodges this by capturing what it needs (`occupants`, `moverRows`, `before`, `removedRows`) **before** the `await` and using functional `setState` updaters. Preserve that discipline in Phases 3–4; never add a "read ref after `setState`" line.
- **Clear-error ordering (state sequencing).** In Phase 3 the success-path `setError(null)` must run **before** the partial-failure `groupFailure` `setError(...)` in the batch functions — otherwise clearing would wipe a legitimate partial-failure banner. The obvious "clear at the very end" ordering is wrong.
- **Executor seam.** In Phase 4, inject `snapshot` into the executor (do not duplicate it — the forward path uses it on every edit); keep `resolveCardId` inside the executor (stateful closure, not bindable into `rpcs`); the executor owns `reconciling` state and returns it so the hook composes `busy = reconciling || placements.some(pending) || parkedBundles.some(pending)`.
- **Performance budget (Phase 5).** The placement/constraint validation has a <200ms per-drag budget. The compiler should not regress it, but verify with the existing perf test and a manual drag smoke; the compiler must also leave the `ssrPrebundleDeps()` single-React-instance fix (`astro.config.mjs`) intact.

---

## Phase 1: Mechanical extractions & dedup

### Overview

Eliminate the duplicated key function and pull the repeated inline fragments into pure, separately-tested helpers. Behavior-preserving; guarded by the existing `use-placements.test.tsx`, `use-placements-history.test.tsx`, and `placement-transitions.test.ts` suites, plus new unit tests for the extracted helpers.

### Changes Required:

#### 1. Shared placement business key

**File**: `src/_pages/plan-detail/model/history/affected-slice.ts`

**Intent**: Remove the verbatim-duplicated business-key derivation by giving it one home next to `memberSetKey`.

**Contract**: Export `placementBusinessKey(key: PlacementKey): string` returning `` `${courseId}|${day}|${period}|${week}` `` (identical format — do not change the delimiter). `PlacementKey` is structurally `{ courseId; day; period; week }`. Confirm no new import cycle (affected-slice already imports `history-entry` types; `reconcile-apply` and `use-placements` already import from `affected-slice`).

#### 2. Consume the shared key

**File**: `src/_pages/plan-detail/model/history/reconcile-apply.ts`, `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Delete both local copies (`businessKey` at reconcile-apply.ts:92; `placementBusinessKey` at use-placements.ts:711) and import the shared one.

**Contract**: No behavior change — same string output. Both call sites compile against the shared signature.

#### 3. `groupFailureError` pure helper

**File**: `src/_pages/plan-detail/model/placement/placement-transitions.ts`

**Intent**: Dedup the identical group-failure reporting in `persistAddGroup` (:318-319), `persistMoveMembers` (:397-398), `persistPlaceBack` (:560-561).

**Contract**: `groupFailureError(outcomes: MemberOutcome[], attempted: number): PlacementError | null` — returns a `{ kind: "groupFailure", failedCourseIds, attempted }` when any outcome has `result === null`, else `null`. The hook does `const failure = groupFailureError(...); if (failure) setError(failure)`. Pure (no `setError` inside).

#### 4. `MemberOutcome` type + `outcomesByCourse` helper

**File**: `src/_pages/plan-detail/model/placement/placement-transitions.ts`

**Intent**: Name the inline composite type (used at use-placements.ts:334, :388, :551) and dedup the reconcile-by-course outcome construction (:387-392, :550-555).

**Contract**: `type MemberOutcome = BatchOutcome & { courseId: string }`; `outcomesByCourse(entries: { tempId: string; courseId: string }[], serverRows: PlannerPlacement[]): MemberOutcome[]` mapping each entry to its server row by `courseId` (`result: null` when absent).

#### 5. `occupantsAt` pure helper

**File**: `src/_pages/plan-detail/model/placement/placement-transitions.ts`

**Intent**: Dedup the repeated cell-occupant filter (`duplicateBundle`:209, `courseIdsAt`:247, `persistShelve`:462, and the `courseSet`-narrowed variants at `persistMoveMembers`:354 / `persistRemoveMembers`:410).

**Contract**: `occupantsAt(placements: LocalPlacement[], cell: { day: number; period: number }): LocalPlacement[]`. Move/remove sites compose it with `.filter((p) => courseSet.has(p.courseId))`; `courseIdsAt` becomes `occupantsAt(...).map((p) => p.courseId)`. Declarative, `const`, newspaper order (lessons rule).

#### 6. Document the `useLatest` footgun

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: The ref-lag hazard is currently only documented at `useCombinedBoardState`. Add a comment at `useLatest` itself.

**Contract**: Comment only — explain the one-commit lag (ref set in `useEffect`) and the rule: capture values before `await`, use functional updaters, never read the ref expecting an in-tick `setState` to be reflected.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Unit tests pass (incl. new helper tests): `pnpm test`
- New unit tests cover `groupFailureError`, `outcomesByCourse`, `occupantsAt` in `placement-transitions.test.ts`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build is clean: `pnpm build`

#### Manual Verification:

- Board smoke: add a course, move a chip, remove a chip, drop a group, shelve/place-back a bundle — all behave as before
- A group drop with a forced member failure still shows the group-failure banner naming the failed course(s)

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual smoke before Phase 2.

---

## Phase 2: `makeRpcs` binding factory

### Overview

Bind `planId`/`cohort` once so they are not re-spelled at every RPC call site and again inside the `applyReconcile` `deps` object. Shrinks both paths and reduces the dependency surface the Phase 4 split must inject.

### Changes Required:

#### 1. `makeRpcs` factory

**File**: `src/_pages/plan-detail/api/rpcs.ts` (new)

**Intent**: Return RPC functions with `planId`/`cohort` pre-bound where the underlying client takes them.

**Contract**: `makeRpcs(planId: string, cohort: Cohort)` returns an object of **client-named** bound methods that wrap the `placement-client` / `shelf-client` functions with `planId`/`cohort` pre-applied: `placeCourse`, `moveBundleMembers`, `removeBundleMembers`, `updatePlacementWeek` (binds neither arg — pass-through), `shelveBundle`, `unshelveBundle`, `deleteShelfBundle` (binds only `planId`), `shelveCourses`. Imports the existing clients (so the test suites that mock `../api/placement-client` / `../api/shelf-client` keep working).

> **Note — `rpcs` does not (and cannot) implement `ReconcileDeps`.** `ReconcileDeps` (`history/reconcile-exec.ts:15`) is a *different surface*: different method **names** (`place`/`moveMembers`/`shelve`/`unshelve`/`removeMembers`/`createCard`/`deleteCard`) and different **signatures** (positional `CellData`, not the clients' `{ planId, cohort, day, period, … }` objects). So the reconcile `deps` object (item #2) stays an **adapter** that delegates to `rpcs`, mapping positional `CellData` → named args. Phase 2 shrinks that adapter only by removing the repeated `planId,`/`cohort,` from its bodies — it does **not** reduce to identity wrappers. The bulk of Phase 2's payoff is the **forward path**: every `persist*` client call drops `planId, cohort,`.

#### 2. Use `rpcs` in the hook

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: One memoized `rpcs` drives both the forward path and the reconcile deps.

**Contract**: `const rpcs = useMemo(() => makeRpcs(planId, cohort), [planId, cohort])`. Replace every direct client call in the `persist*` functions with `rpcs.*`. Rebuild the `deps` object (:634-655) so each `ReconcileDeps` method delegates to the matching `rpcs.*` method — still translating positional `CellData` into the client's named args (e.g. `moveMembers: (s, t, ids) => rpcs.moveBundleMembers({ day: s.day, period: s.period, courseIds: ids, targetDay: t.day, targetPeriod: t.period })`), just without re-spelling `planId`/`cohort`. **`resolveCardId` stays a local closure** over `cardIdByMemberSet` (it is not an RPC). No behavior change.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Unit + history tests pass unchanged: `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure check passes (model→api import direction respected): `pnpm steiger`
- Production build is clean: `pnpm build`

#### Manual Verification:

- Full board smoke (add/move/remove/group/shelf/place-back/duplicate) behaves identically
- Undo/redo of a move and a lift still round-trip (the reconcile path now goes through `rpcs`)

**Implementation Note**: Pause for human confirmation of the manual smoke before Phase 3.

---

## Phase 3: Small behavior changes

### Overview

Three small, intentional changes: a correct undo label for duplicates, clearing a stale error banner on success, and documenting the known concurrency limits.

### Changes Required:

#### 1. Add a `"duplicate"` edit kind

**File**: `src/_pages/plan-detail/model/history/history-label.ts`

**Intent**: A duplicated bundle currently records as `"addGroup"`, so undo reads "Place group". Give it its own label.

**Contract**: Add `"duplicate"` to the `EditKind` union and a `case "duplicate"` to `describeEdit` returning e.g. `` `Duplicate bundle${where}` ``. The switch stays exhaustive (no `default`).

#### 2. Thread the edit kind through `addGroup`

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Let `duplicateBundle` record the `"duplicate"` kind while normal group drops stay `"addGroup"`.

**Contract**: Add an optional `editKind?: EditKind` to `addGroup`'s `opts` and to `persistAddGroup`, defaulting to `"addGroup"`; `recordEdit` uses it. `duplicateBundle` (:238-242) passes `{ weekByMember, editKind: "duplicate" }`. Signature change other call sites ignore (optional).

#### 3. Clear error on successful settle

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: A fully-successful edit should dismiss a stale banner left by a prior failure.

**Contract**: On each `persist*` success path (and the executor's success path once split in Phase 4), call `setError(null)` for a fully-successful settle. In the batch functions, the success-path `setError(null)` runs **before** the `groupFailure` `setError(...)` so partial failures still surface (see Critical Implementation Details). Document the rule with a one-line comment.

#### 4. Document concurrency limits

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Make the known limits explicit for the next contributor.

**Contract**: Comments only — a note at the `error` state (`useState`) that it is a single last-writer-wins slot (forward edits are not serialized), and a note near the forward `before = snapshot(scope)` capture that back-to-back same-cell gestures rely on commit timing.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Tests pass, incl. updated duplicate-label assertion and a new clear-on-success test: `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build is clean: `pnpm build`

#### Manual Verification:

- After duplicating a bundle, the undo button tooltip reads "Duplicate …" (not "Place group")
- Trigger a failed edit (banner shows), then perform a successful edit → banner clears
- Undo/redo of a duplicate still round-trips

**Implementation Note**: Pause for human confirmation of the manual checks before Phase 4.

---

## Phase 4: Executor split (`useReconcileExecutor`)

### Overview

Extract the undo/redo reconcile executor (`applyReconcile`) into its own hook so `use-placements.ts` reads as the forward write path. Removes the reconcile-only imports and helpers from the hook.

### Changes Required:

#### 1. New executor hook

**File**: `src/_pages/plan-detail/model/history/use-reconcile-executor.ts` (new)

**Intent**: Own the non-recording reconcile path and the `reconciling` flag.

**Contract**: `useReconcileExecutor(deps: { snapshot: (scope) => AffectedSlice; placementsRef; parkedBundlesRef; setPlacements; setParkedBundles; setError; rpcs }): { applyReconcile: (target, scope) => Promise<{ ok: boolean }>; reconciling: boolean }`. Owns `useState(false)` for `reconciling`. Move `matchCardsByMemberSet` (use-placements.ts:724-737) and the reconcile-only imports (`diffReconcile`, `executeReconcilePlan`/`ReconcileDeps`, all of `reconcile-apply`'s reconcile fns) into this module; it imports `placementBusinessKey` from `affected-slice` (Phase 1). `resolveCardId` is a local closure over `cardIdByMemberSet`. Behavior identical to the current `applyReconcile` (:611-670).

#### 2. Hook delegates to the executor

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Replace the inline `applyReconcile` + `reconciling` state with the extracted hook.

**Contract**: `const { applyReconcile, reconciling } = useReconcileExecutor({ snapshot, placementsRef, parkedBundlesRef, setPlacements, setParkedBundles, setError, rpcs })`. `snapshot` stays defined in the hook and is passed in. `busy` composes `reconciling` with the stores' `pending` rows. The public return still exposes `snapshot` (hook's) and `applyReconcile` (executor's) — the `UsePlacements` type and `CohortHistoryApi` consumers are unchanged.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- All tests pass unchanged, esp. `use-placements-history.test.tsx`, `reconcile-exec.test.ts`, `reconcile-apply.test.ts`: `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure check passes (new `history/` file respects import direction): `pnpm steiger`
- Production build is clean: `pnpm build`
- `use-placements.ts` no longer imports `reconcile`/`reconcile-exec`/`reconcile-apply` (verify by grep)

#### Manual Verification:

- Undo/redo round-trips for each shape: move, lift (shelve), place-back, and a merge-undo
- A forced reconcile failure rolls both stores back and surfaces the error (no partial state)
- `busy` still gates undo/redo during an in-flight edit (rapid ⌘Z mid-settle is a no-op)

**Implementation Note**: Pause for human confirmation of the undo/redo smoke before Phase 5.

---

## Phase 5: Enable the React Compiler

### Overview

Turn the React Compiler from lint-only into a real build transform so the slice's existing compiler-safe discipline yields auto-memoization. App-wide change — verified against the full CI gate plus a drag-drop perf check.

### Changes Required:

#### 1. Add the compiler plugin

**File**: `package.json`

**Intent**: Install the React Compiler **on its stable 1.x line** (React Compiler 1.0 shipped Oct 2025 — the pre-`19.1.0-rc.2` pin currently in `eslint-plugin-react-compiler` predates it). Both the transform and the linter move to the stable line together so they agree.

**Contract**:
- Install `babel-plugin-react-compiler@latest` (resolves to stable 1.x) as a devDependency, pinned exact (`--save-dev --save-exact`, per the official 1.0 install guidance).
- **No `react-compiler-runtime`** package — React 19 (`^19.2.7` installed) ships `react/compiler-runtime`; `target: "19"` is the compiler default and needs no polyfill.
- Bump `eslint-plugin-react-compiler` off `^19.1.0-rc.2` to its matching stable line so the linter and transform are version-aligned (not stable-transform-against-RC-linter). **Caveat to verify:** the 1.0 release folded the rule into `eslint-plugin-react-hooks` (the `react-hooks/react-compiler` rule). Confirm the upgrade path for the installed plugin and, if the rule moved, update `eslint.config.js:62`/`:68` (plugin registration + `"react-compiler/react-compiler": "error"`) accordingly so `pnpm lint` stays green with the rule still enforced.
- `pnpm install` updates the lockfile.

#### 2. Wire the plugin into `@astrojs/react`

**File**: `astro.config.mjs`

**Intent**: Pass the compiler to React islands via the integration's `babel` option, preserving the existing `react()`, `sitemap()`, `tailwindcss()`, and `ssrPrebundleDeps()` setup.

**Contract**: 

```js
react({
  babel: {
    plugins: [["babel-plugin-react-compiler", { target: "19" }]],
  },
}),
```

Verify the compiler transform composes with the client-env `optimizeDeps` prebundling (the single-React-instance fix must remain intact) and that the workerd build stays clean.

#### 3. Reconcile the slice comments with reality

**File**: `src/_pages/plan-detail/model/use-placements.ts`, `src/_pages/plan-detail/model/use-cohort-board-state.ts`

**Intent**: With the compiler enabled, the "React Compiler forbids both" / purity comments are now load-bearing for the transform, not just the linter. Re-read and adjust wording so they state that the compiler is enabled and why the render-purity constraints matter to it.

**Contract**: Comment edits only.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Lint passes (the `react-compiler` rule stays `error`): `pnpm lint`
- All unit tests pass, incl. `collisions.perf.test.ts`: `pnpm test`
- FSD structure check passes: `pnpm steiger`
- Production (workerd) build is clean: `pnpm build`
- Dev server boots without an "Invalid hook call" / React-dedup error: `pnpm dev` (smoke)

#### Manual Verification:

- Drag-drop responsiveness: placement + constraint validation stays within the <200ms budget under the compiled build (manual drag smoke + perf test)
- Full board smoke under the compiled build: add/move/remove/group/shelf/place-back/duplicate/undo/redo, both cohorts, with no double-render or hook-order regression
- Cross-island smoke (the compiler is app-wide, not board-only): create → validate → submit a **course**, a **teacher**, and a **student** through their react-hook-form dialogs, plus the **sign-in** form, under the compiled build — watch for hook-order / "Invalid hook call" errors and fields that stop updating (the react-hook-form islands are the highest-likelihood compiler regression surface)
- The dev SSR React-dedup behavior (`ssrPrebundleDeps`) is unaffected

**Implementation Note**: This is the riskiest, app-wide phase. If anything regresses, rollback is reverting the `astro.config.mjs` babel change + the `package.json` devDependency (Phases 1–4 ship independently of it). Pause for human confirmation.

---

## Testing Strategy

### Unit Tests:

- New pure-helper tests in `placement-transitions.test.ts`: `groupFailureError` (empty vs. mixed outcomes), `outcomesByCourse` (matched/unmatched by course), `occupantsAt` (cell match + empty).
- Updated assertion in `use-placements-history.test.tsx`: a duplicate records the `"duplicate"` label.
- New test: a `setError`-then-successful-edit clears the error; a partial group failure still sets the banner (ordering).

### Integration Tests:

- The existing reconcile/undo coverage (`reconcile-exec.test.ts`, `reconcile-apply.test.ts`, `use-placements-history.test.tsx`) must pass unchanged across Phases 2 and 4 — they are the regression net for the `rpcs` factory and the executor split.

### Manual Testing Steps:

1. Add / move / remove a single course; drop a grouping; flip a bi-weekly chip's week.
2. Shelve a bundle, place it back onto an occupied cell (merge), discard a parked card.
3. Duplicate a bundle; confirm the undo tooltip reads "Duplicate"; undo and redo it.
4. Force an error (e.g. offline a member), confirm the banner, then a successful edit clears it.
5. Undo/redo each reconcile shape (move, lift, place-back, merge-undo); rapid ⌘Z mid-settle is a no-op.
6. (Phase 5) Repeat 1–5 under the compiled build; watch drag responsiveness and the dev console.

## Performance Considerations

The placement/constraint validation has a <200ms per-drag budget owned by the constraint core in `model/`. Phases 1–4 are behavior-preserving and do not touch that path's algorithmic shape. Phase 5's compiler memoization should only help (fewer redundant child re-renders), but must be verified not to regress the budget or disturb the `ssrPrebundleDeps()` single-React-instance fix.

## Migration Notes

No data or schema migration. Phase 5 changes the build: `pnpm install` after the `package.json` change, and the compiler then transforms all React islands. Rollback for Phase 5 is config + dependency revert; Phases 1–4 are pure code refactors revertable by commit.

## References

- Change identity & review backlog: `context/changes/use-placements-cleanup/change.md`
- Subject: `src/_pages/plan-detail/model/use-placements.ts`
- Pure transitions: `src/_pages/plan-detail/model/placement/placement-transitions.ts`
- Reconcile machinery: `src/_pages/plan-detail/model/history/{reconcile,reconcile-exec,reconcile-apply,affected-slice}.ts`
- Undo/redo controls: `src/_pages/plan-detail/model/history/use-history.ts`
- Consumer/orchestrator: `src/_pages/plan-detail/model/use-cohort-board-state.ts`
- Lessons applied: declarative pipelines; `astro check` as the type gate (`context/foundation/lessons.md`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Mechanical extractions & dedup

#### Automated

- [x] 1.1 Type check passes: `pnpm check` — f42adf4
- [x] 1.2 Unit tests pass (incl. new helper tests): `pnpm test` — f42adf4
- [x] 1.3 New unit tests cover `groupFailureError`, `outcomesByCourse`, `occupantsAt` — f42adf4
- [x] 1.4 Lint passes: `pnpm lint` — f42adf4
- [x] 1.5 FSD structure check passes: `pnpm steiger` — f42adf4
- [x] 1.6 Production build is clean: `pnpm build` — f42adf4

#### Manual

- [ ] 1.7 Board smoke (add/move/remove/group/shelf/place-back) behaves as before
- [ ] 1.8 Group drop with a forced member failure still shows the failure banner

### Phase 2: `makeRpcs` binding factory

#### Automated

- [x] 2.1 Type check passes: `pnpm check`
- [x] 2.2 Unit + history tests pass unchanged: `pnpm test`
- [x] 2.3 Lint passes: `pnpm lint`
- [x] 2.4 FSD structure check passes: `pnpm steiger`
- [x] 2.5 Production build is clean: `pnpm build`

#### Manual

- [ ] 2.6 Full board smoke behaves identically
- [ ] 2.7 Undo/redo of a move and a lift round-trip through `rpcs`

### Phase 3: Small behavior changes

#### Automated

- [ ] 3.1 Type check passes: `pnpm check`
- [ ] 3.2 Tests pass incl. updated duplicate-label + new clear-on-success test: `pnpm test`
- [ ] 3.3 Lint passes: `pnpm lint`
- [ ] 3.4 FSD structure check passes: `pnpm steiger`
- [ ] 3.5 Production build is clean: `pnpm build`

#### Manual

- [ ] 3.6 Undo tooltip after a duplicate reads "Duplicate …"
- [ ] 3.7 A failed edit's banner clears after a successful edit
- [ ] 3.8 Undo/redo of a duplicate round-trips

### Phase 4: Executor split (`useReconcileExecutor`)

#### Automated

- [ ] 4.1 Type check passes: `pnpm check`
- [ ] 4.2 All tests pass unchanged (history + reconcile suites): `pnpm test`
- [ ] 4.3 Lint passes: `pnpm lint`
- [ ] 4.4 FSD structure check passes: `pnpm steiger`
- [ ] 4.5 Production build is clean: `pnpm build`
- [ ] 4.6 `use-placements.ts` no longer imports reconcile/reconcile-exec/reconcile-apply (grep)

#### Manual

- [ ] 4.7 Undo/redo round-trips for move, lift, place-back, merge-undo
- [ ] 4.8 A forced reconcile failure rolls both stores back and surfaces the error
- [ ] 4.9 `busy` still gates undo/redo during an in-flight edit

### Phase 5: Enable the React Compiler

#### Automated

- [ ] 5.1 Type check passes: `pnpm check`
- [ ] 5.2 Lint passes (react-compiler rule stays error): `pnpm lint`
- [ ] 5.3 All unit tests pass incl. perf test: `pnpm test`
- [ ] 5.4 FSD structure check passes: `pnpm steiger`
- [ ] 5.5 Production (workerd) build is clean: `pnpm build`
- [ ] 5.6 Dev server boots without Invalid-hook-call / React-dedup error: `pnpm dev` smoke

#### Manual

- [ ] 5.7 Drag-drop stays within the <200ms validation budget under the compiled build
- [ ] 5.8 Full board smoke under the compiled build, both cohorts, no double-render/hook-order regression
- [ ] 5.9 Cross-island smoke: course/teacher/student RHF dialogs + sign-in form submit cleanly under the compiled build
- [ ] 5.10 Dev SSR React-dedup behavior (`ssrPrebundleDeps`) is unaffected
