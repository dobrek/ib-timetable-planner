---
date: 2026-06-28T19:42:00+02:00
researcher: Dobromir Kropielnicki
git_commit: 23805bf6fb8e7eefdd2b35133028c0078ca1156f
branch: main
repository: ib-timetable-planner
topic: "Feasibility of editing undo/redo (roadmap S-08, FR-013)"
tags: [research, codebase, plan-detail, undo-redo, bundles, placements, shelf, feasibility]
status: complete
last_updated: 2026-06-28
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Author resolved both blocking items (no REPLACE op; UNGROUP excluded); added the Proposed Mechanism section for the recommended session-lifetime variant."
---

# Research: Feasibility of editing undo/redo (roadmap S-08, FR-013)

**Date**: 2026-06-28T19:42:00+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 23805bf6fb8e7eefdd2b35133028c0078ca1156f
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

Check the feasibility of implementing the undo/redo feature from the roadmap (slice **S-08**, change-id `editing-undo-redo`, PRD **FR-013**). Undo/redo must cover the editing operations: bundle move, remove, replace, ungroup, single-course move, lift-to-container, and place-back. The roadmap leaves the *scope* undecided (PRD Open Q #1): single-step vs multi-step, session-only vs durable. This research assesses **all** scope variants and **recommends one**, then maps the architectural seams, risks, and effort.

## Summary

**Verdict: FEASIBLE — feasible with one open product decision, no technical blocker.**

S-08 is marked `blocked` in the roadmap, but the block is the *scope decision* (Open Q #1), **not** missing code or an architectural obstacle. Concretely:

- **Prerequisites are done.** Every operation FR-013 must wrap already exists and is shipped (S-05 first-class bundles, S-07 holding container, S-06 combined view — all archived). The mutation layer is uniform: Astro Action → framework-free domain fn → **one atomic, idempotent Postgres RPC** → optimistic client hook.
- **The architecture was deliberately pre-shaped for S-08.** Three migration headers and two prior plans literally say undo will be *"snapshot/command-based, never id-reference"* and that the bundle-identity / single-provider work was done *"so S-08 is additive."* This is the strongest possible signal: prior slices paid the structural tax already.
- **The data is tiny.** A whole plan's editable board state is **tens — at most low-hundreds — of rows / a few KB of JSON**. A full-state snapshot per undo step is cheap.
- **Re-validation is free.** Collision validation is a pure `useMemo` over placements, so *restoring any state auto-revalidates within the <200 ms budget with zero new wiring* — including cross-cohort.
- **No prior undo code exists** — it is greenfield — and there is **no history/audit table** in the schema. But the seams to hook into are all present.

**Both items that previously blocked planning are now resolved** (author, 2026-06-28):

1. **"REPLACE" is out of scope as a distinct operation.** There is no replace Action today and none is planned — occupied-cell drops *merge*, and that is the only behaviour. Undo therefore covers the merge (via the move/place path), not a separate "replace".
2. **UNGROUP stays ephemeral and is excluded from the undo stack.** It is pure in-session UI state (`useExplodedCells`, no persistence) and does not enter the history.

That leaves only **the scope decision (Open Q #1)** — answered below with a recommendation.

**Finalized undo operation set** (after the two clarifications): palette PLACE (single + grouping), single-course & whole-bundle MOVE (including the lossy merge branch), single-course & whole-bundle REMOVE, LIFT-to-container (park) + PLACE-BACK (unpark) + park-arbitrary-set + discard-card, and bundle DUPLICATE. The A/B week flip is a natural bonus (cheap, snapshot-friendly) but is not named in FR-013. **Excluded:** REPLACE (no op) and UNGROUP (ephemeral UI state).

**Recommended scope: multi-step, session-lifetime history, snapshot-based mechanism, plan-level.** This is the cheapest variant that satisfies FR-013, keeps the change inside `plan-detail/model/` (no migration, no constraint-core change), and matches the design the prior slices anticipated. Durable-across-reload history is a clean fast-follow if the author wants it. Effort signal: **medium**, contained — the PRD's 4–6 week-timeline risk was tied to the *durable + full* variant, which this recommendation avoids.

> **The single most important clarification for the author:** even "session-only" undo must still **persist its board mutations to Supabase**. Supabase is the source of truth and the board re-hydrates from it on load (`load.ts`), so undoing a *persisted* edit requires issuing a new server write to actually reverse it — otherwise a refresh resurrects the undone change. "Session-only" therefore describes the lifetime of the **history stack** (how far back you can step), *not* the durability of the board. The board stays durable and consistent at all times; only the ability to step back across a page reload is session-scoped. (Evidence: optimistic rollback today only reverts *client* state after a *failed* RPC — it never calls the server to reverse a *successful* edit — `use-placements.ts`.)

## Detailed Findings

### Area 1 — The editing-operation layer (the "what gets undone")

Every persisted edit flows through four tiers, which makes the operation set uniform and inspectable:

1. **Astro Action** — registered in `src/actions/index.ts:7-15` (spreads `placementActions`, `shelfActions`, `groupingActions`), each built by `defineDomainAction` (`src/shared/lib/actions/define-domain-action.ts:13-26`): session check → resolve Supabase → run domain fn → translate errors. **Returns the domain fn value verbatim.**
2. **Domain fn** — `src/_pages/plan-detail/api/placements.ts`, `shelf.ts` — thin wrappers, one RPC each.
3. **Atomic RPC** — `supabase/migrations/*` — where INSERT/DELETE/UPDATE actually happen, transactionally and idempotently.
4. **Optimistic client orchestration** — `src/_pages/plan-detail/model/use-placements.ts`.

Two tables hold board state — **`bundles`** (one row per occupied cell) and **`placements`** (one row per placed course-hour, FK `bundle_id`). The holding container is a *separate* representation: **`shelf_bundles`** + **`shelf_bundle_courses`** (not a `bundles.status='holding'` row — that enum value is vestigial).

**Operation inverse-ability map:**

| Operation | Action (file:line) | Domain fn (file:line) | DB effect | Inverse from result alone? |
|---|---|---|---|---|
| Palette PLACE (single) | `placeCourse` `api/placement-actions.ts:14` | `placements.ts:77` | `place_course`: INSERT bundle (find-or-create) + placement; idempotent | **Yes** (additive; result carries minted ids + cell) |
| Palette PLACE (grouping) | `placeCourse`×N `placement-actions.ts:14` | `placements.ts:77` | N× `place_course`; merges onto occupied cell | **Yes-ish** (invert only newly-added members) |
| Single-course / whole-bundle MOVE | `moveBundleMembers` `placement-actions.ts:15` | `placements.ts:96` | `move_bundle_members`: relocate→UPDATE coords; **merge→DELETE twins + DELETE source bundle (lossy)** | Relocate: command suffices. **Merge: needs pre-snapshot** |
| Single-course / whole-bundle REMOVE | `removeBundleMembers` `placement-actions.ts:16` | `placements.ts:118` | `remove_bundle_members`: DELETE placements (+ bundle if emptied) | **Needs pre-snapshot** (returns `void`) |
| REPLACE | **none — confirmed out of scope** | — | No distinct op — occupied-cell drops *merge* | **N/A — not an operation (author-confirmed: none exists or planned)** |
| UNGROUP (opt-out) | **none — client only** | `model/use-exploded-cells.ts:17` | **No DB write** — ephemeral `Set<cellKey>` | **Excluded from undo** (author-confirmed: ephemeral UI state stays out of the stack) |
| LIFT to shelf (park) | `shelveBundle` `api/shelf-actions.ts:14` | `shelf.ts:52` | `shelve_bundle`: INSERT shelf rows (copy) then DELETE placements+bundle | **Partial** (inverse = unshelve to source cell) |
| PLACE-BACK (unpark) | `unshelveBundle` `shelf-actions.ts:15` | `shelf.ts:68` | `unshelve_bundle`: N× `place_course` then DELETE shelf header | **Needs pre-snapshot** (header destroyed) |
| Park arbitrary set | `shelveCourses` `shelf-actions.ts:17` | `shelf.ts:98` | `shelve_courses`: INSERT shelf rows | **Yes** (inverse = `delete_shelf_bundle`) |
| DISCARD parked card | `deleteShelfBundle` `shelf-actions.ts:16` | `shelf.ts:85` | `delete_shelf_bundle`: DELETE shelf (cascade) | **Needs pre-snapshot** (`void`) |
| Bundle DUPLICATE | composite (no dedicated action) | `use-placements.ts:169` → `addGroup` → `placeCourse`×N | N× `place_course` at computed empty target | **Yes** (additive; inverse = remove placed set) |
| A/B week flip *(bonus, not in FR-013)* | `updatePlacementWeek` `placement-actions.ts:17` | `placements.ts:134` | direct `UPDATE placements.week` | **Needs pre-snapshot** (returns new week) |

**Conclusion of Area 1:** A pure *derive-inverse-from-action-result* model is **insufficient** — it breaks on every `void`-returning op (remove, discard) and every lossy merge/park where identity is deliberately destroyed. A **command + captured-cell-snapshot** (or full-state snapshot) model fits the actual shape of the operations. Critically, the merge/park identity loss the migrations flag for "S-08 undo" is solved by *restoring the snapshot of the affected cells* (re-placing mints fresh bundle ids, which the design already treats as acceptable), **not** by trying to literally reverse the SQL.

### Area 2 — Client board state (the "where undo hooks in")

- **No store/context/reducer for board data.** The source of truth is **two `usePlacements` hook instances — one per cohort** — each backed by plain `useState`: `placements: LocalPlacement[]` and `parkedBundles: LocalParkedBundle[]` (`use-placements.ts:117-122`). `bundleId` on `LocalPlacement` is documented as a forward handle "for S-07 park / S-08 undo" (`model/placement/placement.ts:14-18`) — **undo was anticipated at the in-memory schema level.**
- **Orchestrator already exists at plan level.** `useCombinedBoardState(dp1, dp2, focus)` (`model/use-cohort-board-state.ts:40-80`) calls `usePlacements` for *both* cohorts unconditionally, builds the live cross-cohort occupancy index, and returns `{ dp1, dp2 }`. `PlannerBoard` calls it once (`PlannerBoard.tsx:48`). **This is the natural single home for a plan-level undo stack.**
- **A half-built command bus exists — for drops only.** `resolveCombinedDrop` (`model/cross-cohort/drop-router.ts:37-73`) turns a gesture into a typed `CombinedDropAction` (8-kind discriminated union), dispatched by the single pure `applyDropAction` switch (`model/cross-cohort/drop-dispatch.ts:33-79`). **But chip-level mutations bypass it** — `removePlacement`, `setWeek`, `removeBundle`, `duplicateBundle`, `removeParked` are wired straight to `state.actions.*` in `PlannerBoard.tsx:124,146-150`.
- **Optimistic + rollback is per-operation, minimal, and discarded on settle.** Each `persist*` fn captures only the affected slice (the `occupants` rows, a `prevWeek` scalar, a `tempId`) for failure-rollback (`use-placements.ts:303-513`), then discards it. It is **not** a history and **only fires on RPC failure — it never reverses a successful edit.** Low direct reuse for undo, but the pure inverse transitions (`addRollback`, `moveManyRollback`, `removeManyRollback`, `setWeekRollback`, `unparkRollback` in `model/placement/placement-transitions.ts`) are a ready-made vocabulary.
- **Re-validation is fully derived → free on restore.** `useCollisions` is `useMemo(() => deriveCellViolations(placements, …), [...])` (`model/use-board-derivations.ts:30-40`); cross-cohort re-derives in the same render via the live index. There is **no imperative `validate()` call anywhere.** Restoring a snapshot triggers a re-render → the memo recomputes → the grid re-tones. The <200 ms budget is a property of `deriveCellViolations` alone (guarded by `model/collision/collisions.perf.test.ts`), independent of how state mutates.

**Seam verdict:** Partial centralization. For a **snapshot-based** undo this is *excellent* — capture `placements` + `parkedBundles` (immutable arrays → O(1) reference hold) at the orchestrator after each settled mutation; restore re-validates for free. For a **command-log** undo, the chip-level ops must first be routed through `applyDropAction` (mechanical — the verbs already exist as `CohortActions`, `use-cohort-board-state.ts:215-228`). The snapshot approach **avoids that consolidation** because it observes state transitions rather than commands — a strong reason to prefer it.

### Area 3 — Persistence & data model (the "how big / how durable")

- **Editable state = 4 tables**, all `plan_id`-scoped + `cohort` discriminated:
  - `placements` — `id, plan_id, cohort, day, period, course_id, week, bundle_id` (`migrations/20260611180006_*`, `…20260621130000_*`, `…20260624120001_*`).
  - `bundles` — `id, plan_id, cohort, status, day, period` (S-05, `migrations/20260624120000_bundles.sql`); partial unique index pins one placed bundle per cell.
  - `shelf_bundles` / `shelf_bundle_courses` — the parked unit (S-07, `migrations/20260626120000_shelf_bundles.sql`).
  - (`slot_bundles` was the old opt-out marker — **dropped** in `…20260624120007_drop_slot_bundles.sql`, whose comment establishes "ungroup is presentation-only in-session UI state (no persistence)".)
- **Snapshot cost is negligible.** Default grid is 5×10 = 50 cells/cohort (`src/test/factories/create-plan.ts:19`). A fully placed plan is ≤ ~166 placements, ≤ ~100 bundles, a handful of shelf rows — **tens to low-hundreds of rows, a few KB serialized.** Even 50 steps of history is a few hundred KB. **Full-state snapshot per step is viable.**
- **No history/audit/event/log table exists** (grep over all 18 `create table` statements → none). Undo storage is greenfield.
- **Parked state is durable in Supabase, not localStorage** (S-07): `shelf_bundles` tables, written via `shelve_bundle` RPC, re-fetched on load (`load.ts:146-151`). The only localStorage in the shelf is the cosmetic drawer-pin flag, explicitly "the parked SET is server-owned" (`lib/shelf-pinned.ts:5-7`). **Precedent: board *data* is durable in Supabase; presentation state (ungroup, pins) is session/per-device.**
- **localStorage convention:** reserved for cosmetic prefs only, and every access is `try/catch`-guarded on top of the `typeof window` check (project lesson; `lib/shelf-pinned.ts:18-37`, `lib/drag-hint-mode.ts:17-37`). Board data conventionally does **not** go through localStorage.
- **Workerd:** session undo is client-only (no runtime concern); durable undo is just more Action→RPC calls (workerd-safe), but a *synchronous* durable write on every edit adds DB latency to the <200 ms drag hot path and would need to be async/fire-and-forget.

### Area 4 — Historical context (what prior slices decided for us)

The sweep found **zero prior undo code** but **extensive prior groundwork that constrains and enables S-08**:

- **Merge is not cleanly reversible** — `move_bundle_members` deletes the source bundle on merge; the migration header states *"Identity is NOT preserved across a merge (source consumed) — noted for S-08 undo"* (`archive/2026-06-23-first-class-bundle-operations/plan.md:194`; echoed in `archive/2026-06-27-combined-two-cohort-view/research.md:119`). → **undo must be snapshot/command-based, not inverse-op.**
- **Park boundary deliberately drops identity** — *"a fresh `bundles` id is minted on place-back. Safe because S-08 undo will be snapshot/command-based"* (`archive/2026-06-26-bundle-holding-container/plan.md:41`). → confirms the chosen mechanism.
- **Single plan-level op-log home is load-bearing** — S-06 chose one `DragDropProvider` with cohort-scoped IDs specifically so "any future single undo stack" has one home: *"Two providers … fracture the future S-08 op-log"* (`archive/2026-06-27-combined-two-cohort-view/research.md:48,51,113`). Every mutating RPC already carries `cohort` in its args → cheap to route to a centralized log. → **undo should be plan-level, not per-cohort.**
- **Atomic, idempotent RPCs already exist** for every op (`place_course`, `move_bundle_members`, `remove_bundle_members`, `shelve_bundle`, `unshelve_bundle`, `delete_shelf_bundle`, `shelve_courses`) → undo/redo can **replay safely**; no new "inverse RPCs" needed for the clean cases.
- **Temp-id reconciliation was explicitly deferred to S-07/S-08** — *"that machinery only pays off once an optimistic client reader exists"* (`archive/2026-06-23-first-class-bundle-operations/plan.md:247`). → undo/redo that re-runs id-minting ops must remap ids forward from each replay's result, the way `settleMany` does today.
- **The no-flicker invariant** — every whole-cell mutation must land in a single `setPlacements` pass (`…plan.md:72`). → undo restores must obey the same single-pass rule.

## Code References

- `src/actions/index.ts:7-15` — action registry (placement, shelf, grouping).
- `src/shared/lib/actions/define-domain-action.ts:13-26` — the thin Action orchestration wrapper.
- `src/_pages/plan-detail/api/placement-actions.ts:14-17`, `shelf-actions.ts:14-17` — every editing-op entrypoint.
- `src/_pages/plan-detail/api/placements.ts:77,96,118,134`, `shelf.ts:52,68,85,98` — domain fns (one RPC each).
- `src/_pages/plan-detail/model/use-placements.ts:117-122` — per-cohort source-of-truth state; `:303-513` — the optimistic/rollback `persist*` set.
- `src/_pages/plan-detail/model/use-cohort-board-state.ts:40-80,215-228` — plan-level orchestrator + `CohortActions` surface (**the undo-stack home**).
- `src/_pages/plan-detail/model/cross-cohort/drop-router.ts:37-73`, `drop-dispatch.ts:33-79` — the half-built command bus (drops only).
- `src/_pages/plan-detail/model/use-board-derivations.ts:30-40` — derived (free) collision re-validation.
- `src/_pages/plan-detail/model/use-exploded-cells.ts:17` — ungroup as ephemeral UI state (no persistence).
- `src/_pages/plan-detail/model/placement/placement.ts:14-18` — `bundleId` documented as the S-08 undo handle.
- `src/_pages/plan-detail/api/load.ts:146-151` — parked state re-hydrated from Supabase (durability precedent).
- `supabase/migrations/20260624120000_bundles.sql`, `…120005_*` (move, merge-lossy note), `…120006_*` (remove), `20260626120000_shelf_bundles.sql`, `…120001_*`/`…120002_*` (shelve/unshelve) — the operation RPCs + the "noted for S-08 undo" headers.

## Architecture Insights

- **The board is a tiny, immutable, fully-derived client model with a uniform atomic-RPC persistence layer.** That combination is close to ideal for undo: snapshots are cheap (tiny + immutable), restoring re-validates for free (derived), and reversal can reuse the existing atomic/idempotent RPCs (uniform layer).
- **"Snapshot vs command" is a false binary here.** The fitting design is a **command history whose entries carry a captured snapshot of the affected cohort/cells**: the command gives redo (re-invoke the same Action) and the snapshot gives a robust undo for the lossy/`void` cases — sidestepping the deliberate merge/park identity loss. Plan-level, anchored at `useCombinedBoardState`.
- **Undo always persists.** Because Supabase is the source of truth, every undo/redo issues real server writes (reusing the op RPCs to reconcile the affected cells to the target snapshot). "Session-only" bounds only the *history stack's* lifetime, not board durability. This is the headline caveat for the author.
- **Validation budget is a non-issue for undo itself.** It's the same pure derivation. The only budget exposure is a *durable* history that writes on the hot path — avoided by the recommended session-lifetime stack (or async writes if durable is chosen).

## Scope decision (Open Q #1) — assessed and recommended

| Axis | Options | Recommendation | Why |
|---|---|---|---|
| **History depth** | single-step ↔ multi-step | **Multi-step** | Marginal extra cost once a stack exists (array vs single slot); the error-prone lift/park/replace workflow that motivated FR-013 is exactly where stepping back several ops pays off. |
| **Lifetime** | session ↔ durable-across-reload | **Session-lifetime stack** (board mutations still persist) | Avoids a new history table + RLS/grants/clone decision + the <200 ms hot-path write; matches the "snapshot/command-based" design prior slices anticipated and the ungroup session-only precedent. Durable is a clean fast-follow. |
| **Mechanism** | per-op inverse ↔ full-state snapshot | **Command + captured-cell snapshot**, plan-level | Pure inverse breaks on `void` ops + lossy merge/park; full snapshot is cheap (tiny data) and robust; capturing the affected cohort/cells keeps entries small while solving identity loss. Anchored at `useCombinedBoardState` (the op-log home S-06 reserved). |

**Headline recommendation:** *multi-step, session-lifetime, snapshot-backed command history, living at the plan-level orchestrator, replaying the existing atomic RPCs to persist each undo/redo.* This is the cheapest variant that satisfies FR-013, requires **no migration and no constraint-core change**, and lands almost entirely in `plan-detail/model/`.

## Proposed mechanism (session-lifetime, snapshot-backed)

A concrete sketch of the recommended variant, to carry into `/10x-frame` / `/10x-plan`. This is a *proposal*, not a locked design — but it is grounded in the seams found above.

### The core split: two states, two lifetimes

Undo introduces exactly **one new piece of state — the history stack — and it is the only thing that is session-scoped.** The board is unchanged and stays durable.

| | **Board state** (placements, bundles, shelf) | **Undo/redo history** (the stacks) |
|---|---|---|
| Where it lives | Supabase (truth) + mirrored in React (`use-placements.ts`) | **Client memory only**, at the plan-level orchestrator |
| Lifetime | Permanent | **The mounted planner island** — empty again after reload/navigation |
| Re-hydrated on load? | Yes (`load.ts`) | No — there is nothing to re-hydrate; it starts empty |

"Session-lifetime" qualifies **only the right column.** Every undo/redo still writes through to Supabase, so the board is always durable and consistent; what you lose on reload is merely the *ability to step back across it* — the standard desktop-editor contract (file saved, history cleared on reopen).

### Where the history lives

In-memory at `useCombinedBoardState` (`model/use-cohort-board-state.ts:40`) — the orchestrator that already owns both cohorts and is the single "op-log home" S-06 deliberately reserved (`archive/2026-06-27-combined-two-cohort-view/research.md:48,51,113`). A `useRef`/small reducer holds two stacks. **Not** localStorage (reserved for cosmetic prefs) and **not** a DB table (that is the durable variant). Because the client arrays are immutable, an entry is a reference hold of a few KB — no deep copy.

```ts
const undo: HistoryEntry[] = []
const redo: HistoryEntry[] = []

type HistoryEntry = {
  label: string                 // "Remove bundle at Mon · P3" (for UI/tooltip)
  cohort: 'dp1' | 'dp2'
  before: AffectedCells         // snapshot of the touched cells/cards BEFORE the edit
  after:  AffectedCells         // …and AFTER it settled (drives redo)
}
```

### The recording layer and its one invariant

A thin layer wraps the settled-success path of each `persist*` in `use-placements.ts`. On a **user-initiated** edit it pushes `{before, after}` onto `undo` and clears `redo` (a fresh edit invalidates the redo branch).

> **Invariant:** undo/redo-initiated writes must **bypass the recorder** — they do *not* create new history. Otherwise an undo would be recorded as an edit and the stacks would never converge. The recorder distinguishes "user did this" (record) from "undo/redo did this" (don't).

### The undo/redo loop

```
user edit        →  push to UNDO,  clear REDO
undo  (succeeds) →  pop UNDO    →  move entry to REDO
redo  (succeeds) →  pop REDO    →  move entry to UNDO
fresh edit       →  push to UNDO,  clear REDO   ← prior REDO entries discarded
```

**Undo** = take the top `undo` entry → reconcile the **server** to its `before` snapshot by issuing the *existing* atomic RPCs (most ops have a clean single inverse: remove↔`place_course`, move↔`move_bundle_members`, shelve↔`unshelve_bundle`; the lossy **merge** case reconciles both cells from the snapshot rather than reversing SQL) → optimistically set client state to `before` → the derived `useMemo` re-validates collisions for free, cross-cohort included (`model/use-board-derivations.ts:30`). **Redo** is the mirror, reconciling forward to `after`.

**Commit-on-success.** Because the revert is a real DB write it can fail. The stack move commits **only** after the RPC succeeds; on failure the stacks stay untouched and the error surfaces — history never drifts from the database.

**Identity is by business key, not id.** Re-placing mints fresh bundle/placement ids; reconciliation matches on `(courseId, cell, week)` the way `settleMany` does today — the "snapshot/command-based, never id-reference" model the prior slices anticipated (`archive/2026-06-26-bundle-holding-container/plan.md:41`).

### Worked example

> Remove the {Math HL + Physics HL} bundle at Mon·P3, then ⌘Z.

1. **Remove** → `remove_bundle_members` deletes both placements + the bundle in Supabase; client drops them; board re-tones; history entry recorded with `before` = the two placements at Mon·P3.
2. **Undo** → pop the entry → `place_course` ×2 re-inserts Math HL + Physics HL at Mon·P3 (fresh ids) → client re-adds optimistically → collisions recompute → entry moves to `redo`.
3. **Redo** → re-issues the remove, reconciling forward to `after`.
4. **Reload instead of redo** → board correctly shows the bundle removed (durable); both stacks are empty — no stepping back past the reload.

### Upgrade path to durable (fast-follow, additive)

Swap the in-memory stacks for an append-only history table (RLS + `revoke anon` grants per the lessons rule; omitted from `clone_plan`), writing each entry server-side — **async / fire-and-forget** to keep the <200 ms drag budget. No client-side rework: the same two-stack engine is simply backed by a table instead of a `useRef`.

## Risks & open items (carry into `/10x-frame` / `/10x-plan`)

1. ~~REPLACE is unimplemented.~~ **Resolved (author, 2026-06-28):** no replace Action exists or is planned; undo covers the merge, not a separate replace op. Out of scope.
2. ~~UNGROUP placement.~~ **Resolved (author, 2026-06-28):** ungroup stays ephemeral UI state and is **excluded from the undo stack.**
3. **Mutation-centralization gap.** Chip ops bypass the command bus. The snapshot approach avoids needing to fix this; a command-log approach would require routing them through `applyDropAction` first.
4. **Temp-id reconciliation.** Redo of id-minting ops (place/park/duplicate) must remap ids forward from each replay's result (`settleMany` pattern). Duplicate must pin its *resolved* target, not recompute `findDuplicateTarget`.
5. **Two-store atomicity.** Park/place-back mutate both `placements` and `parkedBundles`; undo must restore both in one pass (no-flicker invariant).
6. **Merge/park identity loss** — handled by snapshot restore (reconcile to target state), never by reversing SQL.
7. **Budget exposure only if durable.** Keep history session-lifetime, or make durable writes async, to protect the <200 ms drag budget.

## Effort signal

**Medium, contained.** The recommended variant is mostly client `model/` work in `use-placements.ts` / `use-cohort-board-state.ts` plus a small undo engine that reuses the existing RPCs — **no schema migration, no constraint-core touch, no new validation logic.** The PRD's "may move the 4–6 week estimate" risk attaches to the *durable + full* variant; the recommendation deliberately avoids it. Durable-across-reload history remains a clean, additive fast-follow (one append-only table + RLS/grants, omitted from `clone_plan`).

## Historical Context (from prior changes)

- `context/archive/2026-06-23-first-class-bundle-operations/plan.md:5,24,194,247` — bundle identity shaped "so S-08 is additive"; merge is non-reversible (source deleted); temp-id machinery deferred to S-08.
- `context/archive/2026-06-26-bundle-holding-container/plan.md:41,57,115` — parked state durable in Supabase; place-back mints fresh id; *"S-08 undo will be snapshot/command-based"*.
- `context/archive/2026-06-27-combined-two-cohort-view/research.md:48,51,113,119` — single plan-level op-log home is load-bearing; one `DragDropProvider` chosen for it; merge non-reversibility flagged for undo.
- `context/archive/2026-06-27-plan-detail-refactor/plan.md:49-50,111-120` & `context/archive/2026-06-28-plan-detail-unify-views/plan.md:34` — unified drop router + always-both-cohorts orchestrator (the live cross-index cycle undo must preserve).
- `context/foundation/prd.md:347-354,473-476` & `roadmap.md:173-184,201` — FR-013 scope + the blocking Open Q #1.

## Related Research

- `context/archive/2026-06-27-combined-two-cohort-view/research.md` — the most undo-relevant prior research (op-log home, provider decision).
- `context/archive/2026-06-23-first-class-bundle-operations/research.md` — bundle identity / merge reversibility.

## Open Questions

1. ~~What does "REPLACE" mean?~~ **Resolved (author, 2026-06-28):** no replace op exists or is planned — out of scope.
2. ~~Does UNGROUP belong on the undo stack?~~ **Resolved (author, 2026-06-28):** no — it stays ephemeral UI state, excluded from the stack.
3. **Confirm session-lifetime over durable** for this change, accepting durable as a fast-follow. — Owner: author.
4. **Is undo must-have in *this* change or a fast-follow?** (PRD Open Q #1 still formally open; the recommended scope makes "in this change" affordable.) — Owner: author.
