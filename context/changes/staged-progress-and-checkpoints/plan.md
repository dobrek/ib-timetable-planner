# Staged Progress + Durable Checkpoints (S-303) Implementation Plan

## Overview

S-303 makes a CP-SAT generation job **observable and checkpointed**. The solver gains solve-to-target
(budget ceilings stay the backstop) and writes one durable progress row per ladder stage — the stage
being worked, the completed-stage transcript, and the incumbent board — into the `generation_jobs`
columns F-301 forward-designed for exactly this. The app gains its first polling loop: the **plans
list** shows a live "Generating — stage N of 10 · <name>" indicator per plan, polled every 5 s from
a status-only read, and flips to a terminal "Finished — open plan" when the job ends. The plan-detail
strip stays the static FR-308 advisory it already is, plus a "Watch progress in Plans" link.

Along the way the wire contract is widened bump-free and bilaterally (`stopReason` gains `target` +
`interrupted`; `StageReport` gains optional `stoppedBy`), one migration pre-pays the SELECT grants
S-304/S-305 need, and the roadmap/PRD sentence "incumbent board **+ objective tuple**" — which the
solver cannot produce during the ladder — is trued up to "board + per-stage bounds".

Change ID: `staged-progress-and-checkpoints` · roadmap S-303 · PRD FR-303, FR-304, FR-308, FR-312.

## Current State Analysis

Lifted from `research.md` (2026-08-19), verified at `main@2dcce22` during planning:

- **Persistence needs zero DDL for what S-303 writes.** `stage_index`, `stage_name`, `stages`,
  `checkpoint`, `checkpoint_stage_index`, `heartbeat_at` exist
  (`supabase/migrations/20260810200122_generation_jobs.sql:83-91`), are inside the solver role's
  11-column UPDATE grant (`20260810200931_solver_job_writer_role.sql:62-74`), and the RLS UPDATE
  window already permits `running → running` (`:96-99`). Today nothing writes five of them;
  `heartbeat_at` is set once at claim (`services/solver/src/cpsat_service/supabase.py:141-167`).
- **The engine is solve-to-budget.** The only stop rule is `max_time_in_seconds`
  (`services/solver/src/cpsat_engine/solve.py:517-534`); 7 of 10 stages burn their full budget on
  the seed fixture. `SolveConfig` (`solve.py:31-46`) has no target and no hook. The ladder is
  `_run_ladder` (`solve.py:362-403`); Mode A's completeness stage is emitted separately in
  `solve_complete` (`solve.py:199-234`). `StageReport` lives in `solve.py:49-56` (not `schema.py`).
  `stopReason` is hard-coded to `"budget"` off `proven_optimal` at `solve.py:348-349`.
- **Target-stopping was verified live**: `CpSolverSolutionCallback` + `stop_search()` returned a
  usable FEASIBLE board in 8.29 s of a 30 s budget; the probe passed `mypy --strict`.
- **The service writes the row exactly twice** (claim, finish). `JobRowClient` is *"exactly three
  operations"* by design (`supabase.py:1`). `registry.attach_solver()` is built and never called
  (`registry.py:81-86`). `_solve_and_write` (`runner.py:175-199`) is where a callback would be built.
  `test_service.py:348-370` destructures **exactly two** PATCHes (`claim, finish = fake.patches()`).
- **The contract** (`contracts/generation-wire.schema.json`): `stopReason` enum is
  `["budget","cancelled"]` (`:163-167`); `$defs/StageReport` (`:189-216`) is
  `additionalProperties:false` with `tier/name/status/best?/bound?/wallClockS`. No golden fixture
  contains a `StageReport`; only `generation-result.json` carries `stopReason` (`"budget"`). Both
  changes are additive-optional → **no `formatVersion` bump**, no golden regeneration
  (`contracts/README.md:129-141`). TS `stopReason` union is at
  `src/entities/timetable/model/generation/types.ts:100`; the TS `StoredStageReport` is an
  ungated hand-written type at `src/entities/timetable/model/generation/clean-label.ts:31-38`.
  There is no human-readable tier-label map anywhere in `src/`.
- **The app has no polling of any kind** (no `setInterval`, no Realtime, no SWR). The React 19 wall
  S-301 hit (`react-hooks/set-state-in-effect` + `exhaustive-deps`, `eslint.config.mjs:60-67`) is
  live; the repo's Compiler-safe idiom is `useSyncExternalStore` over an external store — precedent
  `src/_pages/plan-detail/lib/board-zoom.ts`. `checkGeneration` is **not** a passive read: it
  delivers (`src/_pages/plan-detail/api/generation-delivery.ts:86-97`). The plans list
  (`src/_pages/plans-list/api/loader.ts:8-15`, `ui/PlansHub.tsx:96-146`) has zero job awareness;
  `PlansHub` is the only island on `/plans` and there is no board on that page.
- **The solver role's SELECT grant** is pinned to exactly `id, snapshot_hash, status`
  (`src/test/solver-credential.integration.test.ts:199-211`) and the SELECT policy *name* embeds
  "three columns" and is pinned by `pg_policies` equality (`:152-171`).
- **Decided upstream (change.md, 2026-08-19):** FR-308 is satisfied by the existing static strip;
  the polled progress lands on the plans list as one entry of `PlanRow.indicators`; no PRD
  amendment for FR-308. FR-312's orange risk is thereby retired structurally.

## Desired End State

After this plan:

1. `POST /jobs/{id}/solve` on a configured service produces, per stage, a `running → running`
   PATCH: `{stage_index, stage_name, heartbeat_at}` when a stage starts and
   `{stages, checkpoint?, checkpoint_stage_index?, heartbeat_at}` when it completes; the terminal
   write is unchanged. `SOLVER_STAGE_TARGETS=3=95,6=900` makes tiers 3 and 6 stop early with
   `stoppedBy:"target"`; unset, behaviour is byte-for-byte today's.
2. `/plans` shows an **Activity** column; a plan with an active job displays
   "Generating — stage 4 of 10 · teacher holes, started 14:02" that advances without a reload, and
   "Finished — open plan" once the job ends; polling runs only while something is active and pauses
   when the tab is hidden.
3. The plan-detail strip is unchanged except a "Watch progress in Plans" link and its docstring.
4. `contracts/` widened bilaterally; goldens byte-identical; both parity suites green.
5. `solver_job_writer` holds SELECT on `heartbeat_at, id, snapshot_hash, status, stop_requested_at`.
6. Roadmap S-303/S-304/S-305 text, PRD FR-303, `contracts/README.md`, both READMEs and every
   "nothing here loops / unused in F-302 / S-303 upgrades it in place" docstring are trued up.

Verify: `/verify` green; `cd services/solver && uv run pytest && uv run mypy && uv run ruff check`
green; `pnpm test:integration` (with solver up) green; the manual walkthrough in Phase 5.

### Key Discoveries:

- Config-gating keeps the CP-SAT parity gate honest by construction: `parity()` / `evaluate_board()`
  take no `SolveConfig` (`solve.py:114-149`), so targets and hooks on `SolveConfig` are invisible to
  the 10/10 gate (`tests/test_objective.py:44-48`). Never put targets in `build_objective`/`build_model`.
- `to_generation_result` reads `board`, `stages`, `proven_optimal`, `elapsed_s` and **never `notes`**
  (`solve.py:219`, `:314-356`) — so a mid-ladder `SolveResult` carrying the incumbent produces a
  valid `GenerationResult` through the **same** `wire_result(to_generation_result(...))` path the
  terminal write uses (`runner.py:189-193`). The checkpoint is a full `GenerationResult` (research D1).
- A CP-SAT solution callback runs on the solver's thread while search is live — it must only *decide*
  (target/predicate) and never do I/O; the durable write happens between stages on the worker thread.
- `wire_stage_report` is an explicit key projection wrapped in `_dict_without_nones`
  (`cpsat_engine/wire.py:134-150,189`); `wire_result` is spread-based and carries unknown fields.
  `test_contract.py:257-269` asserts an **exact dict** for a StageReport → `stoppedBy` must be omitted
  when `None`.
- A table-level SELECT revoke must precede column grants (`20260812141459_…:71-72`); an additive
  `grant select (cols)` is cumulative and needs no revoke — but the policy name must change.
- `PlanRow`'s docstring records the explicit deferral of derived quality metrics; the generation
  indicator is the one *non-derived* indicator (reads an indexed row) — build the slot, ship one.

## What We're NOT Doing

- **No Stop & keep** (S-305): no `stop_requested_at` polling, no stop button. S-303 wires the
  *seam* only (`SolveHooks.should_stop` + `registry.attach_solver`).
- **No SIGTERM handling, no heartbeat timer thread, no widened claim CAS** (S-304). `heartbeat_at` is
  renewed only on stage events; the SELECT grant it needs is pre-paid here.
- **No live polling on plan detail.** The strip gets an anchor; `useGenerationJob` and
  `useCombinedBoardState` are untouched (FR-312 structural guarantee).
- **No production target values, no container forwarding of `SOLVER_STAGE_TARGETS`.**
  `src/solver-container-env.ts` keeps its six keys; shipping values (and the 7th key + `.dev.vars`
  dance) is S-308's, per the PRD's tuning discipline. Targets are set via env for the native tiers
  and the hosted-solve campaign only.
- **No true objective tuple per checkpoint** — clause 5 resolved as "board + per-stage bounds".
- **No push (Realtime/WebSocket)** — recorded upgrade; S-303 records the "disappoints" trigger.
- **No `formatVersion` bump, no golden regeneration.**
- **No per-stage checkpoint history** (single slot, last-write-wins — F-301 decided).
- **No derived plan indicators** (valid/complete/used slots) and no "proposal" lineage indicator
  (S-306) — the `PlanIndicator` union is shaped to accept them.
- **No e2e spec for `/plans`** — no spec covers the hub today and Generate E2E is S-306's (README
  "Known gaps"); the indicator is covered in the jsdom lane + integration lane.
- **No delivery from the poll.** The poll never calls `checkGeneration`; delivery stays on visit.

## Implementation Approach

Six phases, gate-first: the contract widening lands before any producer can emit the new values
(F-302's "gate goes in before the code"); the engine lands and is tested before the service writes;
the service emission lands before the UI reads real rows; the migration is independent and sits
between; the app phase is last so it renders rows the service actually writes; truth-up closes.

Two design disciplines run through every phase: (1) everything the UI shows is a **column** (the row
is the only status channel), and (2) the engine's one-way dependency holds — the service hands
callbacks *down* through `SolveConfig`; the engine never imports a client.

## Critical Implementation Details

- **Timing & lifecycle (engine).** The solution callback (`CpSolverSolutionCallback`) fires on the
  solver's own thread while search is live: it may compare `objective_value` to the target, evaluate
  the `should_stop` predicate, and call `stop_search()` — nothing else. All `on_stage` hook calls
  (and therefore all HTTP) happen on the worker thread between `_run_solver` calls. Note CP-SAT only
  invokes the callback on an improving solution, so `should_stop` is checked at solution events only;
  S-305's immediate stop path is the registry's live solver handle (`on_solver` → `attach_solver`),
  not the predicate.
- **State sequencing (stage events).** Per stage emit `started` *before* `_run_solver` and
  `completed` *after* the report is built and hardening applied. `stage_index`/`stage_name` mean
  "the tier now running" and are written on `started`; `stages`/`checkpoint`/`checkpoint_stage_index`
  are written on `completed`, and `checkpoint` is written **only when the stage solved**
  (OPTIMAL/FEASIBLE) — an UNKNOWN stage advances `stages` and `heartbeat_at` but leaves the
  checkpoint columns alone (an under-budgeted stage contributes nothing; the row must not claim it
  did). `stage_index`/`checkpoint_stage_index` are **tier numbers** (1-based, same identity as
  `StageReport.tier`), never array positions.
- **Write discipline (service).** The progress PATCH filters `id=eq.<id>&status=eq.running` and asks
  `select=id` + `Prefer: return=representation` (a matched-nothing is logged as a warning, never
  raised — the row left `running` by S-304/S-305 later must not be overwritten); it is best-effort:
  any `SupabaseError`/`httpx.TransportError` is logged and the solve continues; no retry. It never
  sends a column it has nothing to say about (no blanking).
- **Contract byte rules.** Never put a `StageReport` (it carries the float `wallClockS`) in a
  hashed/byte-compared payload; the checkpoint board goes through `wire_result`; `stages` stays
  chronological (never sorted). `stoppedBy` is omitted when `None` or `test_contract.py:262` breaks.
- **Poll store identity.** `getSnapshot` must return the *same* object until data changes (compare
  `jobId/status/stageIndex/stageName` per plan), or `useSyncExternalStore` loops. The server snapshot
  equals the SSR'd `indicators` so hydration is deterministic. No `setState` in effects anywhere —
  the React Compiler must not be asked to skip the hook.
- **Narrow projections.** Every poll/loader read of `generation_jobs` projects explicitly
  (`id, plan_id, status, stage_index, stage_name, created_at`) — never `stages`, never `select()`
  bare (`generation_jobs.sql:20-25`).

---

## Phase 1: Contract widening (bilateral, bump-free)

### Overview

Widen the frozen wire so the engine may record a target stop and the UI may read it: `stopReason`
gains `target` + `interrupted`; `$defs/StageReport` gains optional `stoppedBy`. Both projections
(TS, Python) and both gating suites move in the same commit; goldens stay byte-identical. Also add
the TS-side `StageReport` validator and tier-label map the UI needs.

### Changes Required:

#### 1. JSON Schema

**File**: `contracts/generation-wire.schema.json`

**Intent**: Declare the two additive-optional changes; reword the `stopReason` description (it
currently states only what is absent).

**Contract**: `GenerationDiagnostics.stopReason.enum` → `["budget","target","cancelled","interrupted"]`
with a description naming each (`budget` — a ceiling ended at least one non-optimal stage; `target`
— every non-optimal stage stopped at its target; `cancelled` — a stop predicate ended a stage
(S-305); `interrupted` — the job did not finish (S-304); `stagnation` stays absent). `$defs/StageReport.properties.stoppedBy`
= `{"type":"string","enum":["budget","target","cancelled"]}`, optional, described as "why this stage
ended when it did not prove optimality; omitted on OPTIMAL". `required` unchanged.

#### 2. Contract README

**File**: `contracts/README.md`

**Intent**: Decision 2 (`:45-49`) restates the widened enum and the result-level derivation rule;
Decision 3's omit-when-absent list (`:50-53`) gains `stoppedBy`; the StageReport bullet (`:31-34`)
notes `stoppedBy`; a one-line note that this widening was additive (no bump) and when.

**Contract**: prose only.

#### 3. TS projections

**File**: `src/entities/timetable/model/generation/types.ts`

**Intent**: Widen the `stopReason` union at `:100` to include `"target"` and `"interrupted"`; update
the doc block that says "the contract allows `budget | cancelled` only".

**File**: `src/entities/timetable/model/generation/stage-report.ts` (new) + `stage-report.test.ts`

**Intent**: Move `StoredStageReport` out of `clean-label.ts` into its own concept file, add
`stoppedBy?: "budget" | "target" | "cancelled"`, and add a Zod schema (`storedStageReportSchema`,
`storedStagesSchema`) plus `parseStoredStages(value: unknown): StoredStageReport[]` (invalid → `[]`,
never throws — the board is still deliverable when its transcript is malformed, mirroring
`clean-label`'s `unavailable` posture). `clean-label.ts` imports the type from here; `generation-delivery.ts`
keeps importing `StoredStageReport` via the entity barrel (update the import path).

**Contract**: exported type + schema + parser; barrel `src/entities/timetable/index.ts` re-exports.

**File**: `src/entities/timetable/model/generation/tier-labels.ts` (new) + test

**Intent**: The human-readable label map for ladder stage names the indicator will render — e.g.
`completeness → "completeness"`, `holes → "holes"`, `totalSlots → "total slots"`, `teacherHoles →
"teacher holes"`, `softHits → "soft hits"`, `studentHoles → "student holes"`, `doublesDeficit →
"doubles"`, `lateStarts → "late starts"`, `fridayTail → "Friday tail"`, `goldenBandDistance →
"golden band"`, `unplacedTotal → "unplaced"`. Unknown names fall back to the raw name.

**Contract**: `tierLabel(name: string): string` and `LADDER_TIER_COUNT = 10` (the `solve_complete`
ladder length — the only mode the app dispatches; noted as such in the docstring so S-307 moves the
denominator to the row if it ever dispatches repair).

#### 4. Python projections

**File**: `services/solver/src/cpsat_engine/solve.py` (StageReport only — the ladder changes are Phase 2)

**Intent**: `StageReport` gains `stopped_by: Literal["budget","target","cancelled"] | None = None`
(defaulted so the construction sites at `:182`, `:211`, `:390` stay valid).

**File**: `services/solver/src/cpsat_engine/wire.py`

**Intent**: `wire_stage_report` projects `stoppedBy` (omitted when `None` via the existing
`_dict_without_nones`).

**File**: `services/solver/tests/test_contract.py`

**Intent**: Extend the StageReport tests — a report with `stopped_by="target"` serialises with
`stoppedBy` and validates against `$defs/StageReport`; `None` stays omitted (exact-dict test
unchanged); a `GenerationResult` with `stopReason: "target"` validates.

#### 5. TS contract gate

**File**: `bench/contract-parity.test.ts`

**Intent**: Add a `$defs/StageReport` validator (ajv, same `Ajv2020` instance) and assert (a) a
`StoredStageReport` sample with `stoppedBy` validates, (b) the Zod schema and ajv agree on a small
accept/reject matrix (missing `wallClockS`, unknown key, bad `stoppedBy`), (c) all three goldens are
still byte-identical (existing assertions — this is the proof that no regeneration was needed).

### Success Criteria:

#### Automated Verification:

- `cd services/solver && uv run pytest tests/test_contract.py` green (new cases included)
- `cd services/solver && uv run mypy && uv run ruff check` green
- `pnpm test bench/contract-parity.test.ts src/entities/timetable` green; goldens unchanged (`git diff --quiet contracts/fixtures`)
- `pnpm check` 0 errors; `pnpm lint` and `pnpm steiger` green

#### Manual Verification:

- Read the diff of `contracts/generation-wire.schema.json`: only the two additive changes + descriptions; `required` lists untouched; `formatVersion` untouched

---

## Phase 2: Engine — solve-to-target + stage hooks seam

### Overview

Add `targets` and a `SolveHooks` bundle to `SolveConfig`, a solution callback that stops a stage on
target (or on the `should_stop` predicate), per-stage `stopped_by`, stage start/complete events
that carry a checkpointable partial result, and the result-level `stopReason` derivation. All of it
is config-gated: empty targets + no hooks = today's behaviour exactly; `parity()`/`evaluate_board()`
cannot see any of it.

### Changes Required:

#### 1. Configuration and hooks

**File**: `services/solver/src/cpsat_engine/solve.py`

**Intent**: Extend `SolveConfig` with `targets: Mapping[int, int]` (tier number → objective value at
or below which the stage stops; `field(default_factory=dict)`; ignored for tiers not run through
the ladder) and `hooks: SolveHooks` (frozen dataclass, all fields optional callables defaulting to
`None`): `on_stage(event: StageEvent) -> None`, `on_solver(solver: cp_model.CpSolver) -> None`,
`should_stop() -> bool`. Define `StageEvent` as a frozen dataclass: `kind: Literal["started","completed"]`,
`tier: int`, `name: str`, `position: int`, `total: int`, `report: StageReport | None` (completed
only), `checkpoint: SolveResult | None` (completed-and-solved only — a `SolveResult` whose `board` is
the current incumbent, `stages` the transcript so far, `proven_optimal=False`, `mode` as the run's).
Docstrings must say why the placement is load-bearing (the same parity-insulation sentence `clean_mode`
carries at `:41-46`).

**Contract**: `SolveConfig(targets=..., hooks=SolveHooks(on_stage=..., on_solver=..., should_stop=...))`;
`StageEvent` is the one type the service consumes. Hook exceptions are **not** caught by the engine
(the service makes its own hook best-effort); document that.

#### 2. The solution callback

**File**: `services/solver/src/cpsat_engine/solve.py`

**Intent**: A `_StageStop(cp_model.CpSolverSolutionCallback)` subclass holding `target: int | None`
and `should_stop: Callable[[], bool] | None`, recording `fired: Literal["target","cancelled"] | None`;
`on_solution_callback` stops the search when `objective_value <= target` (fired=`target`) or when
`should_stop()` is true (fired=`cancelled`). `_run_solver` gains the callback as an optional argument
(`solver.solve(model, callback)` only when a target or predicate exists — keep today's
`solver.solve(model)` path otherwise), and calls `config.hooks.on_solver(solver)` before solving.

**Contract**: the `stopped_by` rule per stage: `fired` if the callback fired; else `"budget"` when
the status is FEASIBLE (a ceiling ended it); else `None` (OPTIMAL — or UNKNOWN/INFEASIBLE, which
have no solution to attribute). Verified-live snippet shape (research §2): subclass
`CpSolverSolutionCallback`, call `super().__init__()`, use `self.objective_value` and
`self.stop_search()` — both typed in ortools' stubs; mypy `--strict` passed on the probe.

#### 3. The ladder and Mode A emission

**File**: `services/solver/src/cpsat_engine/solve.py`

**Intent**: `_run_ladder` emits `started` before each `_run_solver` and `completed` after hardening,
passing `targets.get(tier_number)` into the callback; `solve_complete` emits `started`/`completed`
around the completeness stage (tier 1, position 1) so the UI sees stage 1 during Mode A's up-to-300 s;
`solve_staged`'s `_place_maximally` does the same for symmetry (CLI-only path, cheap). `position`/`total`
come from the ladder's tier list length plus one for the tier-1 stage. `to_generation_result` derives
`stopReason` from the stages: `cancelled` if any stage `stopped_by == "cancelled"`; else `budget` if
any non-OPTIMAL stage has `stopped_by == "budget"` or no `stopped_by` (UNKNOWN counts as budget — the
ceiling ended it); else `target`; none when `proven_optimal`.

**Contract**: `_run_ladder` signature unchanged (config carries everything); `SolveResult` unchanged.

#### 4. Tests

**File**: `services/solver/tests/test_solve.py` (+ `tests/test_stage_stop.py` if it reads better)

**Intent**: On the micro/seed fixtures: (a) a reachable target on a slow tier stops FEASIBLE with
`stopped_by == "target"` and `wall_clock_s` well under the budget, and the final board still obeys
every hardened stage (reuse the `test_full_ladder_is_monotonic_and_complete` assertions); (b) an
unreachable target changes nothing (`stopped_by == "budget"`, same board as no-target at equal
seed/budget); (c) empty targets + no hooks → identical `stages` to a run without the fields (the
neutrality proof); (d) `on_stage` receives `started`/`completed` pairs in tier order with
monotonically growing `checkpoint.stages`, `checkpoint is None` exactly when the stage did not
solve, `position/total` consistent; (e) `on_solver` is called once per stage with a `CpSolver`;
(f) a `should_stop` that returns true after the first solution yields `stopped_by == "cancelled"` and
`stopReason == "cancelled"`; (g) `to_generation_result` derivation matrix (budget/target/cancelled/none).
`test_objective.py` parity stays exact 10/10 — run it, and run the `skipif`-gated golden-dump parity
locally (a green CI does not prove it).

### Success Criteria:

#### Automated Verification:

- `cd services/solver && uv run pytest` green, including `test_objective.py` parity exact 10/10 and the new stage-stop/hook tests
- Local run of the golden-dump parity test (`uv run pytest tests/test_objective.py -k parity` with the gitignored dump present) green
- `cd services/solver && uv run mypy` 0 errors (`--strict` over src + tests); `uv run ruff check` clean

#### Manual Verification:

- `uv run python -m cpsat_engine.cli …` (or the existing bench entry) on the seed fixture with a target on tier 6 shows the stage ending early with `stoppedBy: target` and the next stage warm-started from it; without targets the stage timings match a pre-change run within noise

---

## Phase 3: Service — progress emission, targets knob, stop seam

### Overview

The service turns `StageEvent`s into durable `running → running` PATCHes, reads targets from a new
env knob, hands the live solver to the registry, and documents the knob in the launchers and READMEs.

### Changes Required:

#### 1. Settings

**File**: `services/solver/src/cpsat_service/settings.py`

**Intent**: Add `stage_targets: Mapping[int, int]` parsed from `SOLVER_STAGE_TARGETS`
(format `tier=value[,tier=value…]`, e.g. `3=95,6=900`; default empty). Per the module's rule,
malformed entries **degrade** (dropped with a stderr complaint) rather than raise; tiers outside
2–10 are dropped the same way. Included in the startup "effective settings" log line as
`stage_targets={…}` (`app.py`'s startup log — find the existing line).

**Contract**: `Settings.stage_targets`; `load_settings()` parses it; tests for the parser (valid,
malformed entry, out-of-range tier, empty).

#### 2. The fourth row operation

**File**: `services/solver/src/cpsat_service/supabase.py`

**Intent**: `JobRowClient.progress(job_id, payload)` — one PATCH carrying only the given columns
(a subset of `stage_index, stage_name, stages, checkpoint, checkpoint_stage_index`) plus
`heartbeat_at=_utc_now()`, filtered `id=eq.&status=eq.running`, `select=id`,
`Prefer: return=representation`. Best-effort: a matched-nothing or any `SupabaseError` /
`httpx.TransportError` is logged at WARNING and swallowed; no retry. Update the module docstring
("exactly three operations" → four, and why the fourth is best-effort while `finish` retries).

**Contract**: `progress()` never raises into the solve; never sends a column it has nothing to say
about; always renews `heartbeat_at`.

#### 3. Runner wiring

**File**: `services/solver/src/cpsat_service/runner.py`

**Intent**: `_solve_and_write` builds `SolveConfig(workers=…, clean_mode=True, targets=settings.stage_targets,
hooks=SolveHooks(on_stage=…, on_solver=…))` where `on_stage` maps `started` →
`client.progress(job_id, {"stage_index": tier, "stage_name": name})` and `completed` →
`client.progress(job_id, {"stages": [wire_stage_report(s) for s in report-so-far], **({"checkpoint":
wire_result(to_generation_result(dump, event.checkpoint)), "checkpoint_stage_index": tier} if
event.checkpoint else {})})`, and `on_solver` → `registry.attach_solver(job_id, solver)`. `_solve_and_write`
gains the `registry` parameter (`run_job` already holds it). `should_stop` is **not** wired (S-305).
The hook wrapper itself catches and logs any unexpected exception so a bug in the emission path
cannot kill a 20-minute solve. Update the module docstring's forward reference (heartbeat now renews
per stage event; S-304 owns finer resolution + reclaim).

**Contract**: the per-stage PATCH bodies above; the terminal write unchanged.

#### 4. Tests

**File**: `services/solver/tests/test_service.py`

**Intent**: (a) Fix `claim, finish = fake.patches()` → first/last with an explicit count assertion.
(b) Pin the progress conversation: with a fake engine that emits two stages, the PATCH sequence is
claim → `started(1)` → `completed(1, checkpoint)` → `started(2)` → … → finish; each progress PATCH
has `status=eq.running`, `select=id`, `heartbeat_at`, and only the expected keys; an UNKNOWN stage's
`completed` carries no `checkpoint`/`checkpoint_stage_index`. (c) `test_every_written_column_is_inside_the_grant`
now exercises progress PATCHes too (it iterates all patches — confirm it still passes). (d) A 503 /
transport error on a progress PATCH is logged and the solve still finishes `succeeded`. (e) A
matched-nothing progress PATCH is a warning, not a failure. (f) `attach_solver` is called with the
solver handle (registry entry's `solver` is non-None during the solve — assert via a hook-capturing
fake). (g) `stage_targets` reaches `SolveConfig.targets` (mirror `test_every_solve_requests_clean_mode`).
(h) Settings parser tests (in `test_settings.py` if one exists, else here).

#### 5. Launchers and docs

**Files**: `scripts/solver/dev.sh` (header comment: optional knobs list), `scripts/solver/image-smoke.sh`
(no change needed unless it enumerates knobs — check), `services/solver/README.md` (env table row for
`SOLVER_STAGE_TARGETS`; "four operations"; the progress columns written per stage), root `README.md`
(§ Tier 1 optional knobs sentence; § Endpoints paragraph: the row now advances per stage; hosted
campaign note: targets may be set in the shell for comparison runs, **timing still invalid**).

**Contract**: prose; `mise run solver:check` (shellcheck) must stay green.

### Success Criteria:

#### Automated Verification:

- `cd services/solver && uv run pytest` green (new conversation pins, best-effort cases, settings parser)
- `cd services/solver && uv run mypy && uv run ruff check` green; `mise run solver:check` green
- `SOLVER_URL=http://127.0.0.1:8000 pnpm test:integration src/test/solver-transport.integration.test.ts` green against a locally running `mise run solver:dev` — and extend it to assert that, by the time the job is `succeeded`, `stages` has 10 entries, `checkpoint` is non-null, `checkpoint_stage_index` is set, and `heartbeat_at > started_at`

#### Manual Verification:

- With `mise run solver:dev` up and `SOLVER_LOG_LEVEL=INFO`, dispatch a job (Generate on a local plan); watch `select status, stage_index, stage_name, checkpoint_stage_index, jsonb_array_length(stages), heartbeat_at from generation_jobs order by created_at desc limit 1` advance stage by stage in Studio
- Start with `SOLVER_STAGE_TARGETS=3=95` and confirm the tier-3 `stages` entry carries `stoppedBy:"target"` and ended early; start with a malformed value and confirm the stderr complaint + default

---

## Phase 4: Migration — pre-paid SELECT grants

### Overview

One additive migration granting the solver role column SELECT on `heartbeat_at` (S-304's widened
claim CAS needs it in a `WHERE`) and `stop_requested_at` (S-305's stop polling), recreating the
SELECT policy under an honest name, and updating the exact-list pins.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<ts>_solver_progress_select_grants.sql` (via `pnpm exec supabase migration new solver_progress_select_grants`)

**Intent**: `grant select (heartbeat_at, stop_requested_at) on public.generation_jobs to solver_job_writer;`
(additive — no revoke needed, the table-level grant was already revoked by `20260812141459`); drop
policy `"Solver reads any job row, three columns of it"` and create `"Solver reads any job row, five
columns of it"` with the same `for select to solver_job_writer using (true)`. Header comment states
why now (D6: one migration + one test edit instead of two), that S-303 itself reads neither column,
and that `UPDATE` on `stop_requested_at` is deliberately **not** granted (the app writes it, S-305).

**Contract**: DDL only; no data; no function re-creates.

#### 2. Test pins

**File**: `src/test/solver-credential.integration.test.ts`

**Intent**: SELECT exact list → `["heartbeat_at","id","snapshot_hash","status","stop_requested_at"]`
(alphabetical — `heldColumnPrivileges` orders by name); the `pg_policies` row's `policyname` → the
new name; the prose at `:187-197` ("SELECT on three columns"); the `:213-236` loop asserting
`result/stages/error` are not readable stays. Check `src/test/generation-jobs.integration.test.ts`
and `docs/runbooks/solver-credential.md` for any "three columns" mention and true them up.

### Success Criteria:

#### Automated Verification:

- `pnpm exec supabase db reset` applies cleanly; `pnpm exec supabase db diff` clean afterwards
- `pnpm test:integration src/test/solver-credential.integration.test.ts src/test/generation-jobs.integration.test.ts` green
- `cd services/solver && uv run pytest tests/test_service.py` still green (its allowlist is UPDATE-only and unchanged)

#### Manual Verification:

- `select column_name from information_schema.column_privileges where grantee='solver_job_writer' and table_name='generation_jobs' and privilege_type='SELECT'` lists exactly the five columns in Studio

---

## Phase 5: App — status read, poll store, plans-list indicator, strip link

### Overview

The plans list gains `indicators` on `PlanRow` (one extra query), a status-only Astro Action keyed by
job ids, a `useSyncExternalStore` poll store (5 s, active-only, visibility-aware, terminal memory), an
**Activity** cell rendering the generation indicator, and the strip gains a "Watch progress in Plans"
link. Plan-detail `model/` is not touched.

### Changes Required:

#### 1. Shared job-status vocabulary

**File**: `src/entities/timetable/model/generation/job-status.ts` (new) + test

**Intent**: `GenerationJobStatus` (the six-value check-constraint vocabulary) plus
`isActiveJobStatus` / `isTerminalJobStatus` guards, so both page slices read one definition without a
cross-slice import. `src/_pages/plan-detail/api/generation-delivery.ts:49` imports it from the entity
barrel instead of declaring its own.

**Contract**: `export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "stopped" | "interrupted"`; barrel export.

#### 2. Indicator model

**File**: `src/_pages/plans-list/model/plan-indicators.ts` (new) + `plan-indicators.test.ts`

**Intent**: The `PlanIndicator` discriminated union with its single S-303 occupant
`GenerationIndicator = { kind: "generation"; jobId; planId; status: GenerationJobStatus; stageIndex:
number | null; stageName: string | null; startedAt: string }`, a row→indicator mapper shared by the
loader and the action (`toGenerationIndicator(row)`), and the pure presentation derivation
`describeGenerationIndicator(ind): { tone: "active" | "done" | "failed" | "other"; label: string;
href: string | null }` — queued: "Queued — started HH:MM"; running without stage: "Generating —
starting"; running with stage: "Generating — stage {stageIndex} of {LADDER_TIER_COUNT} · {tierLabel}";
succeeded: "Finished — open plan" (href `/plans/{planId}`); failed: "Failed — open plan"; stopped /
interrupted: "Stopped" / "Interrupted". Time via the same HH:MM formatting the strip's `formatStarted`
uses (extract to `shared/lib` only if it is already generic; otherwise a local helper).

**Contract**: the union is designed so S-306's `{ kind: "proposal" … }` joins without retrofit;
`PlanRow.indicators: PlanIndicator[]`.

#### 3. Loader

**File**: `src/_pages/plans-list/api/loader.ts`

**Intent**: `PlanRow` gains `indicators: PlanIndicator[]`; `fetchPlans` adds **one** query —
`generation_jobs.select("id, plan_id, status, stage_index, stage_name, created_at").in("status",
["queued","running"]).in("plan_id", planIds)` — and attaches at most one indicator per plan (the
partial unique index guarantees ≤ 1 active row per plan). The `1 + 3N` count fan-out is untouched.
Update the docstring: the derived-metrics deferral still stands; this indicator reads a durable
indexed row.

**Contract**: `PlanRow.indicators`; `PlansListPage.astro`/`pages/plans/index.astro` unchanged.

#### 4. Status read action

**File**: `src/_pages/plans-list/api/generation-status.ts` (new) + `generation-status.integration.test.ts`; `api/actions.ts`; `api/plans-client.ts`; `model/schemas.ts`

**Intent**: `readGenerationJobStatuses(supabase, { jobIds })` — projects the same six columns for
`.in("id", jobIds)` and returns `GenerationIndicator[]` (terminal rows included, that is how the store
learns a job ended). Registered as `planActions.readGenerationJobStatuses` via `defineDomainAction`;
Zod input `{ jobIds: z.array(z.uuid()).min(1).max(200) }` in `model/schemas.ts`; a one-line client
wrapper in `plans-client.ts`. It never delivers, never touches `checkGeneration`. Integration test:
insert an active and a terminal job as admin (reuse the inline `enqueue`-style helper pattern from
`solver-transport.integration.test.ts:155`; register clones for teardown), read them back through the
authenticated client, assert shapes and that `stages`/`snapshot` are not selected.

**Contract**: action name `readGenerationJobStatuses`; output `GenerationIndicator[]`.

#### 5. Poll store + hook

**File**: `src/_pages/plans-list/model/job-progress-store.ts` (new) + `job-progress-store.test.ts`; `model/use-generation-indicators.ts` (new)

**Intent**: `createJobProgressStore({ initial: GenerationIndicator[], fetch, intervalMs = 5000 })`
returning `{ subscribe, getSnapshot, getServerSnapshot, dispose }` over a `ReadonlyMap<planId,
GenerationIndicator>`. Rules: the timer runs only while ≥ 1 subscriber and ≥ 1 **active** indicator
and `document.visibilityState === "visible"`; `visibilitychange` pauses/resumes (immediate tick on
resume); each tick fetches the active job ids, merges, and keeps terminal indicators in the snapshot
(terminal memory); once nothing is active the timer stops; a fetch error keeps the last snapshot and
the next tick retries (no throw, no UI error state in S-303); snapshot identity changes only when
data changes. `useGenerationIndicators(plans)` lazily creates the store (`useState(() => …)`) seeded
from the SSR'd `plan.indicators` and wires `useSyncExternalStore(subscribe, getSnapshot,
getServerSnapshot)`; the fetcher is injectable for tests. No `setState` in any effect.

**Contract**: the store is an external store in the `board-zoom.ts` sense; the hook's return is the
map the cell renders. Unit tests with fake timers cover every rule above.

#### 6. UI

**File**: `src/_pages/plans-list/ui/PlanIndicatorsCell.tsx` (new) + `PlanIndicatorsCell.test.tsx`; `ui/PlansHub.tsx`

**Intent**: A new **Activity** `<TableHead>` + cell after "Last updated"; the cell maps
`indicators` to badges — the generation badge uses `Badge` from `@/shared/ui`, a `Loader2` spinner
while active, `role="status"` (precedent `GenerationStatusStrip.tsx:33`), and renders the `href` as an
anchor for terminal states. Semantic tokens only. `PlansHub` calls `useGenerationIndicators(plans)`
and passes each plan's live indicators (falling back to the SSR'd ones) into the cell; nothing else in
the hub changes. jsdom tests: each status renders its copy; the active badge has `role="status"`.

**File**: `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx` + `.test.tsx`

**Intent**: In the queued/running branch add `<a href="/plans">Watch progress in Plans</a>` beside
Refresh; replace the "S-303 upgrades it in place" paragraph with the truth (FR-308 advisory lives
here, static by design; live progress is on the plans list; polling deliberately never enters the
board island). Test asserts the link.

**Contract**: `src/_pages/plan-detail/model/**` has no diff in this phase (FR-312 structural proof).

### Success Criteria:

#### Automated Verification:

- `pnpm check` 0 errors; `pnpm lint` (both React 19 hook rules pass without any `eslint-disable`); `pnpm steiger` green (no cross-slice import; entity barrel exports used)
- `pnpm test` green: `plan-indicators`, `job-progress-store` (fake timers: active-only start, stop on all-terminal, visibility pause/resume, stable snapshot identity, error keeps snapshot), `PlanIndicatorsCell.test.tsx`, updated `GenerationStatusStrip.test.tsx`, `stage-report`/`tier-labels`/`job-status`
- `pnpm test:integration src/_pages/plans-list` green (loader attaches ≤ 1 indicator per plan; `readGenerationJobStatuses` returns active + terminal rows with the narrow projection)
- `git diff --stat main -- src/_pages/plan-detail/model` is empty (FR-312)
- `pnpm build` green

#### Manual Verification:

- `pnpm build && pnpm preview` with `mise run solver:dev` up: Generate on a plan, open `/plans` — the row shows "Generating — stage 1 of 10 · completeness, started HH:MM", advances to later stages without reload, and flips to "Finished — open plan" at the end; the network tab shows one `readGenerationJobStatuses` call per 5 s **only** while active, none once finished, none on an idle hub, and none while the tab is hidden
- Clicking "Finished — open plan" lands on the source plan whose strip shows "Proposal ready — open" (delivery happened on visit, not from the poll)
- On the plan page during a run, the strip shows the static advisory + "Watch progress in Plans"; drag-drop on the board feels unchanged
- `/plans` SSR (JS disabled) still renders the indicator's initial state

---

## Phase 6: Truth-up and close-out

### Overview

Correct every sentence the code now contradicts, record the hand-offs to S-304/S-305/S-306/S-308,
and define the polling "disappoints" trigger.

### Changes Required:

#### 1. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Row `:36` and the S-303 body (`:139-150`): outcome → "…after each completed stage the
incumbent board **+ per-stage best/bound** is durably checkpointed, so board quality is **never
worse** stage over stage…"; "the plans list shows live stage-by-stage progress; the source plan
shows the static advisory"; "stages stop by target **when a target is configured** (`SOLVER_STAGE_TARGETS`);
values ship with S-308"; Risk: the job UI lands on the **plans list**, FR-312 retired structurally.
S-304 body: heartbeat now renews per stage event, SELECT grant pre-paid, claim-CAS widening remains.
S-305 body: the stop seam exists (`SolveHooks.should_stop`, `attach_solver`, per-stage `stoppedBy:
cancelled` already in-contract). Parked "Push-based progress": define the trigger — polling is judged
to disappoint if a stage transition routinely takes > 10 s to appear, or if hub polling becomes a
measurable share of Supabase request volume; until then stay. Set S-303's status per the roadmap's
vocabulary.

#### 2. PRD

**File**: `context/foundation/prd.md`

**Intent**: FR-303: dated truth-up note under the Socrates block — "objective tuple" → "board + the
per-stage best/bound the ladder actually holds; a true tuple needs an `evaluate_board` re-solve and is
not stored"; target *values* arrive with S-308, the machinery ships here. No FR-308 change.

#### 3. In-repo prose

**Files**: `src/_pages/plan-detail/model/generation/use-generation-job.ts:25`;
`src/_pages/plan-detail/api/generation-delivery.ts:27`; `src/test/generation-proposal.integration.test.ts:93`;
`services/solver/src/cpsat_service/registry.py:12,39,82` (`JobEntry.solver` "stays None for the whole
of F-302"); `services/solver/src/cpsat_service/__init__.py:15`; `services/solver/src/cpsat_service/supabase.py:1`;
`supabase/migrations/20260810200122_generation_jobs.sql` (no edit — migrations are immutable; the
"rule S-303 inherits" sentence stays true); `contracts/README.md:31-34` (done in Phase 1 — re-check);
`services/solver/README.md` § status channel; root `README.md` § Endpoints, § Tier 1 knobs, § hosted
campaign. `grep -rn "S-303" src services docs` must leave only forward-true sentences.

#### 4. Change record

**File**: `context/changes/staged-progress-and-checkpoints/change.md`

**Intent**: Note the decisions taken in planning (clause 5 → bounds; targets latent; `stoppedBy`
enum; 5 s visibility-aware poll; grants pre-paid; strip link), and the S-304/S-305/S-306/S-308
hand-off list.

### Success Criteria:

#### Automated Verification:

- `/verify` green (full local CI gate)
- `cd services/solver && uv run pytest && uv run mypy && uv run ruff check` green; `mise run solver:check` green
- `grep -rn "nothing here loops\|upgrades it in place\|Unused in F-302\|exactly three operations\|three columns of it" src services docs contracts README.md` returns nothing

#### Manual Verification:

- Read roadmap S-303/S-304/S-305 and PRD FR-303 end-to-end: every sentence matches shipped behaviour; no "objective tuple", no "strictly better"

---

## Testing Strategy

### Unit Tests:

- Engine: target stop / unreachable target / neutrality / hook event sequence / `on_solver` /
  `should_stop` → `cancelled` / `stopReason` derivation matrix; parity 10/10 untouched.
- Service: settings parser; progress PATCH conversation pin; best-effort failure paths; `attach_solver`.
- Contract: StageReport `stoppedBy` round-trip on both sides; goldens byte-identical; Zod↔ajv agreement.
- App: `plan-indicators` labels; `job-progress-store` lifecycle with fake timers; `PlanIndicatorsCell`
  jsdom; strip link; `job-status` guards; `stage-report` parser; `tier-labels`.

### Integration Tests:

- `solver-transport.integration.test.ts` extended: a completed job has 10 `stages`, a `checkpoint`,
  `checkpoint_stage_index`, and a renewed `heartbeat_at`.
- `solver-credential.integration.test.ts` + `generation-jobs.integration.test.ts`: the five-column
  SELECT grant and the renamed policy.
- `plans-list`: loader attaches indicators; `readGenerationJobStatuses` narrow projection.

### Manual Testing Steps:

1. `pnpm exec supabase db reset` → `mise run solver:dev` → `pnpm build && pnpm preview`.
2. Generate on a plan; open `/plans`; watch the Activity cell advance; confirm poll cadence and
   stop-when-idle in the network tab; hide the tab and confirm requests pause.
3. After "Finished — open plan", visit the plan; the strip delivers and shows "Proposal ready".
4. Re-run with `SOLVER_STAGE_TARGETS=3=95` and confirm the tier-3 stage ends early with `stoppedBy: target`.
5. Confirm the Studio query in Phase 3 shows one row advancing, never a second active row per plan.

## Performance Considerations

- Row churn: ~20 small PATCHes per job (two per stage) on top of claim/finish; `snapshot` (~124 KB)
  keeps its TOAST pointer untouched; `checkpoint` (~35 KB) is rewritten ≤ 10×. Acceptable; noted in
  the migration-era comment already (`generation_jobs.sql`).
- Polling: one narrow read per 5 s per open hub tab only while a job is active (~150–240 reads per
  12–20 min job); nothing on an idle hub; nothing when hidden.
- FR-312: no change to the board island's state graph; the pure constraint core is untouched; the
  only plan-detail change is an anchor in the strip.
- Target stops only shorten wall clock; CP-SAT `stop_search()` cost measured 0.00 s.

## Migration Notes

- The grant migration is additive and safe to apply before or after the code; CI's `deploy` job
  applies it with `supabase db push` on merge. No data, no backfill, no function re-creates.
- Rows from before this change have `stages` filled only at finish and `checkpoint` null; the UI
  handles `stage_index == null` ("Generating — starting") and `checkpoint` is not read by the app.
- **Do not merge to `main` while a production solve is running** (README rule) — unchanged by S-303.

## References

- Research: `context/changes/staged-progress-and-checkpoints/research.md` (incl. § Follow-up 2026-08-19)
- Decision record: `context/changes/staged-progress-and-checkpoints/change.md`
- Roadmap S-303: `context/foundation/roadmap.md:139-150`; PRD FR-303/304/308/312: `context/foundation/prd.md:282-336,376-382`
- Engine ladder: `services/solver/src/cpsat_engine/solve.py:362-403`, `_run_solver :517-534`, `SolveConfig :31-46`, `stopReason :348-349`
- Service: `runner.py:175-199`, `supabase.py:141-190`, `registry.py:81-86`, `settings.py`
- Contract: `contracts/generation-wire.schema.json:163-167,189-216`, `contracts/README.md:31-53,129-141`
- App: `src/_pages/plans-list/api/loader.ts`, `ui/PlansHub.tsx:96-146`, `src/_pages/plan-detail/lib/board-zoom.ts` (store precedent), `generation-delivery.ts:66-97`
- Grants: `supabase/migrations/20260812141459_solver_select_column_scope.sql`, `src/test/solver-credential.integration.test.ts:152-236`
- Lessons applied: config-gating discipline; `.dev.vars`/launcher guard; semantic tokens; verify-the-symbol before citing; `astro check` as the type gate

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract widening (bilateral, bump-free)

#### Automated

- [x] 1.1 `uv run pytest tests/test_contract.py` green with new StageReport/stopReason cases — 17d4c36
- [x] 1.2 `uv run mypy` and `uv run ruff check` green — 17d4c36
- [x] 1.3 `pnpm test bench/contract-parity.test.ts src/entities/timetable` green; goldens byte-identical — 17d4c36
- [x] 1.4 `pnpm check` 0 errors; `pnpm lint`, `pnpm steiger` green — 17d4c36

#### Manual

- [x] 1.5 Schema diff reviewed: only the two additive changes + descriptions; `required`/`formatVersion` untouched — 17d4c36

### Phase 2: Engine — solve-to-target + stage hooks seam

#### Automated

- [x] 2.1 `uv run pytest` green incl. parity exact 10/10 and new stage-stop/hook tests
- [x] 2.2 Local golden-dump parity test run green
- [x] 2.3 `uv run mypy` 0 errors; `uv run ruff check` clean

#### Manual

- [x] 2.4 Seed-fixture run with a tier-6 target ends early with `stoppedBy: target`; no-target timings unchanged

### Phase 3: Service — progress emission, targets knob, stop seam

#### Automated

- [ ] 3.1 `uv run pytest` green (conversation pins, best-effort cases, settings parser)
- [ ] 3.2 `uv run mypy`, `uv run ruff check`, `mise run solver:check` green
- [ ] 3.3 `solver-transport.integration.test.ts` extended and green (10 stages, checkpoint, checkpoint_stage_index, renewed heartbeat)

#### Manual

- [ ] 3.4 Studio shows the row advancing stage by stage during a live dispatch
- [ ] 3.5 `SOLVER_STAGE_TARGETS=3=95` yields an early tier-3 stop with `stoppedBy: target`; malformed value degrades with a stderr complaint

### Phase 4: Migration — pre-paid SELECT grants

#### Automated

- [ ] 4.1 `supabase db reset` applies; `db diff` clean
- [ ] 4.2 `solver-credential` + `generation-jobs` integration tests green with the five-column list and renamed policy
- [ ] 4.3 `uv run pytest tests/test_service.py` still green

#### Manual

- [ ] 4.4 Studio `column_privileges` query lists exactly the five SELECT columns

### Phase 5: App — status read, poll store, plans-list indicator, strip link

#### Automated

- [ ] 5.1 `pnpm check` 0 errors; `pnpm lint` without any hook-rule suppression; `pnpm steiger` green
- [ ] 5.2 `pnpm test` green (plan-indicators, job-progress-store, PlanIndicatorsCell, strip, stage-report, tier-labels, job-status)
- [ ] 5.3 `pnpm test:integration src/_pages/plans-list` green
- [ ] 5.4 `src/_pages/plan-detail/model/**` has no diff (FR-312)
- [ ] 5.5 `pnpm build` green

#### Manual

- [ ] 5.6 Live walkthrough: indicator advances on `/plans`, flips to "Finished — open plan"; polling only while active, paused when hidden, none when idle
- [ ] 5.7 "Finished — open plan" → strip shows "Proposal ready" (delivery on visit)
- [ ] 5.8 Strip shows static advisory + "Watch progress in Plans"; board drag-drop unchanged
- [ ] 5.9 `/plans` SSR renders the initial indicator state

### Phase 6: Truth-up and close-out

#### Automated

- [ ] 6.1 `/verify` green
- [ ] 6.2 Solver gates green (`pytest`, `mypy`, `ruff`, `mise run solver:check`)
- [ ] 6.3 Stale-prose grep returns nothing

#### Manual

- [ ] 6.4 Roadmap S-303/S-304/S-305 and PRD FR-303 read true end-to-end
