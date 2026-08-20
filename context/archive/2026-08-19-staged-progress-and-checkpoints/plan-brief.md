# Staged Progress + Durable Checkpoints (S-303) — Plan Brief

> Full plan: `context/changes/staged-progress-and-checkpoints/plan.md`
> Research: `context/changes/staged-progress-and-checkpoints/research.md`

## What & Why

A CP-SAT generation job runs 12–20 minutes on a server and today the author is blind after dispatch:
the row is written twice (claim, finish) and the only way to see anything is a page visit or the
strip's Refresh. S-303 makes the job **observable and checkpointed**: the solver writes one durable
progress row per ladder stage (stage now running, transcript, incumbent board), stages can stop at a
configured target instead of always burning their budget, and the plans list shows a live
"Generating — stage N of 10 · <name>" indicator. That is what makes long jobs stoppable (S-305) and
SIGTERM-safe (S-304) later.

## Starting Point

F-301 forward-designed every column this needs (`stage_index`, `stage_name`, `stages`, `checkpoint`,
`checkpoint_stage_index`, `heartbeat_at`) and granted them; nothing writes five of them. The engine
is solve-to-budget with no target and no hook; `registry.attach_solver()` is built and never called.
The wire contract's `stopReason` is `budget | cancelled`. The app has no polling anywhere, and
S-301 recorded the React 19 wall (`set-state-in-effect`) that rules out a naive fetch-in-effect.
Change.md already decided: FR-308 is satisfied by the existing static strip; live progress goes to
the plans list (retiring the FR-312 render-contention risk structurally).

## Desired End State

During a run, `/plans` shows "Generating — stage 4 of 10 · teacher holes, started 14:02" advancing
without a reload, and "Finished — open plan" at the end; polling runs only while something is
active and pauses when the tab is hidden. The plan-detail strip keeps its advisory and gains a
"Watch progress in Plans" link. `SOLVER_STAGE_TARGETS=3=95,6=900` makes those tiers stop early with
`stoppedBy: "target"`; unset, behaviour is unchanged. The contract is widened bump-free; the solver
role can read `heartbeat_at`/`stop_requested_at`; roadmap/PRD say "board + per-stage bounds", not
"objective tuple".

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Clause 5 "objective tuple" | Rename the promise: board + per-stage best/bound | The solver never holds a true 10-tuple mid-ladder; bounds are free, honest, and in-contract already. | Plan |
| Where targets live / prod values | `SolveConfig.targets` + `SOLVER_STAGE_TARGETS` env, **empty by default** | Machinery ships tested, parity gate untouched by construction, no M-series numbers promoted; S-308 sets values. | Plan |
| `stopReason` | Widen to `budget/target/cancelled/interrupted`; per-stage `stoppedBy: budget/target/cancelled` | One bilateral, bump-free edit serves S-303, S-304 and S-305; a mixed ladder needs the per-stage field. | Plan |
| Checkpoint shape | Full `GenerationResult` via `wire_result`, single slot, one PATCH per stage event | S-305's Stop & keep becomes "copy checkpoint into result"; F-301 already rejected row-per-stage. | Research |
| Progress surface | Plans list indicator (`PlanRow.indicators[]`, one occupant); strip static + link | FR-308 already satisfied; no board on `/plans` so FR-312 is unreachable; one extra query total. | Research (change.md) |
| Polling idiom | `useSyncExternalStore` store, 5 s, active-only, visibility-aware, terminal memory | Only Compiler-safe shape past the React 19 wall; idle hub has no timer; author sees "Finished" not a vanished badge. | Research / Plan |
| Grants | Pre-pay `select (heartbeat_at, stop_requested_at)` in one migration; policy renamed | One migration + one test edit instead of two; S-303 renews `heartbeat_at` anyway. | Plan |
| Stop seam | `SolveHooks.should_stop` predicate + `attach_solver`; no stop source | S-305 adds a source without re-entering `_run_ladder`; `stop_search()` measured 0.00 s. | Plan |
| Emission seam | Callbacks handed down via `SolveConfig`; engine imports nothing from the service | The one-way `cpsat_engine ← cpsat_service` dependency is load-bearing. | Research |
| Phase order | Contract → engine → service → migration → app → truth-up | Gate before code (F-302 precedent); UI reads rows the service really writes. | Plan |

## Scope

**In scope:** contract widening (both sides, both suites); engine targets + hooks + `stoppedBy`;
service `progress()` PATCH per stage event, `SOLVER_STAGE_TARGETS`, `attach_solver`; one grant
migration; plans-list indicator + poll store + status action; strip link; roadmap/PRD/docstring truth-up.

**Out of scope:** Stop & keep (S-305); SIGTERM/heartbeat thread/claim-CAS widening (S-304); live
polling on plan detail; production target values or container forwarding of the knob (S-308); true
objective tuple; push transport; `formatVersion` bump; derived or "proposal" indicators (S-306);
e2e for `/plans`; delivery from the poll.

## Architecture / Approach

```
engine  _run_ladder ──StageEvent(started|completed, checkpoint?)──▶ SolveHooks.on_stage
        CpSolverSolutionCallback: objective<=target | should_stop() → stop_search()
service runner builds hooks → JobRowClient.progress() PATCH running→running (best-effort, +heartbeat_at)
db      generation_jobs.{stage_index,stage_name,stages,checkpoint,checkpoint_stage_index,heartbeat_at}
app     loader (+1 query) → PlanRow.indicators ──SSR──▶ PlansHub → useSyncExternalStore store
        ⟳ 5 s readGenerationJobStatuses({jobIds}) (status-only; never checkGeneration)
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Contract widening | `stopReason` + `stoppedBy`, TS validator + tier labels, both suites green, goldens untouched | Byte gate: `stoppedBy` must be omitted when `None` |
| 2. Engine | `targets`, `SolveHooks`, solution callback, stage events, `stopReason` derivation | CP-SAT idiom confabulation — gated by tests, parity 10/10 |
| 3. Service | `progress()` PATCH, `SOLVER_STAGE_TARGETS`, `attach_solver`, docs | Hook I/O must stay off the solver thread; best-effort discipline |
| 4. Migration | 5-column SELECT grant, renamed policy, test pins | Policy-name pin in the credential test |
| 5. App | indicator model, loader query, status action, poll store, Activity cell, strip link | `useSyncExternalStore` snapshot identity; lint wall |
| 6. Truth-up | roadmap/PRD/docstrings, "disappoints" trigger, hand-offs | Stale prose slipping through — grep-gated |

**Prerequisites:** S-301 shipped (yes); local Supabase + `mise run solver:dev` for the integration/manual steps.
**Estimated effort:** ~5–6 sessions across 6 phases (at the S-301/S-302 envelope).

## Open Risks & Assumptions

- Target stop semantics verified on seed fixtures only; the container's 4-worker timing is S-308's to measure.
- `heartbeat_at` renews only per stage event (Mode A can run 300 s between renewals) — S-304 owns finer resolution; stated in roadmap.
- `LADDER_TIER_COUNT = 10` assumes the app dispatches `solve_complete` only (true today); S-307 moves the denominator to the row if that changes.
- `should_stop` is evaluated only on solution callbacks; S-305's immediate stop uses the registry's solver handle.
- The plan-review precedent: S-301's engine design drew 3 CRITICAL findings — run `/10x-plan-review` with symbol-level checks before implementing Phase 2.

## Success Criteria (Summary)

- An author watching `/plans` sees stage-by-stage progress for a running job and a terminal state when it ends, without reloading; editing on the board is untouched.
- Every completed stage leaves a durable checkpoint row the next slices can stop on or recover from; `SOLVER_STAGE_TARGETS` stops stages early when set and changes nothing when unset.
- `/verify`, the solver gates, and both contract suites are green with goldens byte-identical; roadmap/PRD no longer promise an objective tuple.
