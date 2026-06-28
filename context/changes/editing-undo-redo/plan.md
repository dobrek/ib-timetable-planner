# Editing Undo / Redo (S-08, FR-013) Implementation Plan

## Overview

Add plan-level **undo / redo** for the board's editing operations — palette place (single + grouping), single-course & whole-bundle move (including the lossy merge), single-course & whole-bundle remove, lift-to-shelf / place-back / park-arbitrary-set / discard, bundle duplicate, and the A/B week flip. The history is **multi-step**, **session-lifetime** (cleared on reload/navigation), and lives behind a **durable-ready store interface** so a durable backing is a later drop-in. Every undo/redo issues real Supabase writes — the board stays durable at all times; only the *ability to step back* is session-scoped.

The mechanism is a **snapshot diff-reconcile**: each history entry captures a `before` snapshot of the cells/cards the edit touched, and undo/redo reconciles the live board to a target snapshot by issuing the existing atomic RPCs. Because identity is never preserved across merge/park anyway and the data is tiny, the reconcile **engine** describes every operation as a business-key diff (remove-then-place on the board, delete-then-create on the shelf) — one operation-agnostic core, no per-op inverse logic, no migration, no constraint-core change. The **executor** then preserves DB-level atomicity by routing any diff that maps cleanly to one existing compound RPC (move / lift / place-back) through that RPC, decomposing into primitives only for the rare multi-cell residual (merge-undo, which re-places at two cells).

## Current State Analysis

The board is a small, immutable, fully-derived client model over a uniform atomic-RPC persistence layer — close to ideal for snapshot undo.

- **No store/reducer.** Board state is two `usePlacements` instances (one per cohort), each plain `useState`: `placements: LocalPlacement[]` + `parkedBundles: LocalParkedBundle[]`, immutable on every transition (`model/use-placements.ts:117-122`). A snapshot is an O(1) reference hold.
- **The orchestrator is the single plan-level home.** `useCombinedBoardState(dp1, dp2, focus)` owns *both* cohorts' `usePlacements` and is the op-log home S-06 deliberately reserved (`model/use-cohort-board-state.ts:40-80`). `PlannerBoard` calls it once (`ui/PlannerBoard.tsx:48`).
- **Every persisted edit funnels through ~9 `persist*` functions** in `use-placements.ts` (`persistAdd`, `persistAddGroup`, `persistMoveMembers`, `persistRemoveMembers`, `persistSetWeek`, `persistShelve`, `persistPlaceBack`, `persistParkMembers`, `persistRemoveParked`). Each does optimistic→atomic RPC→settle and captures pre-state for *failure* rollback (then discards it). The settled-success path is the recording seam. `duplicateBundle` composes `addGroup`, so it records as one entry for free.
- **Every op has an atomic, idempotent RPC** (`api/placements.ts`, `api/shelf.ts` → `place_course`, `move_bundle_members`, `remove_bundle_members`, `shelve_courses`, `delete_shelf_bundle`, `unshelve_bundle`, `shelve_bundle`, `updatePlacementWeek`). The client wrappers are `api/placement-client.ts` / `api/shelf-client.ts`; the framework-free domain fns are `api/placements.ts` / `api/shelf.ts`.
- **Re-validation is free.** `useCollisions` is a `useMemo` over placements + the live cross-cohort index (`model/use-board-derivations.ts:30-40`, fed by `use-cohort-board-state.ts:64-74`). Restoring a snapshot re-renders → collisions recompute cross-cohort within the <200ms budget, zero new wiring. There is no imperative `validate()` anywhere.
- **No keyboard-shortcut infra exists** anywhere in plan-detail — only `storage`-event listeners for cosmetic prefs (`lib/shelf-pinned.ts`, `lib/drag-hint-mode.ts`). The keymap + buttons are net-new.
- **No history/audit table exists.** Undo storage is greenfield; the session variant adds none.

### Key Discoveries:

- The pure inverse vocabulary already exists (`model/placement/placement-transitions.ts`, `model/placement/shelf-transitions.ts`) — `addManyOptimistic`/`removeManyOptimistic`/`settleMany`/`parkAddOptimistic`/`unparkOptimistic` are the optimistic primitives the reconcile executor reuses.
- Business-key reconciliation is already the codebase pattern: `persistMoveMembers`/`persistPlaceBack` match server rows to temp rows by `courseId` (`use-placements.ts:333,476`), exactly what redo of id-minting ops needs.
- Merge deletes the source bundle and place-back mints a fresh id — both flagged "noted for S-08 undo … snapshot/command-based" (`context/archive/2026-06-23-first-class-bundle-operations/plan.md:194`, `context/archive/2026-06-26-bundle-holding-container/plan.md:41`). Remove-then-place reconcile honors this by never reversing SQL.
- The no-flicker invariant: every whole-cell mutation lands in a single `setPlacements` pass (`model/use-placements.ts` throughout). Reconcile restores must obey it.
- The cross-index cycle (`use-cohort-board-state.ts:17-39`) means both `usePlacements` calls must land before either fresh index — the history wiring threads through the same ordering constraint.

## Desired End State

An author editing the board can press **⌘Z / Ctrl+Z** (or click a toolbar **Undo** button) to reverse their last editing operation, and **⌘⇧Z / Ctrl+Y / Ctrl+Shift+Z** (or **Redo**) to re-apply it, across a multi-step history that interleaves both cohorts. The buttons disable when their stack is empty and their tooltip names the next step ("Undo: remove bundle at Mon · P3"). Each undo/redo persists to Supabase, so a page reload shows the stepped-back board (and clears the stack — no stepping past the reload). Collision tones re-derive automatically, cross-cohort included.

Verify: with a plan open, perform any editing op, press ⌘Z → it reverses on screen; reload → the reversed state persists, both buttons disabled. `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm check`, `pnpm steiger`, `pnpm build` all pass.

## What We're NOT Doing

- **No durable-across-reload history in this change** — the engine is built behind a `HistoryStore` interface so a durable (table-backed, async-written) implementation is an additive fast-follow, but no migration, RLS/grants, or `clone_plan` change ships here.
- **No REPLACE undo** — there is no replace operation (occupied-cell drops merge; the merge is covered via the move/place path).
- **No UNGROUP undo** — ungroup is ephemeral in-session UI state (`model/use-exploded-cells.ts`), explicitly excluded from the stack.
- **No new RPCs and no constraint-core change** — undo/redo replays the existing atomic, idempotent RPCs.
- **No "clear shelf" / bulk operations**, no per-RPC granularity (a composite is one step), and no cross-device sync.

## Implementation Approach

A **pure engine** does the thinking; the **existing write path** does the persisting; the **orchestrator** holds the stacks; a **thin UX layer** triggers it.

1. **Pure engine** (`model/history/`): `sliceAt` extracts the affected cells/cards from board state; `diffReconcile(current, target)` produces a remove-then-place / delete-then-create `ReconcilePlan` matched by business key; `HistoryStore` is a two-stack interface with an in-memory implementation; `history-label` derives the human label. All pure, all unit-tested — the correctness core.
2. **Write-path integration** (`use-placements.ts`): each `persist*` records a `before` snapshot + affected scope + label via an injected `onRecord` callback on settled success; a new **non-recording** `applyReconcile(target, scope)` executes a reconcile plan over the existing RPCs (optimistic + rollback + id-remap), and a `snapshot(scope)` getter reads the live affected slice. The recorder-bypass invariant is structural: undo/redo call `applyReconcile`, never `persist*`.
3. **Orchestration** (`model/history/use-history.ts` + `use-cohort-board-state.ts`): wire `onRecord` into both cohorts (tagging the cohort, clearing redo on fresh edits); `undo`/`redo` pop an entry, capture the live forward target, call the right cohort's `applyReconcile`, and **commit the stack move only on success**.
4. **UX** (`model/history/use-undo-keymap.ts` + `ui/chrome`): a focus-guarded keymap hook and `PlanSummaryBar` Undo/Redo buttons.

**The captured-snapshot trick:** only the `before` slice is stored at edit time (read synchronously at gesture start). The forward (redo) target is captured *live at undo time* — at the moment of undo, the top entry's affected cells reflect the post-edit state, so reading them then yields the redo target without any fragile post-settle snapshot. This keeps recording trivial and dodges React state-timing pitfalls.

## Critical Implementation Details

- **State-timing (load-bearing).** `placementsRef` / `parkedBundlesRef` lag by one render (updated in `useEffect`, `use-placements.ts:538-544`), so they are stale *mid-settle* but fresh *across user gestures*. Capture `before` synchronously at the **top** of each `persist*` (gesture start → fresh). Capture the forward/redo target via `snapshot(scope)` at **undo/redo time** (a separate gesture → fresh). Never snapshot inside a `setState` updater (the React Compiler forbids the side effect and StrictMode double-invokes updaters). **In-flight guard:** because the refs are only fresh *across* gestures, gate `undo`/`redo` (and their buttons) on a `busy` flag — any `pending` row or a running reconcile — so a rapid ⌘Z mid-settle can't fire against a not-yet-recorded edit or a stale ref.
- **Orchestrator ordering cycle.** The `record` callback (pushes to the store, clears redo) must be **stable** and passed *into* both `usePlacements` as `onRecord`; `undo`/`redo` need each cohort's `applyReconcile`, which only exists *after* `usePlacements` runs. Resolve by **splitting the engine into two hooks called at the two ends of the cohort assembly** — `useHistoryRecorder()` (store + stable `record`) at the top, then `useHistoryControls(store, cohortApis)` after both bases — exactly as the file already sequences the cross-index cycle (placements first, derived index after). No single hook both consumes `cohortApis` and produces the upstream `record`; no render-time read of a not-yet-built value.
- **No-flicker single pass.** A reconcile restore must set each store in one `setPlacements` / `setParkedBundles` pass (the whole-cell invariant), so collisions/hours re-derive once. Two-store ops (lift/place-back undo) update both stores in the same tick.
- **Recorder bypass is structural, not a flag.** `applyReconcile` performs no recording; `persist*` records unconditionally on success; `undo`/`redo` use `applyReconcile` + direct stack management. There is no "is this undo?" mode flag to get wrong.

## Phase 1: Pure history engine

### Overview

Build the framework-free, fully-unit-tested core in a new `model/history/` segment: the affected-slice extractor, the diff-reconcile plan builder, the two-stack store behind a durable-ready interface, and the label helper. No React, no I/O.

### Changes Required:

#### 1. History types

**File**: `src/_pages/plan-detail/model/history/history-entry.ts`

**Intent**: Define the vocabulary the whole feature shares — what an operation touched, the snapshot of that region, a history entry, and the reconcile plan.

**Contract**: Exports the types:
- `AffectedScope = { cells: string[]; cardSets: ParkedMember[][] }` — the cell keys (via `model/collision/cell-key`) and shelf member-sets an op touched (a move → source + target cells; a lift → source cell + the card's member-set).
- `AffectedSlice = { placements: PlannerPlacement[]; cards: ParkedMember[][] }` — board rows at the scoped cells + the scoped cards' member-sets.
- `HistoryEntry = { cohort: Cohort; scope: AffectedScope; target: AffectedSlice; label: string }` — `target` is the slice to reconcile *to* (undo entries hold the `before` slice; redo entries hold the captured-forward slice).
- `ReconcilePlan = { toRemove: PlacementKey[]; toPlace: PlacementSpec[]; cardsToDelete: ParkedMember[][]; cardsToCreate: ParkedMember[][] }`, where `PlacementKey`/`PlacementSpec` carry `{ courseId, day, period, week }`.

#### 2. Affected-slice extractor

**File**: `src/_pages/plan-detail/model/history/affected-slice.ts`

**Intent**: Read the slice of board state at a given scope — used both to capture `before` and to capture the live forward target.

**Contract**: `sliceAt(placements: LocalPlacement[], cards: LocalParkedBundle[], scope: AffectedScope): AffectedSlice` — pure; returns the placements whose cell ∈ `scope.cells` (stripped of `pending`/local-only fields to a clean `PlannerPlacement` shape) and the cards whose member-set ∈ `scope.cardSets` (matched as a multiset). Newspaper order: exported fn first, member-set comparison helper below.

#### 3. Diff-reconcile plan builder (the heart)

**File**: `src/_pages/plan-detail/model/history/reconcile.ts`

**Intent**: Compute the minimal RPC plan that drives the live affected slice to a target slice, operation-agnostically.

**Contract**: `diffReconcile(current: AffectedSlice, target: AffectedSlice): ReconcilePlan` — pure. Board: `toRemove` = current placements whose `(courseId, day, period, week)` ∉ target; `toPlace` = target placements whose key ∉ current (so a move = remove@source + place@target, a week-flip = remove@oldWeek + place@newWeek, merge-undo = places at both cells, no-op = empty). Shelf: multiset diff over member-sets → `cardsToDelete` / `cardsToCreate`. **Invariant: removes are ordered before places** (and card-deletes before card-creates) so a re-place can never collide with a row the same plan is about to delete (the `one placed bundle per cell` index). Express as declarative set composition (per the lessons rule), not accumulator loops.

#### 4. Durable-ready history store

**File**: `src/_pages/plan-detail/model/history/history-store.ts`

**Intent**: A two-stack store behind an interface, so the session (in-memory) implementation can later be swapped for a durable one without touching the engine.

**Contract**: Exports `type HistoryStore` with `push(entry)`, `popUndo()`, `popRedo()`, `peekUndo()`, `peekRedo()`, `canUndo()`, `canRedo()`, and the undo↔redo transfer the orchestrator drives (e.g. `commitUndo(redoEntry)` / `commitRedo(undoEntry)` — push to the opposite stack). `push` (a fresh user edit) clears the redo stack. Plus `createInMemoryHistoryStore(): HistoryStore`. Optional `maxDepth` cap (default generous, e.g. 100) to bound memory.

#### 5. Label helper

**File**: `src/_pages/plan-detail/model/history/history-label.ts`

**Intent**: Turn an edit into a short human label for the button tooltip.

**Contract**: `describeEdit(kind: EditKind, cell?: CellData): string` → e.g. `"Remove bundle at Mon · P3"`, `"Place group at Tue · P4"`, `"Park bundle"`. Day/period formatting reuses any existing grid-label helper if present; otherwise a local map. `kind` is a small union the `persist*` callers pass.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`

#### Manual Verification:

- `diffReconcile` test cases read like their spec (add / remove / move / week-flip / merge-undo / no-op; shelf create / delete / identical-member-set multiset; lift-undo combined board+shelf plan; removes-before-places ordering).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Write-path integration (recording + reconcile executor)

### Overview

Wire recording into every `persist*` settled-success path, add a non-recording `applyReconcile` executor and a live `snapshot` getter to `usePlacements`. After this phase, an injected `onRecord` fires correctly for every edit and `applyReconcile` can drive state to any target slice — but nothing calls them yet.

### Changes Required:

#### 1. Framework-free reconcile executor

**File**: `src/_pages/plan-detail/model/history/reconcile-exec.ts`

**Intent**: Translate a `ReconcilePlan` into an ordered sequence of RPC calls, parameterized over *how* an RPC is issued, so the React hook and the integration test share one sequencing path (Workers-safe, framework-free). **Preserve the DB-level atomicity the forward path has: route any reconcile that reduces to a single existing compound RPC through that RPC, and decompose into primitives only when no atomic equivalent covers the diff.**

**Contract**: `executeReconcilePlan(plan, deps): Promise<ReconcileResult>`.
- `deps` injects both the **atomic compound ops** — `moveMembers(source, target, courseIds)` (→ `move_bundle_members`), `shelve(cell)` (→ `shelve_bundle`), `unshelve(shelfBundleId, target)` (→ `unshelve_bundle`) — **and** the decomposed primitives `place(spec)`, `removeMembers(cell, courseIds)`, `createCard(members)`, `deleteCard(shelfBundleId)`, plus `resolveCardId(memberSet): string | undefined` to map a `cardsToDelete` member-set to a current card id.
- **Atomicity-preserving dispatch.** Recognize the plan's shape before decomposing: a pure board relocation / merge-onto-occupied (remove@source + place@target, same member-set) → one `move_bundle_members`; a lift (board-removes + one card-create, no card-deletes) → one `shelve_bundle`; a place-back (one card-delete + board-places, no board-removes) → one `unshelve_bundle`. **Only** when the diff touches multiple board cells or mixes both stores in a way no single RPC covers (notably merge-*undo*, which re-places at two cells) does it fall back to the decomposed sequence (order: card-deletes → board-removes → board-places → card-creates). This gives undo/redo the same transactional guarantee the forward path has for move/lift/place-back; the multi-cell fallback is the only non-atomic path and is bounded to the rare merge-undo (call it out in that integration case).
- Returns the placed/relocated server rows (for client id-remap) and created card ids. The React side injects the `api/*-client` action wrappers (both compound and primitive); the integration test injects the `api/placements`/`api/shelf` domain fns over a real Supabase client.

#### 2. Recording + executor + snapshot in `usePlacements`

**File**: `src/_pages/plan-detail/model/use-placements.ts`

**Intent**: Capture a `before` slice and record it on each successful user edit; expose a non-recording reconcile executor and a live-slice getter for the orchestrator to drive undo/redo.

**Contract**:
- New optional arg `onRecord?: (entry: Omit<HistoryEntry, "cohort">) => void` on `UsePlacementsArgs` (the orchestrator tags `cohort`).
- Each `persist*` computes its `AffectedScope` (it already knows source/target/cell/members) and captures `before = sliceAt(placementsRef.current, parkedBundlesRef.current, scope)` **synchronously at the top**; on settled success calls `onRecord({ scope, target: before, label: describeEdit(...) })`. **Not** called on the rollback path. `duplicateBundle` records once via its `addGroup` call (no extra recording).
- New `applyReconcile(target: AffectedSlice, scope: AffectedScope): Promise<{ ok: boolean }>` — computes `diffReconcile(snapshot(scope), target)`, optimistically updates both stores to `target` in a single pass (reusing the existing optimistic transitions), runs `executeReconcilePlan` with the client wrappers (atomic compound + primitive), settles ids by business key (`settleMany` pattern), and on failure rolls both stores back and surfaces the error via the existing `error` channel. **Does not record.**
- New `snapshot(scope: AffectedScope): AffectedSlice` — `sliceAt` over the live refs.
- New `busy: boolean` — true while any optimistic edit or `applyReconcile` is in flight (a `pending` row exists in either store, or a reconcile is running). Lets the orchestrator gate undo/redo against the ref-lag window.
- Add `applyReconcile`, `snapshot`, and `busy` to the returned `UsePlacements`.

#### 3. Surface the new methods through the per-cohort assembler

**File**: `src/_pages/plan-detail/model/use-cohort-board-state.ts`

**Intent**: Thread `onRecord` into `usePlacements` and expose `applyReconcile` / `snapshot` on the assembled per-cohort base so the orchestrator can reach them.

**Contract**: `useCohortPlacements` accepts/forwards `onRecord`; the returned `base.api` already carries `applyReconcile`/`snapshot`/`busy`. No change to `toCohortState`'s public board shape (history is orchestrator-level, added in Phase 3).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test` — covering: `onRecord` fires once per settled edit across the full op matrix (add, group, single/bundle move, merge, single/bundle remove, **setWeek**, lift, place-back, park-set, discard, duplicate→one entry); `onRecord` does **not** fire on rollback; `onRecord` does **not** fire from `applyReconcile`; `applyReconcile` drives state to target via the right mocked RPCs with id-remap and two-store atomicity; reconcile failure rolls back and surfaces the error.
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`

#### Manual Verification:

- The recorder-bypass invariant holds by construction (no mode flag); reviewer confirms `applyReconcile` has no `onRecord` path.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Plan-level undo/redo orchestration

### Overview

Introduce the history hooks (`useHistoryRecorder` + `useHistoryControls`) and wire them into `useCombinedBoardState`: a single plan-level stack interleaving both cohorts, `undo`/`redo` with commit-on-success, and `canUndo`/`canRedo`/labels exposed to the board.

### Changes Required:

#### 1. The orchestration hooks (split to resolve the ordering cycle)

**File**: `src/_pages/plan-detail/model/history/use-history.ts` (exports both hooks)

**Intent**: Own the store and expose the recorder + undo/redo engine over the two cohorts' reconcile/snapshot methods — **split into two hooks** so the stable `record` exists *before* `usePlacements` runs and `undo`/`redo` bind to the cohort apis *after*.

**Contract**: two hooks, called at the two ends of the cohort assembly:
- `useHistoryRecorder(): { store: HistoryStore; record: (cohort: Cohort, entry: Omit<HistoryEntry, "cohort">) => void }` — built **first**, at the top of the orchestrator. The store lives in a `useRef`; `record` is **stable** (closes over the ref, tags the cohort, pushes, clears redo; a small state counter drives `canUndo`/`canRedo` re-render). `record` is what each `usePlacements` receives as `onRecord`.
- `useHistoryControls(store: HistoryStore, cohortApis: Record<Cohort, { applyReconcile; snapshot; busy }>): { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }` — called **after** both `useCohortPlacements` return, so `cohortApis` (and thus `applyReconcile`/`snapshot`/`busy`) already exist. No render-time read of a not-yet-built value.
  - **In-flight guard.** `canUndo = store.canUndo() && !busy` and `canRedo = store.canRedo() && !busy`, where `busy = cohortApis.dp1.busy || cohortApis.dp2.busy`; `undo`/`redo` early-return when `busy`. This blocks a rapid ⌘Z during an unsettled optimistic edit from popping a not-yet-recorded entry or reading a mid-settle ref. Because the keymap and buttons consume these same `canUndo`/`canRedo`, the guard covers every trigger in one place.
  - `undo`: `store.peekUndo()`; if none, no-op. Capture `forward = cohortApis[entry.cohort].snapshot(entry.scope)`. `await applyReconcile(entry.target, entry.scope)`; **only on `ok`** move the entry to the redo stack with `target: forward` (commit-on-success). On failure, leave both stacks untouched (the executor already rolled client + surfaced the error) and leave the entry retryable.
  - `redo`: mirror — reconcile to the redo entry's `target`, capture forward, move to undo on success.

#### 2. Wire history into the orchestrator

**File**: `src/_pages/plan-detail/model/use-cohort-board-state.ts`

**Intent**: Call `useHistoryRecorder` first, feed its `record` into both `usePlacements` as `onRecord`, then call `useHistoryControls` after the bases, and return the history surface alongside `dp1`/`dp2`.

**Contract**: At the top of `useCombinedBoardState`, `const { store, record } = useHistoryRecorder()`; pass `(entry) => record(cohort, entry)` as each cohort's `onRecord` through `useCohortPlacements`. After both `dp1Base`/`dp2Base` exist, `const history = useHistoryControls(store, { dp1: dp1Base.api, dp2: dp2Base.api })`. This resolves the ordering cycle by construction — `record` precedes the bases, `undo`/`redo` follow them — exactly as the live cross-index cycle is sequenced. Extend the return to `{ dp1, dp2, history }`. `CombinedBoardState` type picks up `history`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test` — covering: single edit → undo restores → redo re-applies; multi-step walk (3 edits, undo×3 / redo×3); **cross-cohort interleaving** (edit dp1, edit dp2 → undo undoes dp2 then dp1); fresh edit clears redo; **commit-on-success** (failed reconcile leaves both stacks untouched + error surfaced, retry converges); the **before-only-snapshot** correctness test (edit cell X twice → undo → intermediate state → undo → original); the **in-flight guard** (undo/redo are no-ops and `canUndo`/`canRedo` are false while `busy`).
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`

#### Manual Verification:

- Reviewer confirms the ordering-cycle resolution mirrors the existing cross-index pattern and introduces no render-time read of a not-yet-built value.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: UX surface — keyboard + toolbar buttons

### Overview

Make undo/redo reachable: a focus-guarded keymap hook (⌘Z/⌘⇧Z + Ctrl variants) and Undo/Redo buttons in the `PlanSummaryBar` with disabled-state and next-step tooltips. Wire both from `PlannerBoard` via the orchestrator's `history`.

### Changes Required:

#### 1. Keymap hook

**File**: `src/_pages/plan-detail/model/history/use-undo-keymap.ts`

**Intent**: Bind the global undo/redo shortcuts while the board island is mounted, without hijacking text editing.

**Contract**: `useUndoKeymap({ undo, redo, canUndo, canRedo })` — a `useEffect` `keydown` listener on `window` (guarded by `typeof window`), cleaned up on unmount. ⌘Z / Ctrl+Z → undo; ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y → redo (handle both meta and ctrl for cross-platform). **Guard: ignore when the event target is an `input`, `textarea`, or `contenteditable`** so typing in a field never triggers undo. `preventDefault` only when a stack action is actually dispatched.

#### 2. Undo/Redo controls

**File**: `src/_pages/plan-detail/ui/chrome/` (new `UndoRedoControls.tsx`, exported via the chrome barrel)

**Intent**: A discoverable toolbar affordance reflecting stack state.

**Contract**: Two token-based shadcn icon buttons (Undo / Redo), `disabled` from `canUndo`/`canRedo`. The next-step label is the native **`title`** attribute (= `undoLabel`/`redoLabel`, e.g. "Undo: remove bundle at Mon · P3", or a plain "Undo"/"Redo" when the stack is empty), mirrored on `aria-label` for a11y — there is **no Tooltip primitive in `@/shared/ui`** and the criterion doesn't warrant adding one. Semantic theme tokens only (per the lessons rule). Rendered in `PlanSummaryBar`'s `trailing` slot beside the existing `DragHintModeToggle`.

#### 3. Wire from the board

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx` (and `ui/chrome/PlanSummaryBar` for the new prop)

**Intent**: Pass the orchestrator's `history` into the keymap hook and the controls.

**Contract**: Destructure `history` from `useCombinedBoardState`; call `useUndoKeymap(history)`; pass `history` (or its `{undo,redo,canUndo,canRedo,undoLabel,redoLabel}`) into `PlanSummaryBar` → `UndoRedoControls`. `PlanSummaryBar` gains a typed `undoRedo` prop.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test` — keymap dispatches undo/redo for the right chords, **ignores input/textarea/contenteditable focus**, cleans up on unmount; `UndoRedoControls` disabled-state and tooltip reflect props.
- Integration tests pass: `pnpm test:integration` — the reconcile round-trip suite (below).
- E2E tests pass: `pnpm test:e2e` — the durability-contract scenario (below).
- Type checking passes: `pnpm check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build is clean: `pnpm build`

#### Manual Verification:

- ⌘Z / ⌘⇧Z reverse and re-apply edits in the running app; typing in a field does not trigger undo.
- Undo/Redo buttons disable at empty stack, enable after an edit, tooltips name the next step.
- After an undo, reloading the page shows the stepped-back board (durable) and both buttons disabled (session stack cleared).
- Collision tones re-derive correctly after undo/redo, cross-cohort included; lift→place-back→⌘Z steps back through the error-prone workflow.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the manual + e2e testing was successful.

---

## Testing Strategy

### Unit Tests (Vitest, co-located `*.test.ts(x)`):

- **Engine (Phase 1)**: `diffReconcile` across every shape (add/remove/move/week-flip/merge-undo/no-op; shelf create/delete/identical-set multiset; combined lift-undo plan; removes-before-places ordering); `sliceAt` (cell union, empty cells, card multiset match); `HistoryStore` (push-clears-redo, pop/peek, can\*, the interface contract); `describeEdit` labels.
- **Write path (Phase 2)**: the `onRecord`-firing matrix; no-record on rollback; no-record from `applyReconcile`; `applyReconcile` state-drive + id-remap + two-store atomicity + rollback (mocked RPC clients, per the existing `use-placements.test.tsx`).
- **Orchestration (Phase 3)**: undo/redo, multi-step, cross-cohort interleaving, redo-invalidation, commit-on-success, the before-only-snapshot stale-cell test.
- **UX (Phase 4)**: keymap chord matching + focus guard + cleanup; controls disabled/tooltip.

### Integration Tests (`*.integration.test.ts`, real local Supabase, `pnpm test:integration`):

One suite that, **for every editing op**, builds a plan via `src/test/factories/`, snapshots state `S0`, applies the forward edit, then executes the reconcile plan via `executeReconcilePlan` with the **domain fns over a real Supabase client**, and asserts the DB **re-hydrates via the `load.ts` projection back to `S0`**. Cleanup via `teardown` (per the harness convention; no asserting against raw seed rows).

Ops covered (heavier-integration decision): add, group, single-course move, whole-bundle move, **merge**, single-course remove, whole-bundle remove, **setWeek**, lift, place-back, park-set, discard, duplicate. The constraint-sensitive cases (move/merge/lift/place-back/week-flip) are the ones that exercise behaviors mocks can't — the `one placed bundle per cell` partial unique index, the `== 0` bundle cleanup + find-or-create re-mint, the unique-key-excludes-week semantics, and `placements`↔`shelf_*` two-store consistency + cascade — but all ops are round-tripped for maximal DB confidence.

### E2E Tests (Playwright, `pnpm test:e2e`, driven via `/10x-e2e` after Phase 4):

- **The durability contract (highest value)**: edit a bundle → ⌘Z reverses it on screen → **reload** → the reversed state persists (undo wrote through to Supabase) → both buttons disabled (session stack cleared).
- **Happy-path smoke**: the lift→place-back workflow that motivated FR-013, stepped back with ⌘Z; button disabled→enabled transitions and tooltip; the input-focus guard in the real DOM.

### Manual Testing Steps:

1. Open a plan; place a grouping; press ⌘Z → the whole group is removed in one step; ⌘⇧Z → it returns.
2. Lift a bundle to the shelf, place it back elsewhere, then ⌘Z twice → place-back then lift are reversed; the bundle is back at its origin.
3. Edit dp1, then dp2; ⌘Z → dp2's edit reverses; ⌘Z again → dp1's reverses.
4. Flip a bi-weekly chip A↔B; ⌘Z → the week reverts.
5. Click into a text field and press ⌘Z → undo does **not** fire.
6. Undo an edit, reload → the stepped-back state persists; buttons disabled.

## Performance Considerations

Undo/redo is **not** on the <200ms drag hot path, and the session stack adds **no** synchronous write to any edit (recording is an in-memory push). Snapshots are O(1) reference holds of immutable arrays. Restoring re-validates via the existing `useMemo` collision derivation — no new validation work. The reconcile's remove-then-place issues a few more RPCs than a bespoke inverse would, but over tens-to-low-hundreds of rows this is negligible and off the hot path.

## Migration Notes

None — no schema change. The durable-across-reload variant (a fast-follow) would add one append-only history table with RLS + `revoke anon` grants (per the grants lesson), written async to protect the drag budget, and omitted from `clone_plan`; the `HistoryStore` interface is the seam it slots into with no engine rework.

## References

- Research: `context/changes/editing-undo-redo/research.md`
- Orchestrator / op-log home: `src/_pages/plan-detail/model/use-cohort-board-state.ts:40-80`
- Write path + optimistic primitives: `src/_pages/plan-detail/model/use-placements.ts`, `model/placement/placement-transitions.ts`, `model/placement/shelf-transitions.ts`
- Atomic RPCs: `src/_pages/plan-detail/api/placements.ts`, `api/shelf.ts`
- Free re-validation: `src/_pages/plan-detail/model/use-board-derivations.ts:30-40`
- Prior decisions: `context/archive/2026-06-23-first-class-bundle-operations/plan.md:194`, `context/archive/2026-06-26-bundle-holding-container/plan.md:41`, `context/archive/2026-06-27-combined-two-cohort-view/research.md:48,113`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure history engine

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` — 8d62600
- [x] 1.2 Type checking passes: `pnpm check` — 8d62600
- [x] 1.3 Linting passes: `pnpm lint` — 8d62600
- [x] 1.4 FSD structure check passes: `pnpm steiger` — 8d62600

#### Manual

- [x] 1.5 `diffReconcile` test cases cover add/remove/move/week-flip/merge-undo/no-op + shelf create/delete/multiset + combined lift-undo + removes-before-places ordering — 8d62600

### Phase 2: Write-path integration (recording + reconcile executor)

#### Automated

- [x] 2.1 Unit tests pass: `pnpm test` (onRecord matrix; no-record on rollback / from applyReconcile; applyReconcile state-drive + id-remap + two-store + rollback)
- [x] 2.2 Type checking passes: `pnpm check`
- [x] 2.3 Linting passes: `pnpm lint`
- [x] 2.4 FSD structure check passes: `pnpm steiger`

#### Manual

- [x] 2.5 Reviewer confirms recorder-bypass is structural (no mode flag; applyReconcile has no record path)

### Phase 3: Plan-level undo/redo orchestration

#### Automated

- [ ] 3.1 Unit tests pass: `pnpm test` (undo/redo, multi-step, cross-cohort interleaving, redo-invalidation, commit-on-success, before-only-snapshot stale-cell, in-flight guard)
- [ ] 3.2 Type checking passes: `pnpm check`
- [ ] 3.3 Linting passes: `pnpm lint`
- [ ] 3.4 FSD structure check passes: `pnpm steiger`

#### Manual

- [ ] 3.5 Reviewer confirms ordering-cycle resolution mirrors the cross-index pattern (no render-time read of a not-yet-built value)

### Phase 4: UX surface — keyboard + toolbar buttons

#### Automated

- [ ] 4.1 Unit tests pass: `pnpm test` (keymap chords + focus guard + cleanup; controls disabled/tooltip)
- [ ] 4.2 Integration tests pass: `pnpm test:integration` (reconcile round-trip for every editing op)
- [ ] 4.3 E2E tests pass: `pnpm test:e2e` (durability contract + happy-path smoke)
- [ ] 4.4 Type checking passes: `pnpm check`
- [ ] 4.5 Linting passes: `pnpm lint`
- [ ] 4.6 FSD structure check passes: `pnpm steiger`
- [ ] 4.7 Production build is clean: `pnpm build`

#### Manual

- [ ] 4.8 ⌘Z / ⌘⇧Z reverse and re-apply edits in the running app; typing in a field does not trigger undo
- [ ] 4.9 Undo/Redo buttons disable at empty stack, enable after an edit, tooltips name the next step
- [ ] 4.10 After an undo, reload shows the stepped-back board (durable) and both buttons disabled (session stack cleared)
- [ ] 4.11 Collision tones re-derive after undo/redo (cross-cohort); lift→place-back→⌘Z steps back through the workflow
