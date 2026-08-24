# Job-Aware Container Lifecycle (S-304) Implementation Plan

## Overview

Make a running CP-SAT solve survive the platform's lifecycle (PRD FR-311, roadmap S-304): a
heartbeat timer and a latched stop seam in the solver, a SIGTERM shutdown path that marks the job
`interrupted` through the worker thread's own writer, an `onActivityExpired()` override that keeps
a solving container awake, and a fail-forward reclaim + interrupted-checkpoint delivery in the app
— proven locally, then against the deployed container with a deliberate deploy-during-solve drill.

## Current State Analysis

Established by `research.md` (2026-08-20) and re-verified against the working tree:

- **Persistence and contract are already done.** `interrupted` is in the status CHECK, the solver
  RLS `with check`, the TS union, the plans-list switch, and the wire `stopReason` enum. The
  `heartbeat_at` SELECT grant was pre-paid by S-303. **Zero DDL, zero contract edits.**
- **Checkpoints are durable but unreadable.** Every completed stage writes `checkpoint` +
  `checkpoint_stage_index` through the same wire path as the terminal write
  (`runner.py:254-268`), but the delivery gate is `status === "succeeded"` only
  (`generation-delivery.ts:89`) and `loadPayload` hard-selects `result`.
- **The stop seam exists but has no producer.** `SolveHooks.should_stop` is honoured by the engine
  (a stage ends `stoppedBy: "cancelled"`, the ladder breaks at `solve.py:624-625`) and
  `registry.attach_solver` holds the live `CpSolver` — but nothing fires either, and a cancelled
  run's `notes["outcome"] == "complete"` would make `_solve_and_write` (`runner.py:212`) write
  `succeeded`.
- **SIGTERM's 15-minute window is discarded.** The lifespan has nothing after the `yield`
  (`app.py:52-67`); uvicorn's graceful shutdown does not wait for the `daemon=True` solve thread;
  S-302 measured the whole shutdown completing inside 100 ms.
- **Sleep is an in-memory DO deadline renewed only by incoming requests.** Dispatch is
  202-and-detach, so the effective budget is `sleepAfter` (30 m stopgap,
  `src/solver-container.ts:31`) from dispatch. `renewActivityTimeout()` and an overridable
  `onActivityExpired()` (default `this.stop()`) exist in the installed
  `@cloudflare/containers@0.3.7`.
- **Nothing sweeps a wedged row.** No cron, no `scheduled` export, nothing in TS reads
  `heartbeat_at`. `claim` filters `status=eq.queued`, so a row stuck at `running` is permanently
  unclaimable and the partial unique index blocks that plan's Generate (reproduced twice in S-303).
- **Two in-repo prose claims are false** and owed corrections: `keepAlive` never existed
  (`context/changes/post-poc-cp-sat-refactoring-plan/research.md:317`), and
  `rollout_active_grace_period`'s "active" means DO-connection age, not in-flight requests
  (`wrangler.jsonc:49-62`, `README.md` § Deployment).

## Desired End State

- A deploy, sleep, or crash during a solve loses at most the in-flight stage. On SIGTERM the row
  reaches `interrupted` with the last durable checkpoint intact; the author's next visit to the
  plan delivers that checkpoint onto the proposal clone through the existing verify → translate →
  apply chain, honestly labelled as partial.
- A hard-killed solve (no SIGTERM write) leaves a `running` row whose heartbeat goes stale within
  15 s of death; within the 5-minute grace it is reclaimed to `interrupted` on the author's next
  plan visit (or at the enqueue conflict), and Generate self-heals. The `/plans` hub shows a
  stalled badge in the meantime.
- A solving container renews its own activity and is never slept mid-solve; an idle container
  sleeps after 10 minutes (down from 30), restoring prompt scale-to-zero.
- All of it proven against the deployed container: a deliberate deploy-during-solve drill, a
  >10-minute solve surviving the lowered `sleepAfter`, evidence in `wrangler tail`, and the
  production numbers S-308 needs recorded.

### Key Discoveries:

- `renewActivityTimeout()` is public ⇒ RPC-callable; `onActivityExpired()` default is `this.stop()`
  (`node_modules/@cloudflare/containers/dist/lib/container.js:748-773`). Never override `alarm()`
  (`container.js:1513-1516`).
- `progress()` already sends `heartbeat_at` on every write, is filtered `status=eq.running`, and
  never raises (`supabase.py:175-209`) — an empty-payload call is a pure heartbeat, and a late
  write cannot resurrect a reclaimed row.
- `checkpoint_stage_index IS NOT NULL` is a free existence proxy for the ~35 KB `checkpoint`
  column — the status read never has to touch the payload.
- `deriveCleanLabel` already degrades to `unavailable` when tier 5 is absent
  (`clean-label.ts:41-46`), so a checkpoint from stage < 6 needs no new label machinery.
- `GenerationDeps.getTransport` is injected (`generation-job.ts:30-33`), so the R-a retry is
  integration-testable without a live solver.
- `JobRowClient` is deliberately not thread-safe (`supabase.py:112-114`); the precedent for a
  second client is `app.py:167`.

## What We're NOT Doing

- **No claim-CAS widening.** Recovery is fail-forward (mark `interrupted`, author regenerates);
  the `status=eq.queued` filter — the only restart-surviving idempotency guard (F-302's B5) —
  stays byte-identical, as does `test_service.py:135-138`. The roadmap's "Inherited from F-302" note
  is trued up instead (Phase 6): the finding is satisfied by a reclaim actor, not by widening.
- **No redispatch / `warmStart` resume.** The wire supports it; nothing builds it here.
- **No Cron Trigger, no `scheduled` export, no new credential.** The Worker keeps only `fetch`;
  the reclaim actor runs as the `authenticated` app user where the failure is felt.
- **No migration, no contract edit, no new status value, no new forwarded container env key**
  (the six-key pin in `solver-container-env.test.ts` stays green).
- **No stop button / `stop_requested_at` write** — S-305. This slice ships the latch with one
  producer (shutdown); S-305 adds the second.
- **No objective/model changes** — objective parity stays exact 10/10 untouched.
- **No E2E (Playwright) coverage of Generate** — owned by S-306's lane, unchanged here.

## Implementation Approach

Fail-forward, one seam per layer:

1. **Solver (Python)** gains the two missing mechanics: a 15 s heartbeat on a dedicated
   `JobRowClient`, and a reason-carrying stop latch on `JobEntry` wired into
   `SolveHooks.should_stop` — plus the terminal branch that maps a cancelled run to
   `interrupted` instead of `succeeded` (D2/D3: one latched predicate, two producers; SIGTERM is
   this slice's producer, S-305's polling is the other).
2. **Lifespan shutdown** fires the latch for every live job, calls `stop_search()` on the live
   solvers, and waits (bounded) for the worker threads — the existing writer does the
   `interrupted` PATCH, so there is exactly one write path.
3. **The DO** asks the container "are you solving?" before letting the sleep proceed.
4. **The app** reclaims stale rows where the failure is felt: `checkGeneration` (on-visit,
   authoritative, CAS-guarded on staleness — explicitly superseding S-301's review objection,
   which was threshold-based and is answered by the 20× grace margin) with the enqueue-conflict
   retry as the race backstop, and the `/plans` poll displaying staleness. The same visit delivers
   an interrupted row's checkpoint through the existing chain.
5. **Proof** is two-tier: integration + a tier-3 SIGTERM drill locally, then the production drill
   — SIGTERM first at `sleepAfter: 30m`, then lower to `10m` and prove renewal on a >10-minute
   solve.

Numbers (decided in planning): heartbeat every **15 s**; stale after **5 min** (20 missed beats,
same grace for a stranded `queued` row measured from `created_at`); `sleepAfter` → **10m** only
after the production drill passes; lifespan join budget **120 s** (worst-case terminal write retry
≈ 40 s, ample margin inside the 15-minute SIGKILL window).

## Critical Implementation Details

- **Timing & lifecycle (Python).** Stop the heartbeat thread *before* `client.close()` in
  `run_job`'s `finally`. The lifespan shutdown body runs on the event loop — do the thread joins
  via `asyncio.to_thread` (or equivalent) so uvicorn's shutdown sequence isn't starved. A second
  **SIGINT** (Ctrl-C) sets uvicorn's `force_exit` and skips the lifespan entirely — a second
  SIGTERM does not (verified against uvicorn 0.52.1 `server.py:301,344-345`). Cloudflare sends
  one SIGTERM, so production is unaffected; the hazard is the tier-1 drill's double-tap.
- **Timing & lifecycle (DO).** Do not override `alarm()` — the SDK's own alarm drives the sleep
  timer, schedule dispatch and `onStop` syncing. The `containerFetch` inside `onActivityExpired`
  itself renews the deadline (in-flight requests renew), so the check is self-renewing; if the
  container is unreachable, fall through to the default stop — a container that cannot answer is
  not solving.
- **State sequencing (delivery).** In `checkGeneration`, the reclaim CAS runs *before* the
  delivery branch so a crash-wedged row becomes `interrupted` and delivers in the same visit. The
  CAS is two narrow branches (`running` + `heartbeat_at < cutoff`; `queued` + `created_at <
  cutoff`), each `.eq("status", …)`-guarded so a live job that just renewed cannot lose it. A lost
  CAS is not an error — return the current view; the next visit sorts it.
- **Second client, pinned test.** The heartbeat thread gets its own `JobRowClient` from the same
  `client_factory` (thread-safety per `supabase.py:112-114`); this deliberately breaks the
  `sign_in_count == 1` pin in `test_service.py:731-736` — update that pin as a specification
  change, not a workaround.
- **Interrupted terminal write carries no `result`.** `finish(status="interrupted",
  error="interrupted by container shutdown …", stages=…)` — the board lives in the already-durable
  `checkpoint` columns; `result` stays the succeeded-only column.
- **Cheap checkpoint existence.** Gate on `checkpoint_stage_index IS NOT NULL` in the status
  projection; read the ~35 KB `checkpoint` only once a delivery is actually happening.

## Phase 1: Solver — heartbeat timer + stop latch + interrupted outcome

### Overview

The solver-side mechanics with no producer yet: a fine-grained heartbeat so death is detectable in
seconds, a latched stop seam the engine already honours, and the terminal branch that writes
`interrupted` for a shutdown-cancelled run (fixing the `succeeded`-over-cancelled mis-write).

### Changes Required:

#### 1. Settings — heartbeat interval

**File**: `services/solver/src/cpsat_service/settings.py`

**Intent**: Add a heartbeat interval setting so tests can shrink it and production runs the
default. Not forwarded by the container (the six-key env pin stays untouched).

**Contract**: `Settings.heartbeat_interval_s: float`, default `15.0`, env
`SOLVER_HEARTBEAT_INTERVAL_S`, following the existing optional-knob pattern (invalid/non-positive
values complain on stderr and fall back to the default, mirroring `SOLVER_STAGE_TARGETS`
tolerance).

#### 2. Registry — stop latch and enumeration

**File**: `services/solver/src/cpsat_service/registry.py`

**Intent**: Give the registry the two things a shutdown needs: a per-job latched stop (with a
reason, so S-305's `stopped` and this slice's `interrupted` share one seam) and a way to stop
everything at once.

**Contract**: `JobEntry` gains `stop: threading.Event` and `stop_reason: str | None` (set once,
first writer wins). New methods, both lock-guarded: `request_stop(job_id, reason)` (fires the
event, records the reason, calls `stop_search()` on the attached solver if present) and
`stop_all(reason) -> list[threading.Thread]` (fires every entry the same way and returns the live
threads for the caller to join outside the lock). `get` stays as-is; module docstring updated —
the stop seam now has behaviour, not just a handle.

#### 3. Runner — heartbeat thread, should_stop wiring, interrupted branch

**File**: `services/solver/src/cpsat_service/runner.py`

**Intent**: (a) Start a heartbeat thread after a successful claim and stop it before the client
closes; (b) wire `SolveHooks.should_stop` to the entry's latch; (c) map a cancelled run to the
right terminal status instead of `succeeded`.

**Contract**:

- Heartbeat: a private helper owning a thread + stop `Event`; loop body is
  `event.wait(interval)` then `client.progress(job_id, {})` — an empty payload is a pure
  `heartbeat_at` renewal through the existing filtered, never-raising path. It uses a **second**
  `JobRowClient` from the same `client_factory`. Started only after `_claim` returns a row;
  stopped (event set + join) in the same scope that closes its client.
- `should_stop`: `SolveHooks(should_stop=<entry's stop-event predicate>, …)` — the deliberately
  unwired comment at `runner.py:203-206` is replaced by the wiring and a pointer to the two
  producers (lifespan now, `stop_requested_at` in S-305).
- Terminal mapping in `_solve_and_write`: **the latch is the signal** — a run whose entry has
  `stop` set with reason `"shutdown"` (checked once, after the solve returns) is terminal-written
  as `interrupted` regardless of the stage transcript, with `error` naming the interruption and
  the last completed stage, `stages` written, no `result`. Do **not** key on a
  `stoppedBy: "cancelled"` stage scan: the engine records `"cancelled"` only when `should_stop`
  fires at an improving solution, so an external `stop_search()` yields `"budget"`/`None` in real
  timings (a stop during the last stage would scan-miss and write `succeeded`; a stop before the
  first feasible solution yields outcome `"unknown"` → `failed`). The transcript is informational
  only — it supplies which stage the error message names. A latched run with no checkpoint still
  writes `interrupted`; Phase 4(d) sweeps that shape like `failed`. The cosmetic cost is accepted:
  a solve that completed milliseconds before the latch is labelled `interrupted`, but its stage-10
  checkpoint equals the final board, so delivery is lossless. The module docstring's four-shape
  outcome table gains the fifth shape.

#### 4. Tests — wrapper-level coverage of all three mechanics

**File**: `services/solver/tests/test_service.py`

**Intent**: Prove the heartbeat writes, the latch interrupts, and the mis-write is fixed — at the
HTTP-wrapper/runner level through the existing `FakeSupabase.client_factory` seam, synchronously
where possible.

**Contract**: New tests — (a) a run with a shrunk interval records extra empty-payload progress
writes each carrying `heartbeat_at`; (b) firing the latch before/mid solve produces a terminal
`interrupted` write with `stages` and no `result` — never `succeeded` and never `failed`,
including the two timing edges: a stop during the final stage (scan would say `"budget"`) and a
stop before the first feasible solution (outcome `"unknown"`); (c) the
`sign_in_count == 1` pin is updated to reflect the second client deliberately. Existing pins that
must stay byte-identical: claim filter `status=eq.queued` (`:135-138`, wire assertion at `:167`),
progress filter `status=eq.running` (`:493`, `:512`).

### Success Criteria:

#### Automated Verification:

- `cd services/solver && uv run pytest` passes with the new heartbeat/latch/interrupted tests
- `uv run mypy` (strict, src + tests) reports no errors
- `uv run ruff check` passes
- `test_service.py:135-138`'s claim-filter pin (`status=eq.queued`) is unchanged (grep-verifiable)

#### Manual Verification:

- `mise run solver:dev` + one local solve: log shows heartbeat writes every ~15 s and the row's
  `heartbeat_at` advances between stage events (Studio)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]`
checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Solver — lifespan shutdown → interrupted

### Overview

The SIGTERM producer: after the lifespan `yield`, stop every live job through the registry and
wait (bounded) for the worker threads, so the existing writer lands the `interrupted` row inside
the platform's 15-minute window. Also the `GET /jobs/active` endpoint Phase 3's DO check needs.

### Changes Required:

#### 1. Lifespan shutdown body

**File**: `services/solver/src/cpsat_service/app.py`

**Intent**: Use the one reliable hook the platform grants. On shutdown: log, fire
`registry.stop_all("shutdown")`, join the returned threads against a 120 s overall budget via
`asyncio.to_thread`, log any job that did not finish in time (its row stays `running`; the app's
reclaim is the net under it).

**Contract**: The lifespan gains a shutdown half after the `yield`; the docstring documents the
sequence, the budget, and the second-SIGTERM `force_exit` footnote. No signal handlers of our own
— uvicorn's SIGTERM handling triggers the lifespan.

#### 2. Active-jobs endpoint

**File**: `services/solver/src/cpsat_service/app.py`

**Intent**: Give the DO a dependency-free question to ask before sleeping.

**Contract**: `GET /jobs/active` → `{"active": <len(registry)>}`. In-memory only (lock-guarded
`__len__`), no database touch — answerable on a bare container, same posture as `/health`.

#### 3. Tests — shutdown end-to-end at the wrapper level

**File**: `services/solver/tests/test_service.py`

**Intent**: Prove the whole chain — a live registered job, lifespan shutdown fires, the row is
terminal-written `interrupted` — without a container, reusing the lifespan-test seam (the
`app_module.JobRowClient` monkeypatch at `:877-939`) and the `client_factory` seam together.

**Contract**: (a) a slow fake solve (loops until `should_stop`) started on a real thread is
interrupted by the lifespan shutdown and its terminal write is `interrupted` with stages; (b) the
join respects the budget (a thread that never finishes doesn't hang the shutdown); (c)
`GET /jobs/active` reports 0 idle and 1 during a registered job.

### Success Criteria:

#### Automated Verification:

- `cd services/solver && uv run pytest` passes with the shutdown + endpoint tests
- `uv run mypy` and `uv run ruff check` pass

#### Manual Verification:

- Tier-1 drill: `mise run solver:dev`, dispatch a real solve, `Ctrl-C` **exactly once** (SIGINT →
  same lifespan path; a second Ctrl-C sets `force_exit` and skips the lifespan, aborting the
  interrupted-write path) mid-solve — the row reaches `interrupted` with `checkpoint` from the
  last completed stage and `stages` written; uvicorn exits within the join budget

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Worker/DO — activity renewal (sleepAfter stays 30m)

### Overview

The job-aware stop path on the platform side: before the DO lets the sleep proceed, it asks the
container whether it is solving. Plus the two stale-prose corrections that belong to this layer.

### Changes Required:

#### 1. SolverContainer — onActivityExpired override

**File**: `src/solver-container.ts`

**Intent**: Override the default stop with: `containerFetch` `GET /jobs/active` (short timeout);
if `active > 0`, log the renewal and return without stopping; otherwise (zero, unreachable, or
malformed) fall through to the default stop. **Returning without `stop()` is what renews**: the
SDK calls `renewActivityTimeout()` itself after the override returns (`container.js:1569`), and
the `containerFetch` probe renews too — an explicit `renewActivityTimeout()` call is redundant
(harmless if kept, but the docblock must state the real mechanism so it never reads as
load-bearing). The check recurs at each subsequent `sleepAfter` expiry. Keep `sleepAfter = "30m"` — lowering is Phase 6,
gated on the production drill (D4) — but rewrite the stopgap docblock to describe the renewal and
the planned drop.

**Contract**: `override async onActivityExpired(): Promise<void>`. The response-parsing decision
(`body → number of active jobs, tolerating garbage as 0`) is extracted as a pure function beside
`solverContainerEnvVars`' pattern so it is unit-testable without the DO runtime. Logging follows
the existing `[solver-container]` lines (names and states, never env values).

#### 2. Prose corrections (platform facts)

**File**: `wrangler.jsonc`, `README.md`, `context/changes/post-poc-cp-sat-refactoring-plan/research.md`

**Intent**: True up the two falsified claims found by the research, per the stale-convention
lesson. `wrangler.jsonc:49-62` and README's deploy warning: `rollout_active_grace_period`'s
"active" is DO-connection age, not in-flight requests — the conclusion (no reliable mid-solve
protection) stands for the corrected reason; the hard no-merge rule itself **stays** until Phase 6.
The post-poc research doc gets a dated correction note at the `keepAlive` citation (`:317`): the
real APIs are `renewActivityTimeout()` / `onActivityExpired()`.

**Contract**: Comment/prose edits only; no behavioural change in this item.

#### 3. Unit test for the parse helper

**File**: `src/solver-container-active.test.ts` (beside the new helper)

**Intent**: Pin the stay-awake decision: `{"active":1}` → renew; `{"active":0}`, non-JSON, missing
field, error → stop.

**Contract**: Vitest, co-located, pure function only — the override itself is proven by tier 3 and
the production drill.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes including the new parse-helper test
- `pnpm check` (astro check) reports 0 errors
- `pnpm lint` and `pnpm steiger` pass
- `src/solver-container-env.test.ts` still pins exactly six forwarded keys (unchanged)
- `pnpm build` stays clean

#### Manual Verification:

- `mise run solver:tier3`: dispatch a solve, observe `[solver-container]` renewal log lines in the
  `wrangler dev` output while the solve runs; container still reachable afterwards

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: App — fail-forward reclaim + interrupted-checkpoint delivery

### Overview

The reclaim actor and the delivery gate, in the places the failure is felt: `checkGeneration`
(authoritative, on-visit), the enqueue conflict (race backstop), and the `/plans` poll (visibility).
This phase explicitly supersedes S-301's review rejection of a `checkGeneration` sweep: that
objection was threshold-based, and the 15 s heartbeat / 5 min grace (20 missed beats) plus a
staleness-guarded CAS answers it.

### Changes Required:

#### 1. Shared staleness model

**File**: `src/entities/timetable/model/generation/job-staleness.ts` (+ co-located test)

**Intent**: One place both page slices import the grace and the predicate from, so the reclaim and
the badge cannot disagree.

**Contract**: `HEARTBEAT_GRACE_MS = 5 * 60_000`; a pure
`isStaleActiveJob(row, nowMs): boolean` — `running` measured from `heartbeat_at` (a null
heartbeat on a running row counts as stale), `queued` measured from `created_at` (the stranded-
queued window), terminal statuses never stale. Exported through the entity barrel; `now` injected
for purity.

#### 2. checkGeneration — reclaim CAS + widened delivery gate

**File**: `src/_pages/plan-detail/api/generation-delivery.ts`

**Intent**: (a) Add `heartbeat_at` and `checkpoint_stage_index` to `STATUS_COLUMNS`/`StatusRow`;
(b) before the delivery branch, if the latest row is stale-active, CAS it to `interrupted`
(`error` naming the reclaim and the stale-since instant, `finished_at` set) and continue with the
row as interrupted — a lost CAS returns the current view untouched; (c) an `interrupted` +
undelivered row **with** a checkpoint delivers through the existing chain (a `loadPayload` variant
selecting `snapshot, checkpoint`; then `runVerifiedGeneration` → `translateCourseIds` →
`applyToProposal` → `markDelivered`, all unchanged); (d) an `interrupted` + undelivered row
**without** a checkpoint sweeps its orphan clone exactly like `failed` does today; (e)
`GenerationJobView` gains `checkpointStageIndex: number | null` so the UI can say which stage's
board was kept. Update the module docblock (the "pure read" claim gains the one deliberate
exception) and the `:92-95` comment (S-304 decided: salvage iff checkpoint).

**Contract**: The reclaim CAS is two narrow supabase-js updates guarded by
`.eq("status", <observed>)` plus `.lt("heartbeat_at", cutoff)` / `.lt("created_at", cutoff)` with
`select` so a matched-nothing is observable. `stopped` rows remain untouched (S-305). The
`cleanLabel` for a delivered partial board falls out of the existing derivation (`unavailable`
below stage 6 — honest and already handled).

#### 3. startGeneration — R-a backstop at the 23505

**File**: `src/_pages/plan-detail/api/generation-job.ts`

**Intent**: When the insert hits the partial-unique conflict, read the plan's single active row;
if stale, CAS it to `interrupted` (same helper/predicate) and retry the insert **once**; otherwise
throw `CONFLICT` exactly as today. When the reclaimed row has no checkpoint, delete its orphan
clone; with a checkpoint, leave the row and clone alone (the author is explicitly starting fresh;
the normal path — a plan visit — has already delivered it). Update the module docstring: the
stranded-`queued` window recorded there is now closed by this recovery.

**Contract**: Recovery is scoped to the conflict path — the happy path gains zero reads. The
retry re-raises `CONFLICT` if the second insert conflicts again (a genuinely live job won the
race).

#### 4. /plans poll — stalled visibility (R-b)

**File**: `src/_pages/plans-list/api/generation-status.ts`,
`src/_pages/plans-list/model/plan-indicators.ts` (+ existing co-located tests)

**Intent**: Display-only staleness: add `heartbeat_at` to the poll projection and row type;
compute `stale` at the mapping edge (injected `now`); a stale active indicator renders as
"Generating — stalled" tone `other`, linking to the plan (where the visit performs the actual
reclaim). The docblock's pure-read stance is preserved — this path still never writes.

**Contract**: `GenerationJobStatusRow` gains `heartbeat_at: string | null`;
`GenerationIndicator` gains `stale: boolean`; `describeGenerationIndicator`'s `running`/`queued`
branches split on it. Loader and poll keep projecting identically. Blast radius:
`GenerationIndicator`/`describeGenerationIndicator` are also consumed by `PlanIndicatorsCell.tsx`,
`use-generation-indicators.ts`, `job-progress-store.ts`, `api/loader.ts`, `api/plans-client.ts`,
and `PlansHub.tsx` — the `stale` field is additive and `pnpm check` will flag any required
updates, but expect touches across that surface.

#### 5. Plan-detail strip — interrupted states

**File**: `src/_pages/plan-detail/ui/` (the generation strip component reading
`GenerationJobView`)

**Intent**: Render the two new author-facing moments: an interrupted job whose partial board was
delivered ("Interrupted — kept the board from stage N of 10", linking to the proposal) and an
interrupted job with nothing kept. Semantic tokens only; no new vocabulary beyond the existing
`interrupted` status the switch already carries.

**Contract**: Consumes `status === "interrupted"`, `delivered`, `checkpointStageIndex` from the
view; wording mirrors `stageLabel`'s "stage N of 10" form via the existing tier helpers.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes: staleness predicate, indicator stalled branches, view mapping, and the
  delivery-gate unit coverage
- `pnpm check` reports 0 errors; `pnpm lint` and `pnpm steiger` pass
- `pnpm build` stays clean

#### Manual Verification:

- Local stack: hand-wedge a row (`update generation_jobs set heartbeat_at = now() - interval '10
  minutes' where …` on a running row, solver stopped) — the plan visit flips it to `interrupted`,
  delivers the checkpoint onto the clone, the strip says which stage was kept, and Generate
  re-enables
- `/plans` hub shows "Generating — stalled" for the wedged row before the visit, and the terminal
  state after

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Local proof — integration coverage + tier-3 SIGTERM drill

### Overview

Convert the manual checks into pinned integration tests, and run the full local drill on the real
container: SIGTERM mid-solve → `interrupted` → visit delivers → Generate self-heals.

### Changes Required:

#### 1. Integration suite — wedged-row recovery and interrupted delivery

**File**: `src/test/generation-lifecycle.integration.test.ts` (new)

**Intent**: Pin the app-side lifecycle end to end against the local stack, using the factories and
an injected fake transport (no solver needed): (a) a `running` row with stale `heartbeat_at` +
clone + checkpoint → `checkGeneration` reclaims, delivers the checkpoint onto the clone, marks
delivered; (b) same but no checkpoint → `interrupted`, clone swept; (c) a stale row blocks the
index → `startGeneration` recovers via the 23505 path and enqueues a fresh job; (d) a stranded
`queued` row (old `created_at`) recovers the same way; (e) a **fresh** running row is *not*
reclaimed by either path.

**Contract**: Builds state through `src/test/factories/`, cleans up via `teardown`; the checkpoint
fixture is a real `GenerationResult` shape (reuse the golden/fixture data the existing generation
tests use) so `runVerifiedGeneration` genuinely passes.

#### 2. Tier-3 drill (manual, recorded)

**File**: `context/changes/job-aware-container-lifecycle/change.md` (Notes)

**Intent**: The container-real rehearsal of Phase 6: `mise run solver:tier3`, dispatch a solve,
`docker kill -s TERM <container>` mid-solve; assert the row reaches `interrupted` with the last
checkpoint, the visit delivers, Generate works again. Record the observed shutdown duration in
change.md — the local dress rehearsal for the production numbers.

**Contract**: No code; a recorded drill with its evidence.

### Success Criteria:

#### Automated Verification:

- `pnpm test:integration src/test/generation-lifecycle.integration.test.ts` passes against the
  local stack
- Full existing integration lane still green (`pnpm test:integration` with the solver up, per
  README's two-suite note)
- `/verify` (the full local CI mirror) passes

#### Manual Verification:

- Tier-3 SIGTERM drill passes as described, evidence recorded in change.md

**Implementation Note**: Pause for manual confirmation before Phase 6 — the next phase touches
production deliberately.

---

## Phase 6: Production proof — the drill, the numbers, the dividend

### Overview

The Outcome's "proven against the deployed container": deploy, run the deliberate
deploy-during-solve drill on a throwaway plan, prove renewal at the lowered `sleepAfter`, record
the numbers S-308 needs, then claim the dividend (10m) and true up the prose the proof makes true.

### Changes Required:

#### 1. Ship phases 1–5 and run the SIGTERM drill

**File**: — (operational; evidence into `change.md`)

**Intent**: Merge to `main` (normal release path; `sleepAfter` still 30m). Seed a **throwaway
plan** in the hosted project via the UI, Generate on it, and mid-solve merge a trivial change
that **changes the container image** (e.g. a comment edit under `services/solver/` — a
Worker-only diff can leave the image digest identical and the instance untouched, per README's
"when the image changes the container rolls out") — the rollout replaces the instance and
delivers a real SIGTERM. Verify through `wrangler tail` +
Studio + the UI: the row reaches `interrupted` with checkpoint, the plan visit delivers the
partial board with the stage-N label, Generate self-heals with a fresh job.

**Contract**: The drill is run once, on purpose, on the throwaway plan only. Evidence (tail
excerpts, timestamps, shutdown duration) recorded in change.md.

#### 2. Lower sleepAfter and prove renewal

**File**: `src/solver-container.ts`

**Intent**: `sleepAfter = "10m"` (D4's gate is now passed), docblock updated to state the renewal
invariant instead of the stopgap apology. Deploy; run a >10-minute solve on the throwaway plan and
confirm via `wrangler tail` that renewal held (no mid-solve stop; the job succeeds), then that the
idle container sleeps ~10 minutes after the solve ends (scale-to-zero restored).

**Contract**: One-line config change + docblock; the proof is operational.

#### 3. Record the numbers for S-308 (D5)

**File**: `context/changes/job-aware-container-lifecycle/change.md`

**Intent**: Production-measured, per the timing rule (never M-series): cold-start time, renewal
cadence observed, sleep boundary after idle, SIGTERM-to-interrupted latency, drill solve duration.

**Contract**: A dated Notes entry; these are the only numbers S-308 may inherit.

#### 4. Prose truing the proof makes honest

**File**: `README.md`, `context/foundation/roadmap.md`, `context/foundation/prd.md`

**Intent**: (a) Soften README's no-merge-mid-solve rule to an advisory: a merge mid-solve now
interrupts the solve, completed stages are kept and delivered, Generate self-heals — avoid it when
a long solve's final stages matter. (b) True up the roadmap's S-304 "Inherited from F-302" note:
the reclaim half shipped as fail-forward (checkGeneration + enqueue backstop), the claim CAS was
deliberately **not** widened, and B5 survives. (c) Amend FR-311's trailing note the same way
(S-304 no longer "owns widening the claim CAS" — it resolved it by reclaim). Also clean up the
drill artifacts (throwaway plan + its clones/jobs) from the hosted project.

**Contract**: Prose only; each edit cites the drill evidence in change.md.

### Success Criteria:

#### Automated Verification:

- CI green on the merges (all four jobs + deploy)
- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean on the final tree

#### Manual Verification:

- Deploy-during-solve drill: row `interrupted` with checkpoint, partial board delivered, Generate
  self-heals — evidence in change.md
- Renewal proof at `sleepAfter: 10m`: a >10-minute production solve completes with no mid-solve
  stop; idle sleep occurs ~10 min post-solve
- Production numbers recorded in change.md; drill artifacts cleaned from hosted
- README advisory + roadmap/PRD truing merged

---

## Testing Strategy

### Unit Tests:

- Python (`uv run pytest`): heartbeat writes through `FakeSupabase` (interval shrunk via
  settings), latch → `interrupted` terminal mapping (never `succeeded`), lifespan shutdown
  end-to-end via the existing monkeypatch seams, join-budget behaviour, `GET /jobs/active`.
- TS (`pnpm test`): `isStaleActiveJob` boundary cases (fresh vs stale, null heartbeat, queued vs
  running, terminal), indicator stalled branches, the DO's active-jobs parse helper, delivery-view
  mapping with `checkpointStageIndex`.

### Integration Tests:

- `generation-lifecycle.integration.test.ts`: reclaim-and-deliver, reclaim-and-sweep, 23505
  recovery, stranded-queued recovery, fresh-row non-reclaim — factories + injected transport, no
  solver required.
- Existing solver-touching suites (`solver-transport`, `generation-proposal`) stay green — their
  pinned PostgREST conversations (`status=eq.queued` claim, `status=eq.running` progress) are
  deliberately untouched.

### Manual Testing Steps:

1. Tier-1: Ctrl-C mid-solve → `interrupted` + checkpoint (Phase 2).
2. Tier-3: `docker kill -s TERM` mid-solve → full recovery loop (Phase 5).
3. Production: deploy-during-solve drill on a throwaway plan; >10-minute solve at
   `sleepAfter: 10m`; idle-sleep confirmation (Phase 6).

## Performance Considerations

- Heartbeat: one ~200-byte PATCH per 15 s per running job (≤ 80 writes for a 20-minute solve) —
  negligible against the per-stage payloads already written.
- The `/plans` poll and plan-detail status read each gain one/two scalar columns; the TOASTed
  payloads stay off the wire (`checkpoint_stage_index` as existence proxy).
- The happy Generate path gains zero reads; recovery work happens only on the conflict/stale
  branches. No touch to the drag-drop validation path (FR-312 guardrail: no diff under
  `src/_pages/plan-detail/model/`'s editing orchestration).

## Migration Notes

None — zero DDL. The one schema-adjacent risk (an RLS change) is explicitly out of scope; the
solver's RLS windows and both grant allowlists are pinned by
`src/test/solver-credential.integration.test.ts` and must stay green untouched.

## References

- Related research: `context/changes/job-aware-container-lifecycle/research.md`
- Roadmap slice: `context/foundation/roadmap.md` § S-304; PRD FR-311
- Claim/progress filters (the invariants preserved): `services/solver/src/cpsat_service/supabase.py:147-209`
- Delivery chain reused for checkpoints: `src/_pages/plan-detail/api/generation-delivery.ts:112-169`
- SDK facts: `node_modules/@cloudflare/containers/dist/lib/container.js:748-773`, `:1513-1516`
- S-302's measurements (30.002 min sleep-from-last-request; 100 ms shutdown):
  `context/archive/2026-08-15-solver-deploy-lane/change.md:75-88`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Solver — heartbeat timer + stop latch + interrupted outcome

#### Automated

- [x] 1.1 `uv run pytest` passes with heartbeat/latch/interrupted tests — 8b85798
- [x] 1.2 `uv run mypy` (strict, src + tests) reports no errors — 8b85798
- [x] 1.3 `uv run ruff check` passes — 8b85798
- [x] 1.4 claim-filter pin `status=eq.queued` unchanged — 8b85798

#### Manual

- [x] 1.5 tier-1 solve shows ~15 s heartbeat renewals in log + Studio — a4ad2d0

### Phase 2: Solver — lifespan shutdown → interrupted

#### Automated

- [x] 2.1 `uv run pytest` passes with shutdown + `/jobs/active` tests — a4ad2d0
- [x] 2.2 `uv run mypy` and `uv run ruff check` pass — a4ad2d0

#### Manual

- [x] 2.3 tier-1 Ctrl-C mid-solve → row `interrupted` with checkpoint + stages, exit within budget — a4ad2d0

### Phase 3: Worker/DO — activity renewal (sleepAfter stays 30m)

#### Automated

- [x] 3.1 `pnpm test` passes including the active-jobs parse-helper test
- [x] 3.2 `pnpm check` reports 0 errors
- [x] 3.3 `pnpm lint` and `pnpm steiger` pass
- [x] 3.4 six-forwarded-keys pin unchanged
- [x] 3.5 `pnpm build` clean

#### Manual

- [ ] 3.6 tier-3 renewal log lines observed during a live solve

### Phase 4: App — fail-forward reclaim + interrupted-checkpoint delivery

#### Automated

- [ ] 4.1 `pnpm test` passes (staleness, indicators, view mapping, delivery gate)
- [ ] 4.2 `pnpm check` reports 0 errors
- [ ] 4.3 `pnpm lint` and `pnpm steiger` pass
- [ ] 4.4 `pnpm build` clean

#### Manual

- [ ] 4.5 hand-wedged row: visit reclaims + delivers checkpoint + strip labels stage + Generate re-enables
- [ ] 4.6 `/plans` hub shows stalled badge before the visit, terminal after

### Phase 5: Local proof — integration coverage + tier-3 SIGTERM drill

#### Automated

- [ ] 5.1 `generation-lifecycle.integration.test.ts` passes against the local stack
- [ ] 5.2 full integration lane green (solver up)
- [ ] 5.3 `/verify` passes

#### Manual

- [ ] 5.4 tier-3 SIGTERM drill passes, evidence recorded in change.md

### Phase 6: Production proof — the drill, the numbers, the dividend

#### Automated

- [ ] 6.1 CI green on the merges (all four jobs + deploy)
- [ ] 6.2 final tree: `pnpm check` / `lint` / `steiger` / `test` / `build` clean

#### Manual

- [ ] 6.3 deploy-during-solve drill: interrupted + delivered + self-heal, evidence in change.md
- [ ] 6.4 renewal proof at `sleepAfter: 10m` (>10-min solve survives; idle sleep ~10 min post-solve)
- [ ] 6.5 production numbers recorded; drill artifacts cleaned from hosted
- [ ] 6.6 README advisory + roadmap/PRD truing merged
