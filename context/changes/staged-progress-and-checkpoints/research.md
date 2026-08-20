---
date: 2026-08-19T15:23:41+02:00
researcher: Dobromir Kropielnicki
git_commit: 2dcce22351baa6bdaa89a53eb94e498643ab8c3e
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility and challenges of implementing roadmap slice S-303 (staged progress + durable checkpoints)"
tags: [research, codebase, s-303, cp-sat, solver, generation-jobs, polling, checkpoints, contracts]
status: complete
last_updated: 2026-08-19
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Added follow-up research on relocating the job indicator to the plans list as one of a list of plan indicators"
---

# Research: Feasibility and challenges of implementing S-303

**Date**: 2026-08-19T15:23:41+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `2dcce22351baa6bdaa89a53eb94e498643ab8c3e`
**Branch**: `main`
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility and challenges of implementing the **AS-303** task from the roadmap.

> **Note on the ID.** There is no `AS-303` in the roadmap; the ID is `S-303`, and its Change ID is
> `staged-progress-and-checkpoints` — this change folder. Read as S-303 throughout.

## Summary

**S-303 is feasible, and it is the best-prepared slice in the family — but its roadmap outcome
contains one clause that cannot be built as written, and its hardest problem is not the solver.**

Three findings dominate:

1. **The database needs zero DDL.** F-301 forward-designed `generation_jobs` from all ten slices.
   `stage_index`, `stage_name`, `stages`, `checkpoint`, `checkpoint_stage_index` and `heartbeat_at`
   all exist, are typed, and are already inside the solver role's 11-column UPDATE grant. Nothing
   writes or reads five of them today. RLS already permits `running → running`, so repeated
   mid-solve writes are legal without a policy change.

2. **Target-stopping is small and was verified by running it.** The engine is genuinely
   solve-to-budget today — measured on the committed seed fixture, **7 of 10 stages burn their
   entire budget to the millisecond**, with bounds nowhere near the incumbent. Adding
   solve-to-target via a `CpSolverSolutionCallback` + `stop_search()` is ~30–40 lines confined to
   `solve.py`, leaves the objective model untouched (so the 10/10 parity gate cannot move), and was
   proven live: 22 callbacks fired, `stop_search()` returned a usable `FEASIBLE` board in 8.29 s
   instead of the full 30 s budget.

3. **The riskiest work is the app's first polling loop.** There is no `setInterval`, no Realtime,
   no SWR/react-query anywhere in `src/` — S-303 introduces the pattern from zero. Worse, S-301
   already hit and *dodged* the React 19 wall this needs: an on-mount fetch-and-set-state effect
   fails `react-hooks/set-state-in-effect`, and suppressing `exhaustive-deps` makes the React
   Compiler skip optimizing the whole hook. S-301 escaped by moving the check into Astro page
   frontmatter — **a polling loop cannot escape that way.** And the poll would land inside
   `useCombinedBoardState`, i.e. inside the board orchestrator, where each tick re-renders the
   island root ~150–240 times per job.

**The one clause that is not implementable as written** is "the incumbent board **+ objective
tuple** is durably checkpointed". The solver never holds a true 10-tuple during the ladder — this
is stated verbatim in `contracts/README.md:63-65` and twice in F-301's research. This is the exact
shape of the two corrections S-301 needed mid-implementation, found this time *before* planning.

**Sizing: 5–7 phases, ~4–6 sessions** — at or slightly above the S-301/S-302 envelope, because
S-303 is simultaneously the deepest new solver capability, net-new UI on two surfaces, the app's
first polling loop, and a bilateral contract edit.

### Feasibility by seam

| Seam | Verdict | Why |
| --- | --- | --- |
| **Persistence (`generation_jobs`)** | 🟢 Green | Zero DDL. All columns exist and are granted for writes. RLS window already open for `running → running`. |
| **Engine — target-stopping** | 🟢 Green | ~30–40 lines in `solve.py`; verified empirically; parity gate insulated by construction. |
| **Engine — checkpoint payload** | 🟢 Green | `_extract_board` already runs per stage; `_generated` + `to_generation_result` + `wire_result` are pure and already exist. |
| **Engine → service emission seam** | 🟡 Amber | Genuinely new: a callback on `SolveConfig`, a 4th `JobRowClient` operation, best-effort write discipline. Must not invert the one-way `cpsat_service → cpsat_engine` dependency. |
| **Wire contract** | 🟡 Amber | No `formatVersion` bump — but `stopReason` has no `target` value, so a bilateral enum widening is needed, and there is **no wire home for a per-job target**. |
| **App — polling loop** | 🟠 Orange | First of its kind in the repo; blocked by two live ESLint rules; needs `useSyncExternalStore`, not a naive effect. |
| **App — FR-312 (<200 ms)** | 🟠 Orange | Poll lands inside the board orchestrator; isolation rests entirely on unverified React Compiler memoization across a ~5-level identity chain. Zero `React.memo` in the codebase. |
| **Roadmap outcome text** | 🔴 Red | "objective tuple" not implementable; "strictly better" over-claims; "quality accrues monotonically" is true of the board, false of the record. |

## Detailed Findings

### 1. The ladder today — solve-to-budget, measured

A "stage" is one objective tier minimized to its own budget, then hardened as a ceiling for every
later stage. The tier order is a hardcoded 10-tuple (`services/solver/src/cpsat_engine/objective.py:59-70`),
and the ladder loop is `_run_ladder` (`services/solver/src/cpsat_engine/solve.py:362-403`):

```python
bundle.model.clear_hints()
_hint_board(bundle, incumbent)             # warm-start from the previous stage
bundle.model.minimize(tier.var)
status, solver = _run_solver(config, config.stage_budget_s, f"tier-{idx+1}-{tier.name}", bundle.model)
if solved:
    incumbent = _extract_board(bundle, solver)
    bundle.model.add(tier.var <= best)     # harden: no later stage may worsen this tier
```

The only stop rule is wall-clock (`solve.py:517-534`, `max_time_in_seconds = budget_s`). Production
passes only `workers`/`log_dir`/`clean_mode` (`services/solver/src/cpsat_service/runner.py:180`), so
budgets are the defaults: **300 + 9×120 = 1380 s ≈ 23 min ceiling**.

**Measured** (seed fixture `services/solver/tests/fixtures/seed-plan-a.json`, `solve_complete`,
8 workers, 10 s stages):

```
 t 1 completeness       OPTIMAL   best=0    bound=None   0.14s
 t 2 holes              OPTIMAL   best=0    bound=0      1.33s
 t 3 totalSlots         FEASIBLE  best=97   bound=93    10.03s
 t 4 teacherHoles       FEASIBLE  best=83   bound=0     10.02s
 t 5 softHits           OPTIMAL   best=0    bound=0      1.28s
 t 6 studentHoles       FEASIBLE  best=949  bound=3     10.02s
 t 7 doublesDeficit     FEASIBLE  best=296  bound=4     10.02s
 t 8 lateStarts         FEASIBLE  best=4    bound=0     10.02s
 t 9 fridayTail         FEASIBLE  best=38   bound=26    10.03s
 t10 goldenBandDistance FEASIBLE  best=13   bound=6     10.02s
```

7 of 10 stages consume the whole budget; the 3 that prove OPTIMAL finish in ~1 s. **Target-stopping
costs the fast stages nothing and is the only lever on the slow ones.**

A second measurement matters for the UI: at a 1.0 s stage budget **every** ladder stage returned
`UNKNOWN` — no hardening, no incumbent change — while still reporting `stopReason: "budget"`
(`solve.py:348-349`). An under-budgeted stage silently contributes nothing.

### 2. Target-stopping — feasible, small, and verified live

No target concept exists anywhere: `SolveConfig` (`solve.py:31-46`) has budgets, seed, workers,
hops, `log_dir`, `clean_mode` — and nothing else.

**Two injection routes; only one is safe.**

- ✅ **Solution callback + `stop_search()`.** `minimize(tier.var)` stays as-is; a
  `CpSolverSolutionCallback` fires per improving solution and calls `stop_search()` once
  `objective_value <= target`. The model is untouched, so the objective encoding cannot move.
- ❌ **`add(tier.var <= target)`.** The codebase already documents why this is wrong: *"CP-SAT cannot
  drop a constraint"* (`solve.py:255-263`, the clean-mode fallback rationale). An unreachable target
  would poison every later stage and recovery would need a full model rebuild.

**Verified empirically** (tier 6 studentHoles, target 900, 30 s budget, 8 workers):

```
status: FEASIBLE   wall: 8.29s   objective: 874.0   bound: 3.0
callbacks fired: 22
first incumbent: 1048  (== the warm-start value, SEED_OBJECTIVE[5])
```

A probe subclassing `CpSolverSolutionCallback` with `Callable` fields also passed `uv run mypy`
under `--strict` with 0 errors.

**Where a target may live is the open design question.** `SolveRequest` is
`additionalProperties: false` = `{formatVersion, snapshot, warmStart?}`; the solver deliberately
does **not** read `generation_jobs.policy` and *cannot* — `policy` is outside its 3-column SELECT
grant. `runner.py:177-179` states it: *"there is nowhere on the wire for a caller to ask for it"*.
So the only bump-free route is **solver-side config** (a `SolveConfig` field + env), which is
exactly the clean-mode precedent — and which triggers the `.dev.vars` lesson (§7).

**Tier 5 is already off the table.** Clean mode enforces `softHits == floor` as a hard constraint
before the ladder starts (`solve.py:266-268`), so tier 5 solves to the floor instantly (1.28 s
measured). Targets are meaningful for tiers **3, 4, 6, 7, 8, 9, 10** only.

> Clean mode did land in S-301, but as `softHits == floor`, **not literally `≡ 0`** — the literal
> reading is unsatisfiable when an author pinned a row onto a soft cell. It collapses to 0 when the
> floor is 0, which is the common case. A proven-INFEASIBLE clean solve rebuilds without the
> constraint and records `notes["clean_fallback"]` (`solve.py:204-220`), internal only.

### 3. Checkpoint emission — the payload is nearly free, the seam is not

**Payload: trivial.** After each stage `_run_ladder` already holds
`incumbent: dict[PlacementKey, int]` (`solve.py:400`). Converting it to the wire result is three
existing pure functions: `_generated` (`solve.py:487-488`) → `to_generation_result`
(`solve.py:314-356`) → `wire_result` (`services/solver/src/cpsat_engine/wire.py:94-111`).

**Warm-start monotonicity is already correct** — `solve.py:380-381` re-hints from the incumbent
every stage and `solve.py:401` hardens `tier.var <= best`, so stage N+1 provably starts from stage
N's board. But see §5 for what "monotonic" does and does not mean.

**Emission: genuinely new.** There are exactly two DB writes per job today, both at the edges:

| Write | Where | What |
| --- | --- | --- |
| Claim CAS | `services/solver/src/cpsat_service/supabase.py:141-167` | `status='running'`, `started_at`, `heartbeat_at` — **once** |
| Terminal | `supabase.py:169-190` | `status`, `finished_at`, `result`, `error`, `stages` — **once**, batched after the whole solve |

Nothing writes `stage_index`, `stage_name`, `checkpoint`, `checkpoint_stage_index`. `heartbeat_at`
is set once at claim and never renewed. `JobRowClient` has *"exactly three operations"* by design
(`supabase.py:1`) — S-303 adds a fourth.

**The layering constraint is strict**: `cpsat_engine` imports nothing from `cpsat_service`
(`services/solver/README.md:8-11`, `src/cpsat_service/__init__.py:9-11`). There is no Supabase
client reachable from the engine. **The correct seam is a callback the service hands down** — e.g.
an `on_stage(StageReport, board)` field on `SolveConfig`, invoked from `_run_ladder`. The engine
calls a function it was given; it does not import a client.

**Do the durable write between stages on the worker thread, not inside the solution callback.** A
solution callback runs on the solver's own thread while search is live; an HTTP round trip there
stalls the search. Use the callback for target detection and cheap in-memory progress only.

**Best-effort discipline.** Only `finish` retries today (`supabase.py:202-242`, 3 attempts, transient
5xx only). A checkpoint write must never kill the solve on failure and must never blank a column.

### 4. Persistence — zero DDL, and that is not luck

Sole creating migration `supabase/migrations/20260810200122_generation_jobs.sql:57-98`. **No later
migration alters the table**; the two that follow touch only role/grant/policy.

```sql
stage_index            smallint,
stage_name             text,
stages                 jsonb not null default '[]'::jsonb,
checkpoint             jsonb,
checkpoint_stage_index smallint,
heartbeat_at           timestamptz,
stop_requested_at      timestamptz,
constraint generation_jobs_status_check
  check (status in ('queued','running','succeeded','failed','stopped','interrupted'))
```

The header says why (`:5-7`): this is *"the ONLY table the whole slice family (S-301 → S-310) needs…
forward-designed from all ten, so those slices ship **behaviour, not migrations**"*. The six-value
status vocabulary already includes S-304's `interrupted` and S-305's `stopped`.

- **One-active-job-per-plan** is a partial unique index (`:103-104`), caught by the app as
  `UNIQUE_VIOLATION → CONFLICT` (`src/_pages/plan-detail/api/generation-job.ts:144-146`).
- **All 11 write columns are already granted** (`supabase/migrations/20260810200931_solver_job_writer_role.sql:62-74`),
  and the RLS UPDATE policy's window stays open for the whole run (`:96-99`):
  `using (status in ('queued','running'))` / `with check (status in ('running','succeeded','failed','stopped','interrupted'))`.
  A mid-solve PATCH is `running → running` — **inside both**.
- **Posture verified from the catalog, not the comments** (per the least-privilege lesson):
  `heldPrivileges(solver_job_writer, generation_jobs)` → `[]`, i.e. zero table-wide privileges;
  SELECT is exactly `id, snapshot_hash, status`; `anon` has all eight privileges revoked
  (`src/test/solver-credential.integration.test.ts:188-243`).

**Two grant gaps will bite:**

1. **`stop_requested_at` has no grant at all** — neither SELECT nor UPDATE. Any solver-side stop
   polling 42501s.
2. **S-304's widened claim CAS needs `grant select (heartbeat_at)`.** Postgres requires column-level
   SELECT on any column referenced in a `WHERE` clause, and a PostgREST filter
   `or=(status.eq.queued,and(status.eq.running,heartbeat_at.lt.<ts>))` reads it. **This is recorded
   nowhere in the repo** and is the concrete second half of the roadmap's "confirming the RLS windows
   still permit it" (`context/foundation/roadmap.md:159-172`).

Both exact-column lists are pinned by assertion (`src/test/solver-credential.integration.test.ts:199-234`),
*by design* — a widening has to fail there.

**Size and churn.** Recorded payloads: snapshot ~101–124 KB, `GenerationResult` ~35 KB, checkpoint
board ~35 KB. Committed goldens re-measured: `contracts/fixtures/generation-result.json` = 24,126 B
for 238 placements. `checkpoint` is deliberately **one board, last-write-wins** — retaining all ten
would cost ~350 KB/job for no product value. ~10 checkpoint UPDATEs/job takes autovacuum load from
~2 to ~12+ row versions; the untouched 124 KB `snapshot` keeps its TOAST pointers and is not
rewritten. Worth a note, not a blocker.

### 5. Wire contract — no `formatVersion` bump, but two edits are still needed

**Verdict: checkpoints do not bump `formatVersion`.** Four steps of evidence:

1. `formatVersion` lives on `SolveRequest` **and nowhere else** (`contracts/README.md:129-132`), and a
   checkpoint never travels on that path — it flows solver → PostgREST → `generation_jobs` → app.
2. The result payload *is* in frozen scope, and `StageReport` is in-contract explicitly *"because
   S-303 persists an array of these into `generation_jobs.stages`"* (`contracts/README.md:24-38`).
   The contract was written anticipating this slice.
3. Additive-and-optional changes do not bump (`contracts/README.md:134-137`), so even a new
   `$defs/Checkpoint` would be free.
4. A checkpoint that *is* a `GenerationResult` reuses frozen shapes verbatim and needs no fixture
   regeneration at all.

**But two contract-adjacent edits are unavoidable:**

- **`GenerationDiagnostics.stopReason` is `budget | cancelled` only.** A target-stopped result must
  either lie ("budget") or the enum must be widened. Widening is bump-free but **bilateral** — both
  goldens and both suites (`bench/contract-parity.test.ts`, `services/solver/tests/test_contract.py`)
  in one commit. S-304 will want a value for `interrupted` too: **do it once in S-303, not twice.**
- **`StageReport` is schema-validated only on the Python side** (`test_contract.py:257-277`). The TS
  mirror is a hand-written, ungated `StoredStageReport`
  (`src/entities/timetable/model/generation/clean-label.ts:31-38`). S-303 makes `stages` load-bearing
  for the UI — adding a TS-side validator is cheap insurance.

**Hard design rules that fall out of the canonical form:**

- **Never put a `StageReport` — or any float — inside a byte-compared or hashed payload.**
  `wallClockS` is the contract's sole non-integer and has no cross-language byte guarantee (Python
  renders `2.0`, JS renders `2`) — `contracts/README.md:102-110`. Keep the board in `checkpoint`,
  the stage identity in the `checkpoint_stage_index` **column**, the timing in `stages`.
- **Write the checkpoint through `wire_result`, never raw `to_generation_result`** — the declared
  array sort on `placements` must hold. Precedent and reasoning already at `runner.py:189-193`.
- **`stages` is chronological and deliberately excluded from the sort table** (`contracts/README.md:99-100`)
  — never sort it.
- **`stage_index` is never an array index.** `solve_repair` emits tiers 1 and 4 only; `clean-label.ts:19-22`
  already learned this (*"found by `tier === 5`, never by array index"*).

### 6. The app — first polling loop, and a React 19 wall S-301 dodged

**Today the UI is blind after dispatch except for two manual triggers**: a page visit
(`src/pages/plans/[id]/index.astro:29-38` runs `checkGeneration` in frontmatter) and a Refresh
button (`GenerationStatusStrip.tsx:37`). The hook says so: *"Polling is S-303's; nothing here loops"*
(`src/_pages/plan-detail/model/generation/use-generation-job.ts:25`). The strip's own docstring
reserves the upgrade: *"Deliberately minimal, and S-303 upgrades it in place"* (`GenerationStatusStrip.tsx:18-20`).

**There is no async precedent at all.** Zero `setInterval`, zero `EventSource`, zero Realtime
channels, no SWR/react-query. Three non-test `setTimeout` sites exist, only one inside the island.
Integration tests poll, but in Node.

**⚠ The wall.** S-301 recorded it (`context/archive/2026-08-12-first-verified-proposal/change.md:207-216`):
a planned on-mount check *"fails lint twice over: `react-hooks/exhaustive-deps` (suppressing which
makes the **React Compiler skip optimizing the whole hook**) and then `react-hooks/set-state-in-effect`,
React 19's rule against fetch-and-set-state effects."* S-301 escaped by moving the check into Astro
page frontmatter. **A polling loop cannot be moved to page render.** Both rules are live
(`eslint.config.mjs:60-67`).

The repo's established, Compiler-safe answer is `useSyncExternalStore` over an external store —
five precedents exist (`history-store.ts`, `board-zoom.ts`, `drag-hint-mode.ts`, `shelf-pinned.ts`,
`board-disclosure.ts`), and `context/foundation/lessons.md:40-45` already prescribes it for
hydration determinism. `use-lens.ts:38-46` is the in-repo precedent for a post-mount-only effect
that must not desync the hydration render.

**A poll must not re-enter delivery.** `checkGeneration` is *not* a passive read — it performs
verify → translate → apply (`src/_pages/plan-detail/api/generation-delivery.ts:86,109-166`). It is
idempotent (the delivered marker is a CAS, `:310-318`), but a 5 s loop calling it would re-enter the
trust boundary ~200 times per job. **Split a cheap status-only read from the delivery-triggering one.**

**The plans-list badge is unowned today** — `grep generation_jobs src/_pages/plans-list/` returns
nothing. `PlanRow` (`src/_pages/plans-list/api/loader.ts:8-15`) has no job relationship. The badge
should cost **one extra query total**, not `+N`: a single `in("status", ["queued","running"])` fetch,
at most one row per plan by construction of the partial unique index.

**FR-308's advisory indicator is nearly free.** `GenerationStatusStrip` already renders
`formatStarted(job.createdAt)` (`:36,101`) — FR-308's "from `<time>` state" *is* that value; the
wording just needs to name the snapshot's vintage rather than the job's start. "Editing is never
blocked" is already true: only `GenerateButton` disables (`GenerateButton.tsx:47`), no board control
consults job state.

> Read `<time>` as the **T0 snapshot time** — which state of the plan is being solved. This is the
> same phrasing class that produced S-301's "settles unsaved board state" error; it implies no
> client-side buffer.

### 7. FR-312 — the guardrail is structurally at risk, and the risk is unmeasured

`useGenerationJob` is called **inside** the board orchestrator, not beside it:
`use-cohort-board-state.ts:129`, reached from `PlannerBoard.tsx:83`. So every `setState` in it
re-renders the island root. Today that is ~3 times per author action; a 5 s poll over a 12–20 minute
job makes it **~150–240 times**, and every tick that changes `stage_index` changes state.

The re-render chain, and what is *not* guaranteed to bail out:

```
PlannerBoard (re-runs)
 └─ useCombinedBoardState  → fresh object literals at use-cohort-board-state.ts:239, :272-288, :293-337
 └─ buildColumn ×N          → PlannerBoard.tsx:201-228 (unmemoized, per ui-conventions.md:234)
 └─ <PlannerGrid columns={columns}>  → PlannerBoard.tsx:366
     └─ groupCellOccupants ×2         → PlannerGrid.tsx:95-97 (unconditional, every render)
        └─ SlotCell × 5×10×2 = 100    → PlannerGrid.tsx:177
           └─ chipWiring fresh per cell → SlotCell.tsx:111-113
```

**There is not a single `React.memo` in the codebase.** The only `memo(` hit is a comment warning
against adding one (`SlotCell.tsx:111`). There is no store or Context isolating the grid —
`ui-conventions.md:234` records the verdict as *"hooks + spread, no store"*.

So the entire isolation guarantee rests on the **React Compiler** auto-memoizing every link of a
~5-level object-identity chain. If it holds, React bails out of the subtree; **if it breaks at any
one link, all ~100 `SlotCell`s re-render on every tick.**

**What is and is not at risk:**

- ✅ The pure constraint core is safe. `deriveCellViolations`/`deriveDropHints` are `useMemo`'d on
  placement identity (`use-board-derivations.ts:52-56,71-77`), which a poll does not touch.
  FR-312's literal wording — *"generation adds no work to the interactive validation path"* — holds.
- ⚠️ The risk is **render-time contention**: a tick landing mid-drag competes with dnd-kit's
  per-hover reactivity. That is what could push a drop past 200 ms, and the existing perf test
  (`collisions.perf.test.ts`) measures pure functions, not React — it would not see it.

**De-risking, cheapest first:** (1) isolate the strip as a self-contained component owning its own
poll state, rendered as a `BoardShell` header sibling, so `PlannerBoard` never re-runs; (2) a
`useSyncExternalStore` job store — which S-303 arguably needs anyway, since the plans list wants the
same state; (3) pause polling during an active drag (`activeDragCohort` already exists,
`PlannerBoard.tsx:101`).

**Note:** "re-proven here" (`roadmap.md:149`) has **no existing harness** —
`e2e/specs/drag-validate-feedback.spec.ts` contains no timing assertion, and the PRD's own Socrates
note concedes *"preserved is aspirational until measured"* (`prd.md:379-382`). Decide in the plan
whether the proof is a new dom-lane render-count tripwire or an explicit structural argument.

## The roadmap outcome text, clause by clause

Quoting `context/foundation/roadmap.md:141`. The precedent for this test: S-301's outcome was
corrected **twice** mid-implementation, both times because a roadmap sentence was contradicted by
measured code — `clone_plan` re-mints every course UUID (0 of 84 survive), and "settles unsaved board
state" described a draft buffer that does not exist.

| # | Clause | Verdict |
| --- | --- | --- |
| 1 | "observe a running job… by polling the durable job record" | ✅ Implementable, **100% net-new on both sides**. No `progress` column exists — progress is derived from `stage_index`/`stages`, and the denominator is not fixed (10 for `solve_complete`, 2 for `solve_repair`). Hidden cost: the React 19 wall. |
| 2 | "the plans list shows a job badge" | ✅ Implementable, net-new, unowned today. |
| 3 | "advisory 'proposal in progress from `<time>` state'" | ✅ Implementable. `<time>` = the T0 snapshot time, not a client buffer. |
| 4 | "stages stop by target (budget ceilings as backstop)" | ✅ Machinery implementable — but the sentence omits two decisions: **where a target lives** (no wire home; solver-side config is the only bump-free route) and **`stopReason` has no `target` value**. Also: a target only bites if reachable; otherwise wall-clock is unchanged. |
| 5 | "the incumbent board **+ objective tuple** is durably checkpointed" | 🔴 **Not implementable as written.** The board half is nearly free. The tuple half is contradicted in three places — `contracts/README.md:63-65` verbatim: *"the solver never holds it during the ladder… recovering a true tuple needs an `evaluate_board` re-solve."* Per-stage `best` values are **upper bounds under hardening**, not measurements. |
| 6 | "so quality accrues monotonically" | ⚠️ **True of the board, false of the record.** Hardening only runs inside `if solved:` — a stage returning neither OPTIMAL nor FEASIBLE hardens nothing and contributes no checkpoint. And `roadmap.md:36` says every stage checkpoints a *"strictly better"* board; `≤` hardening guarantees **never-worse**, not strictly-better. Both need the truth-up treatment S-301's outcome got. |
| 7 | "job state survives browser close" | ✅ Already true since F-302/S-301. **What does not survive is delivery** — it is lazy, triggered by visiting the source plan; headless delivery is S-306. Note FR-304's fuller wording adds "and container sleep", which is **S-304's**, not S-303's. |
| 8 | "editing is never blocked" | ✅ Already true; but "re-proven" has no harness (§7). |

### Resolving clause 5

Three options, and the plan must pick one explicitly:

- **(a) Rename the promise.** Checkpoint the board + the per-stage `best`/`bound` upper bounds
  already in `StageReport`. Free, contract-legal, honest. **Recommended.**
- **(b) Pay for a true tuple.** `evaluate_board` (`solve.py:136-149`) exists and was **measured at
  0.32 s** on the seed fixture — ten calls ≈ 3.2 s against a 1380 s ceiling (**0.2%**). Affordable,
  but the measurement is seed-sized on an M-series machine; re-measure on the full catalog before
  committing, and note it pins every variable and re-solves at `num_workers=1` with no time limit set.
- **(c) Hybrid.** Evaluate only at the tiers the UI actually surfaces.

Whichever is chosen, **the UI must not imply a measurement it is showing a bound for.** F-301
flagged this as a product-honesty question S-303 inherits (`context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md:350`).

## Challenges, ranked

1. **🔴 "Objective tuple" is not implementable as written** — decide (a)/(b)/(c) above and true up
   the roadmap, or this becomes S-303's mid-implementation correction.
2. **🟠 The polling loop vs React 19 + the React Compiler** — `set-state-in-effect` and
   `exhaustive-deps` both block the naive shape, and S-301's escape hatch (page frontmatter) is
   unavailable. Use `useSyncExternalStore`.
3. **🟠 FR-312 render contention** — the poll lands inside the board orchestrator with zero
   `React.memo` and an unverified Compiler memo chain. Isolate the strip or pay for a store.
4. **🟡 `stopReason` enum widening** — bilateral, byte-gated, and needed for S-304's `interrupted`
   too. Do it once.
5. **🟡 No wire home for a per-job target** — solver-side config is the only bump-free route, which
   drags in the `.dev.vars` lesson: `src/solver-container-env.ts` forwards **exactly six** keys and a
   test pins that count; a seventh breaks it deliberately, and the value must be written into
   `.dev.vars` *before* `pnpm build`. Put the fail-fast guard in the launcher script, not the service.
6. **🟡 The engine→service emission seam** — new `SolveConfig` callback, 4th `JobRowClient`
   operation, best-effort semantics, narrow PostgREST projection (a `select=*` is refused, measured 403).
7. **🟡 Grant gaps** — `stop_requested_at` ungranted entirely; `heartbeat_at` ungranted for SELECT,
   which S-304's widened CAS needs. Ship both in S-303's migration (§Downstream).
8. **🟢 Docstring truth-up is unusually large** — at least eight in-repo prose sites explicitly claim
   "nothing here loops" / "unused in F-302" / "deliberately minimal". The stale-convention lesson has
   been the highest-frequency finding in this slice family.

## Downstream coupling — get the checkpoint shape right once

| # | Decision | Make S-304/S-305 cheap by… |
| --- | --- | --- |
| D1 | **Checkpoint shape** | Store a **full `GenerationResult`** (`{placements, diagnostics}`). Then S-305's "Stop & keep" is: solver writes `status='stopped'` + copies `checkpoint` into `result`; the app widens **one predicate** (`generation-delivery.ts:87`) and the whole oracle → translate → apply → delivered-CAS chain works unchanged. A bare placements array forces a second, unverified apply route through the FR-313 trust boundary. |
| D2 | **Row-per-stage vs last-write-wins** | Already decided by F-301: single-slot, overwritten. Don't re-litigate. |
| D3 | **Write `stages` incrementally** | FR-305 requires the stop affordance to *name* the stage kept. There is no `checkpoint_stage_name` column — the name is derivable only if `stages` is already durable at stop time. Write all five columns in **one PATCH per completed stage**. |
| D4 | **Include `heartbeat_at` in that PATCH** | S-304's "activity renewal" becomes a tuning problem instead of a new timer thread. Caveat: at `stage_budget_s=120` that renews only every ~2 min, and Mode A runs to 300 s — finer resolution must come from the same solution callback S-303 is already building. |
| D5 | **Write synchronously per stage, never accumulate-and-flush** | Measured in S-302: uvicorn's shutdown completed in ~100 ms and **does not wait for the daemon solve thread**. S-304's SIGTERM handler cannot flush in-memory state — the checkpoint must already be durable. Also keep "latest completed stage" reachable from the registry entry, not only a closure in `_run_ladder`. |
| D6 | **Pre-pay the grant widening** | Decide the reclaim/stop predicate *shape* in S-303 and ship the SELECT grant in S-303's own migration — one migration, one update to the exact-list test, instead of two. |
| D7 | **Ship the stop seam, not the behaviour** | `registry.attach_solver()` (`services/solver/src/cpsat_service/registry.py:81-86`) is built and **never called**; F-302 left it deliberately. S-303 is the first slice inside `_run_ladder`, so it should call it and express stopping as a *predicate seam* on the callback. Target-stopping wires one source; S-305 wires a second. `stop_search()` was measured at 0.00 s. |

Also inherited by S-304 and easy to forget: the **app-side** stranded-`queued` window (a crash
between `insertJob` and `dispatch`) — S-304's reclaim must cover it, not only wedged-`running` rows.

## Test gates that constrain the change

- **Objective parity must stay exact 10/10** — `services/solver/tests/test_objective.py:44-48`,
  `SEED_OBJECTIVE = (0,0,97,223,0,1048,316,4,38,14)`. `parity()` takes **no `SolveConfig`**
  (`solve.py:114-133`), so a config-only change cannot reach this gate. **Preserve that insulation:
  put targets on `SolveConfig`, never in `build_objective`/`build_model`.** This is the reusable
  discipline S-301 established for clean mode.
  > The golden-dump parity test is `skipif`-gated on a gitignored dump — **a green CI does not prove
  > it.** Run it locally before claiming green.
- **Ladder behaviour** — `test_solve.py:61-70` asserts 10 stages and that every solved stage's
  hardening holds on the final board. A stage-count or hardening change breaks it directly.
- **Grant allowlist** — `test_service.py:375-397` pins the exact 11 write columns; a checkpoint write
  is **already inside** it. `test_service.py:348-373` pins the exact claim/finish PostgREST
  conversation, so a new PATCH shape needs its own pin.
- **Contract** — both suites, same commit; regenerate with `pnpm experiment:goldens` only for a
  deliberate canonical-form change.
- **Type gate** — success criteria must cite `pnpm check` / `pnpm exec astro check`, never `pnpm build`
  or `pnpm lint`. The most recent commit on `main` is literally a type-gate fix (`0c814dd`).

## Sizing

| | F-301 | F-302 | S-301 | S-302 |
| --- | --- | --- | --- | --- |
| Stated effort | ~4–5 sessions / 5 phases | ~3–4 sessions / 5 phases | ~4–5 sessions / 5 phases | ~4–5 sessions / 7 phases |
| Diffstat | 47 files, +4351/−50 | 56 files, +5317/−852 | 60 files, +4708/−154 | 39 files, +3955/−103 |
| Calendar | 2 d | 2 d | 2 d | ~4 d |
| Plan review | 4 findings | 90-line review | **3 CRITICAL** | 0C/6W/1O |

**Recommendation: 5–7 phases, ~4–6 sessions.** S-303 is the first slice that is simultaneously the
deepest new solver capability, net-new UI on two surfaces, the repo's first polling loop, and a
bilateral contract edit. **Split the engine work into its own early phase** so target-stopping and
checkpoint emission are verified before any UI is built — F-302's precedent ("the gate goes in
*before* the HTTP wrapper, so the new module is written under it rather than retrofitted").

**Calibration warning:** the one prior slice containing engine-side design (S-301) drew **3 CRITICAL
plan-review findings, two of them "unimplementable as written"** against `solve.py`/`objective.py`.
S-303's engine work is strictly larger. Budget a deep `/10x-plan-review` with symbol-level
verification — clause 5 above is already one instance of that class, found before planning started.

## Code References

**Engine**
- `services/solver/src/cpsat_engine/solve.py:362-403` — `_run_ladder`, the entire stage mechanism
- `services/solver/src/cpsat_engine/solve.py:517-534` — `_run_solver`; the only stop rule is `max_time_in_seconds`
- `services/solver/src/cpsat_engine/solve.py:31-46` — `SolveConfig`; `clean_mode` at `:46` is the config-gating precedent
- `services/solver/src/cpsat_engine/solve.py:136-149` — `evaluate_board` (measured 0.32 s on seed)
- `services/solver/src/cpsat_engine/solve.py:255-263` — why a hard target constraint is wrong
- `services/solver/src/cpsat_engine/objective.py:59-70` — the hardcoded 10-tier tuple
- `services/solver/src/cpsat_engine/wire.py:94-111` — `wire_result` canonicalizer

**Service**
- `services/solver/src/cpsat_service/supabase.py:141-167` — the claim CAS (`status=eq.queued`)
- `services/solver/src/cpsat_service/supabase.py:169-190` — the terminal write (the only other one)
- `services/solver/src/cpsat_service/runner.py:175-199` — `_solve_and_write`, batched stages
- `services/solver/src/cpsat_service/registry.py:81-86` — `attach_solver()`, built and never called

**Persistence**
- `supabase/migrations/20260810200122_generation_jobs.sql:57-98` — the table; `:20-25` the poller rule; `:83-91` the progress columns
- `supabase/migrations/20260810200931_solver_job_writer_role.sql:62-74` — the 11-column UPDATE grant; `:96-99` the RLS window
- `supabase/migrations/20260812141459_solver_select_column_scope.sql:39-49,71-72` — the 3-column SELECT narrowing
- `src/test/solver-credential.integration.test.ts:199-234` — the exact-list assertions a widening must update

**Contract**
- `contracts/README.md:54-65` — the 10-tuple is explicitly **out of scope**
- `contracts/README.md:99-110` — `stages` unsorted; `wallClockS` the sole float
- `contracts/README.md:129-141` — `formatVersion` scope and bump policy
- `src/entities/timetable/model/generation/clean-label.ts:19-38` — the ungated TS `StageReport` mirror

**App**
- `src/_pages/plan-detail/model/generation/use-generation-job.ts:25` — *"Polling is S-303's; nothing here loops"*
- `src/_pages/plan-detail/ui/generation/GenerationStatusStrip.tsx:18-20` — *"S-303 upgrades it in place"*
- `src/_pages/plan-detail/api/generation-delivery.ts:66,86,109-166,310-318` — `STATUS_COLUMNS`, the delivery branch, the delivered CAS
- `src/_pages/plan-detail/model/use-cohort-board-state.ts:129` — where the poll would land
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:83,201-228,366` — the island root and the unmemoized column build
- `src/_pages/plans-list/api/loader.ts:8-15` — `PlanRow`, with no job relationship

## Architecture Insights

- **Config-gating is what keeps the CP-SAT gate honest.** A defaulted-neutral `SolveConfig` field
  read only inside `solve_complete` is invisible to the 10/10 parity gate *by construction*, because
  `parity()` and `evaluate_board()` take no `SolveConfig`. S-301 established this for clean mode and
  explicitly called it *"a reusable discipline"*. S-303's targets should use it verbatim.
- **The database row is the only status channel.** Stated in `services/solver/README.md:51-54` and
  the root README. Everything S-303 shows the author must be a column.
- **Write-only is the correct posture for an audit record the solver authors.** The consequence is
  design-shaping: no resume-from-checkpoint, and no read-modify-write append to `stages` — every
  write is a full overwrite computed from in-process state.
- **Idempotency is the CAS, not RLS.** The RLS `with check` permits `running → running` by design;
  the guard is the `status=eq.queued` filter.
- **Monotonicity is lexicographic-prefix, not per-tier.** Later stages may worsen not-yet-hardened
  tiers and may incidentally improve hardened ones (measured: teacherHoles hardened at ≤83, final
  board scored 81). A UI implying "every number only goes down" would be wrong.
- **The engine's one-way dependency is load-bearing.** `cpsat_engine` imports nothing from
  `cpsat_service`; the emission seam must be a callback handed down, never a client imported up.

## Historical Context (from prior changes)

- `context/archive/2026-08-10-solver-contract-and-jobs-schema/` (F-301) — forward-designed the whole
  table; `research.md:45,216,224,350` carry the objective-tuple impossibility, the ~350 KB
  row-per-stage rejection, and the "bound, not a measurement" honesty question, all addressed to S-303.
- `context/archive/2026-08-11-solver-service-transport/` (F-302) — `plan.md:39` is the explicit
  exclusion list handing progress/checkpoints/stop/heartbeat/SIGTERM to S-303–S-305; `research.md:58`
  measured `stop_search()` at 0.00 s; `change.md:93-98` recorded the ~12.5-minute solve *"before
  S-303 designs progress reporting"*.
- `context/archive/2026-08-12-first-verified-proposal/` (S-301) — the two outcome corrections that
  set the precedent for this document's clause-by-clause test; `change.md:130-167` the RLS narrowing
  shipped-and-reverted; `change.md:207-216` the React 19 wall.
- `context/changes/solver-deploy-lane/` (S-302, `impl_reviewed`, not yet archived) —
  `change.md:82-88` measured that `sleepAfter` runs from the last *request* and uvicorn does not wait
  for the solve thread; `change.md:304-309` the exactly-six forwarded env keys.
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md:243,308-311` — the origin of
  *"hardware-independence comes from the stopping rule, not the budget"* and the 5–10 s cadence
  recommendation.

## Related Research

- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — the pre-roadmap exploration that
  proposed polling cadence and the badge shape
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md` — the schema/contract
  design research S-303 inherits wholesale
- `context/archive/2026-07-15-poc-cp-sat-backend-service/` — the POC whose `results.md` holds the
  per-stage budget-split findings

## Open Questions

1. **Clause 5 — bounds or a true tuple?** (a) rename the promise, (b) pay `evaluate_board` per stage,
   or (c) hybrid. Needs a full-catalog re-measurement of `evaluate_board` before (b) is chosen.
   *Owner: plan phase.*
2. **Where do target values live, and what are the placeholders?** Solver-side config is the only
   bump-free route. S-308 owns the *values*, and its prerequisite is S-304 — so placeholders will be
   live in production for at least two slices. They must be **visibly placeholders** (named constants
   pointing at S-308 / issue #105), never M-series-derived numbers quietly promoted.
3. **`stopReason` for a target stop** — widen the enum to include `target` (and a value for S-304's
   `interrupted`), or reuse `budget`? Bilateral either way; decide once.
4. **Poll cadence, and what would count as "disappoints"?** Polling is locked for this change; push
   (Realtime / WebSockets) is the recorded upgrade *"if S-303's polling UX disappoints"*
   (`roadmap.md:280`). Nothing today defines that trigger — S-303 should record one.
5. **How is FR-312 re-proven?** A new dom-lane render-count tripwire, or an explicit structural
   argument that the poll store never touches the validation path? No harness exists today.
6. **Does the poll store also serve the plans list?** If yes, that is the honest argument for a
   `useSyncExternalStore` store over a local hook — and it resolves the FR-312 isolation problem at
   the same time.
7. **Should S-303 ship S-304's `grant select (heartbeat_at)`?** One migration now vs two later, at
   the cost of a grant that S-303 itself does not use.

---

## Follow-up Research 2026-08-19T16:05+02:00 — relocating the indicator to the plans list

**Question raised by the author:** can the "proposal in progress" indicator move to the **plans list
page** instead, as an extension of plan information — and generalize to a *list* of indicators?

### Why this matters: it retires the orange FR-312 risk structurally

The research above rates the poll-inside-the-board-island as the slice's largest risk, and rates it
*unmeasurable by reading* — isolation depends on the React Compiler memoizing a ~5-level object
identity chain with zero `React.memo` in the codebase. Relocating the **poll** to `PlansHub` removes
the question rather than answering it:

| | Poll on plan detail | Poll on plans list |
| --- | --- | --- |
| Island | `PlannerBoard` (board root, dnd-kit, 100 `SlotCell`s) | `PlansHub` (only island on the page, no board) |
| Re-renders per job | ~150–240 island-root re-renders | table rows only |
| FR-312 (<200 ms drag-drop) | at risk from render contention; needs a new tripwire | **structurally unreachable** — no board on the page |
| Proof obligation | measure render counts, or argue isolation | none |

`PlansHub` is `client:load` and the only island on `PlansListPage.astro` — nothing on that page has a
latency budget.

### Recommended shape: split by cost, do not move

FR-308 (`context/foundation/prd.md:331-336`) is must-have and names the surface: *"While a job runs,
**the source plan shows** an advisory 'proposal in progress from `<time>` state' indicator."*
Removing it from plan detail is a **PRD amendment**, not a plan-level decision.

That amendment is probably unnecessary, because **the advisory indicator already ships**:
`GenerationStatusStrip` (`src/_pages/plan-detail/ui/generation/GenerationStatusStrip.tsx:36,101`)
renders status and `formatStarted(job.createdAt)` today, SSR'd from the Astro page frontmatter. What
S-303 was going to add there is *polling*, not the indicator.

| Surface | S-303 delivers | FR satisfied | Island cost |
| --- | --- | --- | --- |
| **Plan detail** — existing strip, unchanged | static advisory, SSR + manual Refresh | **FR-308** | zero (already shipped) |
| **Plans list** — new indicator cell | live status + current stage + progress, polled | **FR-304** | one extra query; no board on the page |

Accepted UX trade: after launching, the author sees "running, from `<time>`" on the board page but
not ticking stages without a Refresh or a trip to the list. For a 12–20 minute job that is
proportionate — and it is strictly better than today, where the same strip exists with no live
channel anywhere.

> **This does not dodge the React 19 wall.** `react-hooks/set-state-in-effect` applies to any island,
> so `useSyncExternalStore` over an external store remains the required shape (§6). Relocation shrinks
> the blast radius; it does not change the polling idiom.

### The "list of indicators" generalization

**Structurally cheap for this occupant.** The plans list today
(`src/_pages/plans-list/api/loader.ts:8-15`, `ui/PlansHub.tsx:100-146`) is a 5-column table whose
`PlanRow` is `{id, name, slotGridPreset, updatedAt, counts}`. Adding an indicators cell is one
`<TableCell>` plus **one extra query total** — `generation_jobs.select(...).in("status",
["queued","running"])` — which returns at most one row per plan by construction of the partial unique
index `generation_jobs_active_per_plan` (`supabase/migrations/20260810200122_generation_jobs.sql:103-104`).
It does not touch the existing `1 + 3N` count fan-out.

**Two cautions.**

1. **There is a recorded deferral to reckon with.** `PlanRow`'s docstring
   (`src/_pages/plans-list/api/loader.ts:3-6`): *"No derived quality metrics (valid / complete / used
   slots) — **explicitly deferred**."* A generalized indicator framework re-opens that decision.
2. **Most other candidate indicators are derived, and derived is expensive.** valid / complete /
   unplaced / drift all need per-plan board computation — precisely what was deferred. The generation
   badge is uniquely cheap because it reads a durable, indexed row rather than computing anything.

**Recommendation: build the slot, ship one occupant.** Add `indicators: PlanIndicator[]` to `PlanRow`
and one cell that maps over it; put exactly one indicator in it for S-303. The shape then exists for
later slices without S-303 paying for an unvalidated framework or silently reversing the deferral.

**Evidence the list shape is right, not speculative:** a second cheap, *non-derived* indicator is
already latent — **"proposal"** (this plan is a generated clone). `plans` carries no lineage column
(`id, name, slot_grid_preset, created_at, updated_at` — `src/shared/api/database.types.ts`), so a
clone is today indistinguishable from a hand-made plan in the hub, while the README warns that
proposal plans **accumulate** in production. `generation_jobs.proposal_plan_id` / `delivered_plan_id`
identify them, and the *same single query* could return it. That belongs to S-306's delivery story,
not S-303 — noted here so the indicator type is designed to accept it rather than retrofitted.

### What this changes in the plan

- The plans-list badge moves from a secondary deliverable to **the primary progress surface** — it
  carries stage/progress, not just "solving".
- `GenerationStatusStrip` is **left as-is**; the "S-303 upgrades it in place" docstring
  (`GenerationStatusStrip.tsx:18-20`) becomes stale prose to true up, not work to do.
- The FR-312 obligation drops from "build a render-count tripwire" to a one-line structural argument
  — worth still stating explicitly in the plan's success criteria.
- A new poll store lands in `plans-list` (or `shared/lib` if the strip later wants it too), not in
  `plan-detail/model/`.
- **RESOLVED 2026-08-19 (author):** FR-308 is considered **satisfied by the existing static strip**.
  No PRD amendment; the advisory stays on the source plan exactly as S-301 shipped it, and the live
  polled progress lands on the plans list. Do not re-open this in the plan phase.

### Follow-up open questions

8. Should the plans-list poll run only while at least one row is `queued`/`running`, and stop
   entirely otherwise? (Cheap, and avoids a permanent background timer on an idle hub.)
9. Does the indicator cell need a live-region/`role="status"` treatment for accessibility, given it
   changes without user action? `DriftBanner.tsx:43-78` is the in-repo `role="status"` precedent.
10. If the strip stays static, should its Refresh button remain the only manual channel, or should it
    link to the plans list as "watch progress"?
