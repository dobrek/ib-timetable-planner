# Editing Undo / Redo — Plan Brief

> Full plan: `context/changes/editing-undo-redo/plan.md`
> Research: `context/changes/editing-undo-redo/research.md`

## What & Why

Add plan-level **undo / redo** for the board's editing operations (place, move, remove, lift/place-back, park, discard, duplicate, A/B week flip). FR-013 exists because the lift/park workflow is error-prone enough that authors expect to step back. Roadmap slice S-08.

## Starting Point

The board is a small, immutable, fully-derived client model: two `usePlacements` instances (one per cohort) owned by the `useCombinedBoardState` orchestrator — the op-log home S-06 deliberately reserved. Every edit funnels through ~9 `persist*` functions, each backed by an atomic, idempotent RPC. Collision validation is a free `useMemo`. No undo code, no history table, and no keyboard-shortcut infra exist today.

## Desired End State

An author presses ⌘Z / Ctrl+Z (or clicks a toolbar Undo button) to reverse their last edit, ⌘⇧Z / Ctrl+Y to re-apply, across a multi-step history interleaving both cohorts. Buttons disable at an empty stack and tooltip the next step. Every undo/redo writes through to Supabase, so a reload shows the stepped-back board (and clears the stack); collision tones re-derive automatically.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| In/out scope | Place/move/remove/lift/place-back/park/discard/duplicate + week-flip; **not** REPLACE or UNGROUP | REPLACE isn't an op (drops merge); UNGROUP is ephemeral UI state | Research |
| History depth | Multi-step | The error-prone workflow that motivated FR-013 is where stepping back several ops pays off | Research |
| Lifetime | Session-lifetime stack, **behind a durable-ready interface** | Avoids a table/RLS/hot-path write now; durable is an additive fast-follow via the same interface | Plan |
| Mechanism | **Snapshot diff-reconcile** (affected-cells scope, business-key matched) | One operation-agnostic engine handles merge, void-removes, park, and id-minting redo alike | Plan |
| Reconcile primitive | **Remove-then-place** (board) / **delete-then-create** (shelf) | Identity isn't preserved anyway + tiny data → no per-op inverse logic, no move/week special-casing | Plan |
| Snapshot capture | Only `before` at edit time; forward target captured **live at undo time** | Trivial recording; dodges React state-timing pitfalls | Plan |
| Step granularity | One user action = one step | Matches the bundle-as-a-unit model; the orchestrator already settles composites in one pass | Plan |
| Revert failure | Commit-on-success | History and DB can never disagree; reuses the existing error surface | Plan |
| Surface | ⌘Z/⌘⇧Z (+Ctrl variants) **and** PlanSummaryBar buttons | Discoverable *and* fast; buttons communicate stack depth | Plan |

## Scope

**In scope:** the full editing-op undo/redo set above; session stack behind a `HistoryStore` interface; keymap + toolbar buttons; unit + integration + e2e coverage.

**Out of scope:** durable-across-reload history (fast-follow), REPLACE/UNGROUP undo, new RPCs / migrations / constraint-core changes, bulk "clear shelf", per-RPC granularity, cross-device sync.

## Architecture / Approach

A **pure engine** thinks (`model/history/`: `sliceAt` → `diffReconcile` plan → `HistoryStore`), the **existing write path** persists (`use-placements.ts` gains an `onRecord` callback + a non-recording `applyReconcile` executor + a live `snapshot` getter), and the **orchestrator** holds the two stacks (`use-history.ts` wired into `useCombinedBoardState`, commit-on-success). A thin **UX layer** (focus-guarded keymap + chrome buttons) triggers it. The recorder-bypass invariant is structural — undo/redo call `applyReconcile`, never `persist*`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure history engine | `sliceAt` + `diffReconcile` + `HistoryStore` + labels, fully unit-tested | Reconcile correctness across every op shape (where the risk lives) |
| 2. Write-path integration | `onRecord` on every settled edit + non-recording `applyReconcile` + `snapshot` | State-timing (ref lag); two-store atomicity on restore |
| 3. Orchestration | Plan-level stacks, commit-on-success undo/redo, cross-cohort | The orchestrator ordering cycle (mirror the existing cross-index pattern) |
| 4. UX surface | ⌘Z/⌘⇧Z keymap + PlanSummaryBar buttons | Input-focus guarding; the durability contract (verified by e2e) |

**Prerequisites:** S-05 (first-class bundles) + S-07 (holding container) — both archived/done. No new infra.
**Estimated effort:** Medium, ~3–4 sessions across 4 phases. No migration; almost entirely `plan-detail/model/`.

## Open Risks & Assumptions

- Reconcile correctness concentrates in Phase 1's `diffReconcile` — heavy unit coverage is the mitigation.
- Existing RPC integration coverage is assumed to hold; the new integration suite round-trips every op against real Supabase anyway (heavier-integration decision).
- Switching `?focus=` via URL nav remounts the island and clears the session stack — consistent with session-lifetime, accepted.
- Undoing an edit in a hidden cohort (focus mode) persists to the DB but isn't visible until that cohort is shown — accepted edge.

## Success Criteria (Summary)

- ⌘Z/⌘⇧Z and toolbar buttons reverse/re-apply any editing op, multi-step, across both cohorts, with correct disabled-state and tooltips.
- An undone edit persists across a page reload (durable board), and the stack is empty afterward (session lifetime).
- Collision tones re-derive automatically after undo/redo, cross-cohort included; `pnpm test` / `test:integration` / `test:e2e` / `check` / `steiger` / `build` all pass.
