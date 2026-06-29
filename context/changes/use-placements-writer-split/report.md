# Proposal: split `usePlacements` into a write-context + writer factories

**Status:** Draft for team decision · **Author:** (review session) · **Date:** 2026-06-29
**Scope:** `src/_pages/plan-detail/model/use-placements.ts` and the placement write path
**Decision needed:** Adopt the restructure (full / partial / not now)?

---

## TL;DR

`usePlacements` is correct and well-factored, but its hook body still declares ~22 functions
(12 thin public wrappers + 10 async `persist*` orchestrators). The density — not any bug — is the
remaining readability problem.

We propose extracting the forward write path into **two plain factory modules**
(`board-writes.ts`, `shelf-writes.ts`) driven by a shared **`WriteContext`**, mirroring the already-shipped
`useReconcileExecutor` extraction. The hook collapses from ~470 lines of body to ~30 lines of assembly,
and each writer becomes unit-testable without rendering — matching the house rule "pure logic in `model/`,
hooks orchestrate."

**Lowest-risk subset (Move 1)** delivers most of the perceived relief for almost no risk; the **full split
(Move 2)** is the recommended end state.

---

## 1. Background

`usePlacements` owns the island-local placement state and the optimistic write path for the planner board.
Over two prior refactors it already absorbed our earlier review feedback and is in good shape:

- Pure state transitions live in `placement/placement-transitions.ts`, `placement/shelf-transitions.ts`,
  `history/reconcile-apply.ts` (framework-free, unit-tested).
- The **undo/redo reconcile executor** was extracted into `history/use-reconcile-executor.ts`
  (stores injected by ref + setter).
- RPCs are bound once via `api/rpcs.ts` (`makeRpcs(planId, cohort)`) and reused by both the forward path
  and the executor.
- The `placementBusinessKey` duplication was removed (now shared from `history/affected-slice.ts`).
- The React Compiler is enabled (`babel-plugin-react-compiler` in `astro.config.mjs`), so handlers are
  auto-memoized and the no-`useCallback` style is justified.
- The two known limits (single last-writer-wins `error` slot; `useLatest` one-commit ref lag) are documented
  in-code.

This proposal is the **next** increment: it does not change behavior, only structure.

---

## 2. Problem statement

The hook reads as one long list of inner functions. Concretely, the body declares:

| Group | Functions | Count |
|---|---|---|
| Thin public wrappers | `addCourse`, `addGroup`, `movePlacement`, `removePlacement`, `setWeek`, `moveBundle`, `removeBundle`, `duplicateBundle`, `shelveBundle`, `placeBack`, `parkMembers`, `removeParked` | 12 |
| Async orchestrators | `persistAdd`, `persistAddGroup`, `persistMember`, `persistMoveMembers`, `persistRemoveMembers`, `persistSetWeek`, `persistShelve`, `persistParkMembers`, `persistPlaceBack`, `persistRemoveParked` | 10 |
| Small helpers | `courseIdsAt`, `recordEdit`, `weekModeOf`, `cellScope`, `snapshot` | 5 |

Two structural causes:

1. **Wrapper/persister pairing.** 8 of the 12 public handlers are one-line forwarders to an async
   `persist*` (they exist only to expose a `void`-returning name). Pure noise.
2. **Closure capture.** The `persist*` functions are inner functions *only* because they close over
   `setPlacements`, `setParkedBundles`, both refs, `rpcs`, `recordEdit`, `setError`, and (for `duplicate`)
   the oracle inputs. That closure is the one thing keeping them from being module-level — which our
   conventions otherwise prefer.

---

## 3. Proposal

### 3.1 Shared `WriteContext`

Bundle everything the writers close over into one injected object (the same shape `useReconcileExecutor`
already needs, as a structural superset):

```ts
// model/placement/write-context.ts
export type WriteContext = {
  rpcs: Rpcs;
  placementsRef: RefObject<LocalPlacement[]>;
  parkedBundlesRef: RefObject<LocalParkedBundle[]>;
  setPlacements: Dispatch<SetStateAction<LocalPlacement[]>>;
  setParkedBundles: Dispatch<SetStateAction<LocalParkedBundle[]>>;
  setError: Dispatch<SetStateAction<PlacementError | null>>;
  recordEdit: (kind: EditKind, scope: AffectedScope, before: AffectedSlice, cell?: CellData) => void;
  snapshot: (scope: AffectedScope) => AffectedSlice;
  weekModeOf: (courseId: string) => WeekMode;
};

export const cellScope = (cell: CellData): AffectedScope => ({
  cells: [cellKey(cell.day, cell.period)],
  cardSets: [],
});
```

### 3.2 Two writer factories (plain functions, not hooks)

Split by **store ownership** — the axis the two stores already draw:

- `model/placement/board-writes.ts` → `createBoardWrites(ctx, boardDeps)` returns
  `{ addCourse, addGroup, movePlacement, removePlacement, setWeek, moveBundle, removeBundle, duplicateBundle }`.
  Owns `persistAdd`, `persistAddGroup`, `persistMember`, `persistMoveMembers`, `persistRemoveMembers`,
  `persistSetWeek`, plus the duplicate search. `boardDeps` carries the oracle inputs
  (`catalogById`, `availabilityIndex`, `crossCohortIndex`, `days`, `periods`) and `setLastDuplicated`.
- `model/placement/shelf-writes.ts` → `createShelfWrites(ctx)` returns
  `{ shelveBundle, placeBack, parkMembers, removeParked }`.
  The two-store atomic ops (`shelve`, `placeBack`) live here because `ctx` carries *both* setters.

They are plain factories (not hooks) — they use no hook primitives; state stays in the parent. Each public
handler is a one-line `void persist*` forwarder defined inline in the returned object, eliminating the
separate wrapper declarations.

### 3.3 The slimmed hook

```ts
export function usePlacements(initial, args): UsePlacements {
  const [placements, setPlacements] = useState(initial);
  const [parkedBundles, setParkedBundles] = useState(initialParked);
  const [error, setError] = useState<PlacementError | null>(null);
  const [lastDuplicated, setLastDuplicated] = useState<DuplicateOutcome | null>(null);
  const placementsRef = useLatest(placements);
  const parkedBundlesRef = useLatest(parkedBundles);

  const rpcs = useMemo(() => makeRpcs(planId, cohort), [planId, cohort]);

  const weekModeOf = (id) => weekModeByCourseId.get(id) ?? "agnostic";
  const snapshot = (scope) => sliceAt(placementsRef.current, parkedBundlesRef.current, scope);
  const recordEdit = (kind, scope, before, cell) =>
    onRecord?.({ scope, target: before, label: describeEdit(kind, cell) });

  const ctx: WriteContext = {
    rpcs, placementsRef, parkedBundlesRef, setPlacements, setParkedBundles,
    setError, recordEdit, snapshot, weekModeOf,
  };

  const { applyReconcile, reconciling } = useReconcileExecutor(ctx); // structural subset of ctx
  const board = createBoardWrites(ctx, { catalogById, availabilityIndex, crossCohortIndex, days, periods, setLastDuplicated });
  const shelf = createShelfWrites(ctx);

  const busy = reconciling || placements.some((p) => p.pending) || parkedBundles.some((c) => c.pending);

  return { placements, parkedBundles, error, lastDuplicated, busy, snapshot, applyReconcile,
    clearError: () => setError(null), ...board, ...shelf };
}
```

---

## 4. Target file layout

```
model/
  use-placements.ts            # ~30-line hook: state + ctx + assembly (was ~470 lines of body)
  placement/
    write-context.ts           # NEW — WriteContext type + cellScope
    board-writes.ts            # NEW — createBoardWrites (board/placement-store path)
    shelf-writes.ts            # NEW — createShelfWrites (shelf + two-store path)
    placement-transitions.ts   # unchanged (pure transitions)
    shelf-transitions.ts       # unchanged
  history/
    use-reconcile-executor.ts  # unchanged — now consumes WriteContext (subset)
  api/
    rpcs.ts                    # unchanged
```

---

## 5. Before / after

| Metric | Before | After |
|---|---|---|
| `use-placements.ts` hook body | ~470 lines | ~30 lines |
| `persist*` declarations in the hook | 10 | 0 |
| Inner functions in the hook | ~22 | 3 small consts + 2 factory calls |
| Writer files | 0 | 2 (cohesive, single-concern) |
| Writers unit-testable without rendering | No | Yes |
| Behavior change | — | None |

---

## 6. Why this axis / these decisions

- **Split by store ownership, not by verb.** `shelve`/`placeBack` are genuinely two-store; putting them in a
  shelf-only module works because `ctx` carries both setters. Splitting `board-writes` further (adds vs.
  moves) would over-fragment a cohesive concern; `board-writes` at ~14 functions in a single-purpose file is
  far more readable than 22 in a multi-purpose hook.
- **Factories, not hooks.** The writers call no hook primitives, so a hook wrapper would force them back to
  being inner functions and buy nothing.
- **`useReconcileExecutor(ctx)` just works.** Its param type is a structural subset of `WriteContext`;
  passing a wider variable where a narrower type is expected is allowed (excess-property checks only fire on
  fresh object literals). One fewer bespoke deps shape to maintain.
- **Consistency.** This is the *same* fracture pattern (inject stores by ref + setter) we already shipped for
  the reconcile executor, and it honors the documented house rule: pure logic in `model/`, hooks orchestrate.

---

## 7. Trade-offs / costs

- **`ctx.` threading.** Inside the writers, every `setPlacements` becomes `ctx.setPlacements`, etc. This is
  the main ergonomic cost. We judge it worth paying for the module-level testability the codebase already
  favors (the whole `*-transitions.ts` layer is written this way).
- **More files.** Three new small modules vs. one big hook. Net complexity is lower, but file count rises.
- **Identity churn (negligible).** The factories run each render and return fresh handler objects. Fine under
  the React Compiler, and `toCohortState` in `use-cohort-board-state.ts` already rebuilds its `actions`
  object every render. Memoizing on `ctx` is possible but would require stabilizing `ctx`
  (`useCallback` on `snapshot`/`recordEdit`/`weekModeOf`); **not** recommended pre-profiling.

---

## 8. Alternatives considered

1. **Move 1 only — fold trivial wrappers into the return object.** Delete the 8 logic-free wrappers; inline
   them as `addCourse: (id, cell) => void persistAdd(id, cell)` etc. Removes ~8 declarations, puts the public
   contract in one place, zero behavior risk. **Keep this even if we adopt the full split — it is the first
   step of it.** As a standalone, it relieves most of the "too many functions" feeling cheaply but leaves the
   `persist*` set inside the hook.
2. **Free module-level functions taking an explicit `ctx` first arg** (`persistAdd(ctx, id, cell)`) instead
   of closures returned from a factory. Equivalent testability, but threads `ctx` at every call site too
   (not just inside the bodies). The factory keeps call sites clean; rejected as noisier.
3. **`useReducer` / command pattern for the stores.** Optimistic + async + rollback doesn't map cleanly to a
   pure reducer (RPC side effects), so it would need effect middleware. Heavier and less readable here.
   Rejected.
4. **Do nothing.** Defensible — the hook is correct. But the team explicitly flagged readability, and the
   change is low-risk and reversible.

---

## 9. Risk & migration plan (phased, each independently shippable)

1. **Phase 0 — Move 1 (wrappers).** Fold logic-free wrappers into the return object. ~15 min, zero risk.
2. **Phase 1 — `write-context.ts`.** Introduce `WriteContext` + `cellScope`; build `ctx` in the hook and
   thread it into the existing inner `persist*` (still inner). Pure plumbing; behavior identical.
3. **Phase 2 — `shelf-writes.ts`.** Move the 4 shelf persisters + handlers into `createShelfWrites(ctx)`;
   spread `...shelf` into the return. Smaller, lower-coupling surface — do this first to validate the seam.
4. **Phase 3 — `board-writes.ts`.** Move the board persisters + handlers + duplicate search into
   `createBoardWrites(ctx, boardDeps)`; move `DuplicateOutcome` type with it; spread `...board`.
5. **Phase 4 — point `useReconcileExecutor` at `ctx`.** Replace its bespoke deps object with `ctx`.

Each phase keeps `use-placements.test.tsx` green (the public surface and `rpcs`/client mocks are unchanged).

---

## 10. Testing strategy

- **No public-surface change** → existing `use-placements.test.tsx` and the integration/e2e suites should pass
  untouched. This is the primary regression guard.
- **New unit tests (the payoff):** test `createBoardWrites` / `createShelfWrites` directly with a fake
  `WriteContext` (stub setters/refs/rpcs), asserting optimistic → settle/rollback transitions without
  rendering a component — matching how `*-transitions.ts` is already tested.
- **Verify** with the `/verify` gate (install → astro sync → lint → steiger → test → build) before each phase
  lands. Watch `steiger` for FSD layering (all new files stay within the `plan-detail` slice's `model`/`api`
  segments, no upward imports).

---

## 11. Open questions for the team

1. **Full split or Move 1 only?** Recommendation: full split (Phases 0–4), but Move 1 alone is a legitimate
   stopping point if we want minimal churn now.
2. **`useLatest` home.** Keep it private in `use-placements.ts`, or move it to `placement/use-latest.ts` so
   the ref-lag footgun comment lives next to it and could be reused? (Cosmetic.)
3. **Split axis.** Are we comfortable with board/shelf as the boundary, accepting that `shelve`/`placeBack`
   (two-store) live in `shelf-writes`? Alternative naming: `single-store-writes` / `cross-store-writes`.
4. **Memoization.** Leave factories unmemoized (rely on React Compiler) — agreed, or do we want belt-and-
   suspenders `useMemo` on a stabilized `ctx`?

---

## 12. Recommendation

Adopt the **full split via the phased plan**, starting with Phase 0 (Move 1) which is independently valuable
and de-risks the rest. The change is behavior-preserving, reversible per phase, consistent with the
already-shipped reconcile-executor pattern, and turns the last "big list of functions" into focused,
testable modules with a ~30-line orchestrator.
