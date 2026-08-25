---
date: 2026-08-20T16:04:28+02:00
researcher: Dobromir Kropielnicki
git_commit: ae84a1fe083261ee27eb1def2dd3596a46ba806d
branch: feat/job-aware-container-lifecycle
repository: dobrek/ib-timetable-planner
topic: "Feasibility of implementing job-aware container lifecycle as roadmap slice S-304"
tags: [research, codebase, s-304, cp-sat, solver, cloudflare-containers, generation-jobs, lifecycle, sigterm, heartbeat, reclaim]
status: complete
last_updated: 2026-08-20
last_updated_by: Dobromir Kropielnicki
---

# Research: Feasibility of implementing S-304 (job-aware container lifecycle)

**Date**: 2026-08-20T16:04:28+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `ae84a1fe083261ee27eb1def2dd3596a46ba806d`
**Branch**: `feat/job-aware-container-lifecycle`
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility of implementing this change as the **S-304** roadmap task —
"a running job survives container sleep, crash, and deploy; at most the in-flight stage is lost"
(`context/foundation/roadmap.md:152-179`, PRD FR-311 at `context/foundation/prd.md:370-386`).

Scope agreed before research: the three named items (activity renewal, SIGTERM checkpointing,
widened claim CAS) **plus the reclaim actor** — the thing that must notice a stale row — because
without it the Outcome sentence is not true end to end. Platform claims were verified against the
installed SDK and live Cloudflare docs rather than taken from prior artifacts.

## Summary

**S-304 is feasible, and it is the cheapest slice in the family on paper — zero DDL, zero contract
change, zero new UI vocabulary. Its real weight is in one place the roadmap does not name: nobody
owns the reclaim actor, and the obvious candidate has no database identity.**

Four findings dominate.

1. **The platform API the design turns on is real, and better than the sketch.**
   `renewActivityTimeout(): void` is a public method on `Container` in the installed
   `@cloudflare/containers@0.3.7` (`node_modules/@cloudflare/containers/dist/lib/container.d.ts:242`,
   implementation at `dist/lib/container.js:770-773`), so it is automatically a Workers RPC method on
   the stub — the same crossing `solver-binding-transport.ts` already makes. `onActivityExpired()` is
   overridable (`container.d.ts:229`) and its default body is just `this.stop()`
   (`container.js:748-754`). Cloudflare's docs say `renewActivityTimeout` exists precisely to be
   *"called manually from background work … or a long-running operation, that should count as
   activity"*. **`keepAlive: true`, cited in the seed research, does not exist in this SDK** — grep
   returns nothing in `dist/` and it is absent from `ContainerOptions`.

2. **The SIGTERM budget is 15 minutes; we currently use 100 milliseconds of it.** Cloudflare grants
   SIGTERM → 15 min → SIGKILL identically on sleep, rollout replacement, and host eviction. S-302's
   hosted smoke measured our whole shutdown sequence completing **inside 100 ms**
   (`context/archive/2026-08-15-solver-deploy-lane/change.md:75-88`). So S-304's SIGTERM work is not
   a race against the platform — it is entirely an in-image problem, and the fix is to *use* a window
   we are already granted and currently throw away.

3. **The database is ahead of the slice, again.** `interrupted` has been in the `status` CHECK since
   day one (`supabase/migrations/20260810200122_generation_jobs.sql:96-97`), the solver's RLS
   `with check` already lists it (`20260810200931_solver_job_writer_role.sql:96-99`), `heartbeat_at`
   is in both the 5-column SELECT grant and the 11-column UPDATE grant, the TS union already carries
   `interrupted` (`src/entities/timetable/model/generation/job-status.ts:20`), the plans-list switch
   already renders it (`plan-indicators.ts:85-86`), and `stopReason` already accepts it on the wire
   (`contracts/generation-wire.schema.json:166`). **No migration, no contract edit, no new status
   vocabulary.**

4. **The reclaim half is the actual slice, and it is undesigned.** Every prior document describes the
   *predicate* (`or=(status.eq.queued,and(status.eq.running,heartbeat_at.lt.<ts>))`); none names the
   *actor*. The single actor sketch in the corpus — a staleness sweep inside `checkGeneration` — was
   proposed and **rejected** in S-301's implementation review
   (`context/archive/2026-08-12-first-verified-proposal/reviews/impl-review.md:64-66`), on the
   grounds that a wrong grace threshold fails healthy jobs. And the modern-looking answer, a Cron
   Trigger, hits a wall this research found: **the Worker has no Supabase role that can write
   `generation_jobs`** — it holds only the publishable key, `anon` is revoked on the table, and no
   service-role key exists anywhere in runtime code.

**Sizing: 6 phases, ~4–5 sessions**, with an S-302-style production tail. See § Sizing.

### Feasibility by seam

| Seam | Verdict | Why |
| --- | --- | --- |
| **Persistence (`generation_jobs`)** | 🟢 Green | Zero DDL. `interrupted` in the CHECK since F-301; RLS `with check` already lists it; `heartbeat_at` readable since S-303's migration. |
| **Wire contract** | 🟢 Green | Zero edits. `stopReason` gained `interrupted` in S-303, bump-free, goldens byte-identical. `StageReport.stoppedBy` deliberately does **not** need it. |
| **Activity renewal (Worker/DO)** | 🟢 Green | `renewActivityTimeout()` + an `onActivityExpired()` override is ~15 lines in `src/solver-container.ts`, no cron, no new credential. Lets `sleepAfter` drop back and restores prompt scale-to-zero. |
| **Heartbeat timer (solver)** | 🟢 Green | `progress()` already renews `heartbeat_at`, never raises, and is filtered so a late write cannot resurrect a row. `httpx.Client` is documented thread-safe; only the unlocked token cache needs care. |
| **SIGTERM → `interrupted`** | 🟡 Amber | Four pieces of new plumbing, not one (see §2). Testable without a container through the existing lifespan + `client_factory` seams. |
| **Widened claim CAS** | 🟡 Amber | Free in SQL and in RLS — but it deletes the only idempotency guard that survives a container restart, and it presumes a redispatcher that does not exist. |
| **The reclaim actor** | 🟠 Orange | Net-new, unowned, and the cheapest-looking host (a Cron Trigger) has no database identity. Three candidate homes, all with real objections. |
| **"Every completed stage is recoverable"** | 🟠 Orange | The checkpoint is durable but **nothing in TypeScript reads it**. Durable ≠ recoverable; making the clause true needs the delivery gate S-305 was going to build. |
| **Production proof** | 🟡 Amber | Required by the Outcome, and it means deliberately doing the thing README forbids (deploying mid-solve), once, on purpose. |

## Detailed Findings

### 1. Activity renewal — the API is real, and `sleepAfter: 30m` is a stopgap it makes unnecessary

**How the SDK actually implements sleep.** It is not a platform timer. `sleepAfter` is compared
against an **in-memory deadline** on the Durable Object:

```js
// node_modules/@cloudflare/containers/dist/lib/container.js:770-773
renewActivityTimeout() {
    const timeoutInMs = parseTimeExpression(this.sleepAfter) * 1000;
    this.sleepAfterMs = Date.now() + timeoutInMs;
}
```

and the decision is `container.js:1687-1692`:

```js
isActivityExpired() {
    if (this.inflightRequests > 0) { this.renewActivityTimeout(); return false; }
    return this.sleepAfterMs <= Date.now();
}
```

`sleepAfterMs` is `private` (`container.d.ts:292`) and **never persisted** — a DO eviction re-runs
`renewActivityTimeout()` in the constructor and grants a fresh full window. The SDK's own `alarm()`
loop keeps the DO waking **at least every 3 minutes** while the container runs (`container.js:1524`,
`:1573-1586`).

**Activity means incoming requests, and only that.** Confirmed both by construction (the manual
renewal API would be pointless otherwise) and by the current docs, which describe `onActivityExpired`
as firing *"when the `sleepAfter` timeout expires with no incoming requests"*. S-302 measured the
consequence in production: shutdown began **30.002 minutes after the last HTTP request** — the
dispatch — *not* 30 minutes after the solve ended
(`context/archive/2026-08-15-solver-deploy-lane/change.md:75-88`). Because dispatch is 202-and-detach,
the effective budget is 30 minutes **from dispatch**, and a 14.7-minute solve sits inside it with
about 15 minutes of headroom that S-308 could easily spend.

**The minimal shape.** `onActivityExpired()` is overridable and its default is `this.stop()`
(`container.js:748-754`). Overriding it to ask the container "are you solving?" before stopping is
*exactly* FR-311's "job-aware stop path", and it needs no cron, no scheduled handler, and no database
access from the Worker:

- the container answers from `JobRegistry.__len__` (`services/solver/src/cpsat_service/registry.py:105-107`),
  which already exists and is lock-guarded;
- the query itself is a `containerFetch`, which increments `inflightRequests` and renews the timeout
  on the way in (`container.js:887-890`), so the check is self-renewing;
- if the container is unreachable, falling through to `stop()` is the safe default — a container that
  cannot answer is not solving. CP-SAT releases the GIL (measured: 56 main-thread ticks through a live
  solve, `runner.py:2-4`), so a busy solver does still answer.

`schedule()` (`container.d.ts:260`) is the sanctioned alternative if a periodic tick is wanted; it
persists into a DO SQLite table and is dispatched by the SDK's own `alarm()`. **Do not override
`alarm()`** — the source carries a standing warning that container DOs always need one
(`container.js:1513-1516`), and the sleep timer, schedule dispatch and `onStop` event syncing all live
inside it.

**The dividend.** With renewal in place, `sleepAfter` can drop back from `30m`
(`src/solver-container.ts:31`) to something short. Billing stops when a container sleeps, and S-302
measured that a deploy alone starts a live instance before any solve is dispatched
(`solver-deploy-lane/change.md:150-155`) — so today every merge buys a ~30-minute idle window. That is
the ~$5/month the stopgap's own docblock admits to, and renewal is what retires it.

### 2. SIGTERM — 15 minutes granted, 100 milliseconds used

**The platform is generous and the docs are unambiguous**: SIGTERM, then *"up to 15 minutes"*, then
SIGKILL — on scale-to-zero sleep, on rollout replacement, and on host eviction alike. The SDK's own
`stop()` sends **SIGTERM only and never escalates** (`container.js:712-717`); the source comment says
so outright.

**We discard that window.** uvicorn is launched from the CLI in both the image
(`services/solver/Dockerfile:65`) and dev (`scripts/solver/dev.sh:45`), with no
`--timeout-graceful-shutdown`. Its graceful shutdown waits for ASGI connections and request tasks —
it has no knowledge of `threading.Thread` objects, and the solve runs on `daemon=True`
(`runner.py:73-79`). S-302 measured the whole sequence completing inside 100 ms. Once `main()` returns,
CPython can kill that daemon thread at an arbitrary bytecode boundary, mid-`httpx`-request included.

**The one reliable hook is the lifespan's shutdown half**, and it is empty today —
`services/solver/src/cpsat_service/app.py:52-67` has nothing after the `yield`. It runs before the
interpreter finalizes, with the loop and every thread alive, and it may block for as long as the
platform window allows.

**Four pieces of plumbing, not one.** This is where the amber comes from:

1. **A shutdown body** in the lifespan (or a signal handler installed from it). uvicorn is PID 1 in
   the container, which normally means a `SIG_DFL` disposition is ignored — but uvicorn installs its
   own handler for SIGTERM, so the signal *is* delivered. A second SIGTERM sets `force_exit` and skips
   the lifespan entirely; Cloudflare sends one, so this is a footnote rather than a hazard.
2. **A way to enumerate live jobs.** `JobRegistry` has `get(job_id)`, `release`, and `__len__`
   (`registry.py:95-107`) — no iteration, no `ids()`. A shutdown hook has no job ids to act on. This is
   the single biggest structural gap on the Python side.
3. **A latched stop flag feeding `SolveHooks.should_stop`** (unwired at `runner.py:203-206`),
   alongside `entry.solver.stop_search()`. `stop_search()` alone is *not* enough: it does not set
   `stop.fired`, so `_stopped_by` attributes the stage `"budget"` (`solve.py:823-835`), the ladder's
   `break` on `"cancelled"` never fires (`solve.py:624-625`), and the solve marches into the next tier.
4. **A `cancelled` branch in `_solve_and_write`.** Today a cancelled Mode-A run still returns
   `notes["outcome"] == "complete"`, so `runner.py:212` would write **`succeeded`** over an interrupted
   solve. This is a live gap S-305 needs too.

**The good news is that persistence is already built.** An externally stopped stage still extracts its
incumbent (`solve.py:606`) and emits a `completed` `StageEvent` carrying a full checkpoint
(`solve.py:611-623`), which `_progress_reporter` writes through the *same* wire path as the terminal
write (`runner.py:266`). S-303's D5 stated the constraint that makes this matter —
*"S-304's SIGTERM handler cannot flush in-memory state — the checkpoint must already be durable"*
(`context/archive/2026-08-19-staged-progress-and-checkpoints/research.md:449`) — and S-303 satisfied
it. **So FR-311's "the stop path persists the latest checkpoint" is largely already true; what S-304
actually adds is one PATCH marking the row `interrupted`.**

That is worth saying plainly, because it changes the shape of the work: the SIGTERM handler is a
bookkeeping step, not a data-rescue step.

### 3. Widening the claim CAS — free in SQL, expensive in invariants

**The SQL side costs nothing.** The predicate the roadmap proposes is expressible directly in
PostgREST, filters do apply to `PATCH`, and every grant it needs is already held:

```
PATCH /rest/v1/generation_jobs
  ?id=eq.<uuid>
  &or=(status.eq.queued,and(status.eq.running,heartbeat_at.lt."2026-08-20T13:41:07+00:00"))
  &select=id,snapshot_hash
```

- Postgres requires column-level SELECT on anything referenced in a `WHERE`; `heartbeat_at` was
  granted for exactly this in `supabase/migrations/20260820075348_solver_progress_select_grants.sql:33`.
- RLS admits it: `using (status in ('queued','running'))` covers the old row and
  `with check (status in ('running',…))` covers the new one
  (`20260810200931_solver_job_writer_role.sql:96-99`).
- **The timestamp must be double-quoted inside the logical tree.** `:` and `.` are reserved characters
  in PostgREST's grammar, and an unquoted ISO-8601 instant inside `or=(...)`/`and(...)` will not parse
  the way it does in a bare `heartbeat_at=lt.…` filter. This is a real, cheap-to-miss detail.

**The invariant side is where the cost is.** F-302 locked `status=eq.queued` as *the* idempotency
guard, and was explicit about why: *"The RLS `WITH CHECK` window permits `running → running`, so the
guard must be the `status = 'queued'` filter, not the policy"*
(`context/archive/2026-08-11-solver-service-transport/change.md:41-46`), and the in-process registry
cannot survive a container restart (`supabase.py:147-165`). **Widening the filter therefore removes
the only restart-surviving protection against two solvers writing one row.**

The residual risk is narrow but real: a container that is alive and solving, but partitioned from
Supabase long enough for its heartbeat to go stale, is indistinguishable from a dead one. A second
claimer would then start a second solve; both would pass `progress()`'s `status=eq.running` filter and
both would eventually call `finish`. Mitigations available without a migration: a grace period an
order of magnitude larger than the heartbeat interval, and the fact that `max_instances: 1` plus
`SOLVER_MAX_CONCURRENT_JOBS: 1` plus the in-process registry make a same-instance redispatch a 202
no-op. A generation/claim token would close it properly and costs a column, a grant, and a migration.

**But the deeper question is whether we need the widening at all** — see §4.

### 4. The reclaim actor — the actual slice, and the obvious answer does not work

Nothing in the repo sweeps anything. Verified absent across `src/`, `wrangler.jsonc` and the
migrations: no Cron Trigger, no `triggers.crons`, no `scheduled` export, no Durable Object `alarm()`
of our own, no Queues, no `pg_cron`, no `pg_net`, no maintenance endpoint, and not a single call to
`waitUntil` (it exists only as a type declaration at `src/cloudflare-env.d.ts:58`). Nothing in
TypeScript reads `heartbeat_at`, `checkpoint`, or `stop_requested_at` at all.

**The blocker for the modern-looking answer.** Cron Triggers *do* work on a Worker that also exports
a container-backed DO — Cloudflare ships an official example combining `triggers.crons`,
`containers[]`, `durable_objects` and a `new_sqlite_classes` migration. But a `scheduled` handler runs
with no author session, and:

- the Worker holds only `SUPABASE_URL` + `SUPABASE_KEY` (publishable) — `createClient` in that context
  produces an **`anon`** client;
- `anon` is revoked on `generation_jobs` (`20260810200122_generation_jobs.sql:128-129`);
- there is no service-role key anywhere in runtime code (`SUPABASE_SERVICE_ROLE_KEY` appears only in
  `src/test/**`).

So **a cron sweeper has no database identity today.** Giving it one means either a new Worker secret
(a service-role key — against the whole credential posture in
`docs/runbooks/solver-credential.md`), or having the Worker sign in as the existing machine user,
which it *can* do (it already carries `SOLVER_MACHINE_PASSWORD` as a courier) but which contradicts
the documented invariant that *"the Worker is a courier and never uses it itself"* (README §
Deployment). That would at least stay inside the same narrow role: `solver_job_writer` can SELECT
`id, status, heartbeat_at` and can move `running → interrupted`, which is precisely a sweep.

Three candidate homes, ranked by what each costs:

| # | Home | Reach | Cost / objection |
| --- | --- | --- | --- |
| **R-a** | **The enqueue path, on `23505`** — `generation-job.ts:142-146` already maps the unique-violation to `CONFLICT`. Check whether the blocking row is stale; if so mark it `interrupted` and retry the insert. | Exactly when the author is blocked | Zero new infrastructure, zero new credentials — the app writes as `authenticated`, which has `using (true) with check (true)` on this table. Covers **both** the wedged-`running` row and the app-side stranded-`queued` window (`generation-job.ts:14-17`) in one place. Objection: recovers only when someone clicks Generate. |
| **R-b** | **The `/plans` poll** — `readGenerationJobStatuses` already fires every 5 s while a job is active (`job-progress-store.ts:59`) and already holds `jobIds` + `planIds`. | While a hub tab is open | Cheap; needs `heartbeat_at` added to a six-column projection (`generation-status.ts:24`). Objection: its own docblock argues hard for staying a pure read, and S-301's review rejected a sweep-on-read for threshold reasons. **Displaying** staleness costs nothing and dodges the objection entirely. |
| **R-c** | **A Cron Trigger + `scheduled` handler** | Always | Needs `triggers.crons`, a `scheduled` export, an extension to `ExportedHandler` (which models only `fetch`, `src/cloudflare-env.d.ts:70-72`) — and a database identity it does not have. |

**The scoping consequence, and it is the most important sentence in this document.** The roadmap
prescribes widening the CAS because it implicitly assumes the recovery is a **redispatch** — a second
dispatch of the same job id that must be able to re-claim a `running` row. But there is a simpler
recovery that needs **no CAS change at all**: mark the stale row `interrupted` and let the author start
a fresh job. Under that design the existing filters do exactly what they were built for — a zombie
container's `finish` matches no row (terminal rows are outside the solver's RLS `using` window) and its
`progress` writes match nothing (`status=eq.running` is false), both of which S-303 explicitly designed
for (`supabase.py:190-199`). **Fail-and-reclaim-forward is strictly safer than redispatch, because it
preserves B5 instead of weakening it.**

Redispatch earns its keep only if the job *resumes* rather than restarts — and there, pleasingly, the
whole wire already exists: `SolveRequest.warmStart` is optional and already in both projections
(`src/entities/timetable/model/generation/wire.ts:60,153-158`), `build_dump` maps it straight to the
CP-SAT hint (`runner.py:125-149`), and `computeSnapshotHash` hashes the **snapshot only**
(`wire.ts:105`) — so re-dispatching with the last checkpoint as `warmStart` cannot break S-301's
snapshot binding. That is a genuinely attractive option; it is also strictly more work.

### 5. Persistence and contract — the schema is ahead of the slice, deliberately

Nothing here needs building. Recorded so the plan phase does not re-derive it:

- `status` CHECK allows all six values including `interrupted`, since day one, on purpose — F-301's
  research says *"Declaring the full set costs nothing and means those two slices need no migration at
  all"* (`supabase/migrations/20260810200122_generation_jobs.sql:96-97`).
- Solver RLS: `using (status in ('queued','running'))` / `with check (status in ('running',
  'succeeded','failed','stopped','interrupted'))`. `queued` is absent from `with check` on purpose —
  **a reclaim may never re-queue**; it must go `running → running` or `running → interrupted`.
- The 11-column UPDATE grant already contains `status` and `heartbeat_at`; the 5-column SELECT grant
  already contains `heartbeat_at` and `stop_requested_at`.
- `stop_requested_at` is readable but **deliberately not writable** by the solver — do not reach for it
  as a channel.
- Contract: `GenerationDiagnostics.stopReason` already allows `interrupted`
  (`contracts/generation-wire.schema.json:166`). `StageReport.stoppedBy` does **not**, and should not
  be widened — an interrupted run has no stage to attribute it to, and `parseStoredStages` would drop
  a transcript that tried (`stage-report.ts:41-44`).
- TypeScript: `GENERATION_JOB_STATUSES` already lists `interrupted` (`job-status.ts:20`), the
  plans-list switch already has its branch (`plan-indicators.ts:85-86`), and `GenerateButton` already
  re-enables on any terminal status (`GenerateButton.tsx:27`).

The only optional SQL is an index — `(status, heartbeat_at)` or a partial one — if a sweeper query
proves slow. At this scale it will not.

### 6. "Every completed stage is recoverable" — durable is not the same as recoverable

S-303 made checkpoints durable. **Nothing in TypeScript reads them.** `checkpoint` and
`checkpoint_stage_index` appear only in the generated `database.types.ts`, in comments justifying
narrow projections, and in tests. The delivery pipeline is gated `status === "succeeded" &&
delivered_plan_id === null` (`generation-delivery.ts:89`) and its loader hard-selects `snapshot,
result`, throwing when `result` is null (`generation-delivery.ts:288-299`). `stopped` and `interrupted`
clones are explicitly **not** swept, with a comment saying those states *"belong to S-305/S-304, which
will decide whether their clones are salvage or litter"* (`generation-delivery.ts:92-95`).

So the Outcome clause *"a crash, sleep, or deploy loses at most the in-flight stage — every completed
stage is recoverable"* is, today, only half-true: the data survives, and no code path can turn it back
into a board. Three ways to make the sentence honest:

- **(a) Deliver the checkpoint on `interrupted`.** Small: a status gate plus a payload selector, then
  the existing `runVerifiedGeneration` → `translateCourseIds` → `applyToProposal` → `markDelivered`
  chain works unchanged, because a checkpoint holds a full `GenerationResult` — the shape S-303's D1
  chose for exactly this reason. Needs a `cleanLabel` story for a partial transcript
  (`deriveCleanLabel` reads tier 5; a checkpoint at stage 3 has none).
- **(b) Resume via `warmStart`** on redispatch (§4).
- **(c) Redefine "recoverable" as "durably retained", and let S-305 deliver it.**

**Recommendation: (a).** It makes the roadmap sentence true, and it is the same plumbing S-305 needs —
S-305's real content is the *button* and the `stop_requested_at` write, not the delivery. Building the
shared half here shrinks S-305, which is precisely the pre-paying discipline S-303 used on this slice
(its D1–D7 table) and the reason S-304 has no migration to write today.

### 7. Proving it against the deployed container

The Outcome says *"Proven against the deployed container, not just locally"*, and that is not
decoration — S-302 is the precedent, and it is the only slice that ran 7 phases over 5 calendar days
because two of them were a human gate and a hosted smoke.

What only production can prove, and what it costs:

- **Renewal actually prevents the sleep.** Tier 3 (`mise run solver:tier3`) exercises the binding,
  `SolverContainer`, and `containerFetch` — but the sleep timer is DO-side and the local instance is
  not subject to the same lifecycle. A real proof means a solve longer than the (newly lowered)
  `sleepAfter`, watched through `wrangler tail`.
- **SIGTERM produces `interrupted` with the last checkpoint intact.** The honest drill is to deploy
  during a solve — *deliberately doing the thing README § Deployment forbids*, once, on purpose, with
  the outcome recorded. There is no other way to generate a real rollout SIGTERM.
- **The reclaim path recovers a wedged row.** S-303 already found the reproduction by accident:
  *"killing the solver mid-solve wedges the row, and the `generation_jobs_active_per_plan` index then
  refuses the next Generate on that plan"* — observed twice
  (`context/archive/2026-08-19-staged-progress-and-checkpoints/change.md:101-103`).

Note the timing rule still binds: only production numbers may be quoted. The M-series and the amd64
emulation tier are both invalid for anything S-308 will consume.

## The roadmap outcome text, clause by clause

> *"A running job survives the platform's lifecycle: activity renewal prevents scale-to-zero
> mid-solve; on SIGTERM the stop path persists the latest checkpoint and marks the job interrupted; a
> crash, sleep, or deploy loses at most the in-flight stage — every completed stage is recoverable.
> Proven against the deployed container, not just locally."*

| Clause | Verdict |
| --- | --- |
| "activity renewal prevents scale-to-zero mid-solve" | ✅ **Implementable as written.** `renewActivityTimeout()` + an `onActivityExpired()` override. Better than the sketch it came from — `keepAlive` never existed. |
| "on SIGTERM the stop path persists the latest checkpoint" | ⚠️ **True, but misleading about the work.** S-303 already made the checkpoint durable per stage; a handler that tried to *flush* one would be racing a daemon thread it cannot join. The real deliverable is the `interrupted` mark, not the persistence. Worth truing up so the plan does not budget for data rescue. |
| "and marks the job interrupted" | ✅ **Implementable.** Zero DDL; four pieces of Python plumbing (§2). |
| "a crash, sleep, or deploy loses at most the in-flight stage" | ⚠️ **Only with a reclaim actor**, which the Outcome does not mention and which no prior slice designed. |
| "every completed stage is recoverable" | ❌ **Not true as written today, and not made true by anything in the named scope.** The checkpoint is durable and unreadable (§6). Either add the delivery gate here or soften the clause. |
| "Proven against the deployed container" | ✅ **Feasible**, and it means a deliberate deploy-during-solve drill (§7). |

## Challenges, ranked

1. **🟠 The reclaim actor is unowned, and its cheapest home has no database identity.** Decide R-a /
   R-b / R-c (§4) before planning. Recommendation: **R-a for recovery + R-b for visibility**, which
   together need no cron, no new secret, and no new role.
2. **🟠 "Every completed stage is recoverable" is false today.** Pick (a), (b) or (c) from §6, or
   change the sentence. This is the same class of finding as S-303's "objective tuple" clause — caught
   before planning rather than mid-implementation.
3. **🟡 Widening the CAS deletes B5.** If the chosen recovery is fail-forward, **do not widen it at
   all** — the F-302 finding is then satisfied by a different actor, and the invariant survives intact.
   If redispatch is chosen, the grace period must be an order of magnitude above the heartbeat
   interval, and a claim token should at least be considered.
4. **🟡 The grace threshold is the hard number, and it always was.** S-301's review rejected a sweep
   precisely because *"a wrong N fails healthy jobs"*. With a timer-thread heartbeat at seconds
   resolution the problem mostly evaporates — which is the real argument for building the timer even
   though `progress()` already renews per stage.
5. **🟡 `_solve_and_write` writes `succeeded` for a cancelled run** (`runner.py:212`). A live gap,
   shared with S-305. Fix it once, here.
6. **🟡 `JobRegistry` cannot be enumerated** (`registry.py:95-107`), and it holds no `JobRowClient` and
   no `Dump` — so an external stop path cannot build a payload. Decide whether to widen `JobEntry` or
   to route everything through the worker thread (stop it, let `solve_complete` return, let the
   existing writer finish). The latter respects B12's one-way engine dependency better.
7. **🟡 The heartbeat timer and the token cache.** `httpx.Client` is documented thread-safe; the
   unlocked check-then-act in `sign_in()` (`supabase.py:132-144`) is not, and a duplicated password
   grant would break the `sign_in_count == 1` pin in `test_service.py:731-736`. Either a second
   client (precedent: `app.py:167`) or a lock. Stop the timer before `runner.py:120`'s `client.close()`.
8. **🟢 Two in-repo prose claims are false** and are inherited by this slice in good faith — see
   below. The stale-convention lesson has been the highest-frequency finding in this slice family.

## Corrections owed to in-repo prose

Both were found by verifying against the installed SDK and current docs rather than by reading. Fixing
them is part of this change's definition of done, per the lessons register.

1. **`keepAlive: true` does not exist.** `context/changes/post-poc-cp-sat-refactoring-plan/research.md:317`
   cites it with "30 s heartbeat pings". Grep over `@cloudflare/containers@0.3.7` `dist/` returns
   nothing, and it is absent from `ContainerOptions`. The two real APIs are `renewActivityTimeout()`
   and `onActivityExpired()`. (The same paragraph's `#162` citation is already known-stale.)
2. **`rollout_active_grace_period`'s "active" is not about in-flight requests.** `wrangler.jsonc:49-62`
   and `README.md:278` both say the grace period fails us because *"dispatch is 202-and-detach so
   nothing is in flight to make the instance look active"*. The current docs define the window against
   **how long the instance has been connected to its Durable Object**, not against request traffic — so
   a solving container *is* "active" by the platform's definition. **The conclusion still holds, for a
   different reason:** the window is measured from connection start, so a warm container whose
   connection age already exceeds 1200 s gets zero protection, and a cold-started 20-minute solve loses
   its protection exactly as it finishes. The no-merge-mid-solve rule stands; its stated rationale does
   not.

## Downstream coupling

| # | Decision | Consequence |
| --- | --- | --- |
| D1 | **Build the checkpoint-delivery gate here** (§6a) | S-305 shrinks to a button, a `stop_requested_at` write, and a polling predicate — its stop *seam* is already shipped. |
| D2 | **Fix the `cancelled` → `succeeded` mis-write once** (`runner.py:212`) | S-305 needs the identical branch for `stopped`. |
| D3 | **Express the stop source as one latched predicate with two producers** | SIGTERM is S-304's producer; `stop_requested_at` polling is S-305's. One seam, two sources — the shape S-303 used for target-stopping. |
| D4 | **Lower `sleepAfter` only once renewal is proven in production** | The 30 m stopgap is the safety net until the drill in §7 passes; lowering first re-opens the mid-solve sleep S-302 measured. |
| D5 | **Record the renewal cadence and the sleep boundary as production numbers** | S-308 is gated on S-304 and must not inherit an M-series-derived figure. |
| D6 | **If a claim token is ever added**, it is a column + a grant + a migration | The 11-column UPDATE grant is pinned by two integration tests; a new solver-written column must be granted, never inherited. |

## Test gates that constrain the change

- **The grant allowlists are pinned exactly** — `src/test/solver-credential.integration.test.ts:199-234`
  fixes both the 5-column SELECT list and the 11-column UPDATE list. Nothing S-304 writes falls outside
  them, so these should stay green untouched; if one goes red, the change has widened a grant.
- **The PostgREST conversation is pinned** — `services/solver/tests/test_service.py` asserts the claim
  filter `status=eq.queued` (`:142`) and the progress filter `status=eq.running` (`:493`, `:512`), plus
  `heartbeat_at` on every progress write (`:505-517`). A widened claim CAS breaks `:142` **by design**;
  that test is the specification and must be updated deliberately, not silently.
- **The daemon-thread path is untested today.** `test_service.py` monkeypatches `start_job` away and
  runs `run_job` synchronously (`:211-223`, `:237`), so no test exercises threading. A heartbeat timer
  or a shutdown hook needs a new seam; the existing `FakeSupabase.client_factory` and the
  `app_module.JobRowClient` monkeypatch used by the lifespan tests (`:877-939`) are the two to reuse —
  the latter is exactly how a shutdown body gets tested with no container.
- **Objective parity stays exact 10/10** (`SEED_OBJECTIVE`, `test_objective.py:44-48`) and the ladder
  keeps 10 stages (`test_solve.py:61-70`). Nothing in S-304 should reach the objective model; if it
  does, the design took a wrong turn.
- **`solver-container-env.test.ts:62-72` pins exactly six forwarded keys.** Any new solver env knob
  (heartbeat interval, shutdown grace) breaks it deliberately — and per the `.dev.vars` lesson, the
  value must be written into `.dev.vars` *before* `pnpm build`, with the fail-fast guard in the
  launcher script rather than the service.
- **Type gate** — success criteria cite `pnpm check` / `pnpm exec astro check`, never `pnpm build` or
  `pnpm lint`. `mypy --strict` covers `src/` **and** `tests/`; a signal handler must be typed
  `(signum: int, frame: FrameType | None) -> None`, and `CpSolver.stop_search()` is annotated upstream
  so it needs no ignore.
- **Steiger** — `src/solver-container.ts` and `src/worker.ts` sit outside `layerSequence` on purpose;
  nothing under a layer may import them.

## Sizing

| | F-301 | F-302 | S-301 | S-302 | S-303 |
| --- | --- | --- | --- | --- | --- |
| Phases | 5 | 5 | 5 | **7** | 6 |
| Success criteria | 23 | 26 | 30 | 35 | 31 |
| Diffstat | 46 files, +4346/−47 | 56 files, +5314/−850 | 60 files, +4687/−146 | 39 files, +3955/−103 | 62 files, +5045/−142 |
| Calendar | 2 d | 2 d | 2 d | **5 d** | same day |

**Recommendation: 6 phases, ~4–5 sessions.**

S-304 is unusually light on the axes that made the others heavy — **no migration, no contract edit, no
new UI vocabulary, no new status** — because F-301 and S-303 pre-paid all four. Its weight sits in
three places instead: a container-class change, four pieces of Python plumbing, and a reclaim actor
that has never been designed. A suggested split:

1. Solver — heartbeat timer + the stop-source latch (engine seam already exists).
2. Solver — lifespan shutdown → `interrupted`, including the `cancelled` mis-write fix.
3. Worker/DO — `onActivityExpired()` override + renewal; `sleepAfter` left at 30 m for now.
4. App — the reclaim actor (R-a + R-b) and the checkpoint-delivery gate.
5. Local proof — tier 3 drill + integration coverage of the wedged-row recovery.
6. **Production proof** — deploy, deliberate deploy-during-solve drill, `wrangler tail` evidence,
   record the numbers S-308 needs, then lower `sleepAfter`.

**Calibration warning.** S-302 is the closest structural analogue — same container, same requirement
to prove it in production — and it ran 7 phases over 5 calendar days, with the tail being exactly the
kind of human/production gate phase 6 above describes. Budget for a multi-day tail even though the code
is smaller. Every slice in this family has also needed a post-review fix commit; review load has been
9–10 findings each.

## Code References

**Cloudflare SDK (installed, `@cloudflare/containers@0.3.7`)**
- `node_modules/@cloudflare/containers/dist/lib/container.d.ts:242` — `renewActivityTimeout(): void`, public ⇒ RPC-callable
- `dist/lib/container.d.ts:229` — `onActivityExpired(): Promise<void>`, overridable
- `dist/lib/container.d.ts:260` — `schedule<T>(when, callback, payload?)`, the sanctioned alarm piggyback
- `dist/lib/container.js:770-773` — the renewal implementation: an in-memory deadline, synchronous
- `dist/lib/container.js:1687-1692` — `isActivityExpired`; in-flight requests renew
- `dist/lib/container.js:748-754` — default `onActivityExpired` is `this.stop()`
- `dist/lib/container.js:712-717` — `stop()` sends SIGTERM only, never escalates
- `dist/lib/container.js:1513-1516` — "container DOs ALWAYS need an alarm right now" — do not override `alarm()`

**Worker / container wiring**
- `src/solver-container.ts:31` — `sleepAfter = "30m"`, the stopgap this slice retires
- `src/solver-container.ts:51-56` — `onStop`, where a SIGTERM exit becomes visible
- `src/solver-container-env.ts:24-42` + `src/solver-container-env.test.ts:62-72` — the six forwarded keys, pinned
- `src/cloudflare-env.d.ts:70-72` — `ExportedHandler` models only `fetch`; a `scheduled` export needs this widened
- `wrangler.jsonc:49-62` — the `rollout_active_grace_period` comment that needs correcting

**Solver service**
- `services/solver/src/cpsat_service/app.py:52-67` — the lifespan; nothing after the `yield`
- `services/solver/src/cpsat_service/registry.py:95-107` — `get` / `release` / `__len__`; no enumeration
- `services/solver/src/cpsat_service/runner.py:73-79` — `daemon=True`
- `runner.py:203-206` — `should_stop` deliberately unwired
- `runner.py:212-224` — the outcome branch that would write `succeeded` over a cancelled run
- `services/solver/src/cpsat_service/supabase.py:147-172` — `claim`, the `status=eq.queued` CAS
- `supabase.py:175-209` — `progress`; filtered, best-effort, never raises
- `supabase.py:132-144` — the unlocked token cache
- `services/solver/src/cpsat_engine/solve.py:611-623` — the `completed` event carrying a full checkpoint
- `solve.py:823-835` — `_stopped_by`; an external `stop_search()` reads as `"budget"`
- `solve.py:624-625` — the ladder `break` that only a `"cancelled"` stage triggers
- `services/solver/Dockerfile:65` — uvicorn CLI, no `--timeout-graceful-shutdown`, PID 1

**Database**
- `supabase/migrations/20260810200122_generation_jobs.sql:96-97` — the six-value status CHECK
- `…:103-104` — `generation_jobs_active_per_plan`, the partial unique index
- `supabase/migrations/20260810200931_solver_job_writer_role.sql:62-74` — the 11-column UPDATE grant
- `…:96-99` — the solver's RLS UPDATE window
- `supabase/migrations/20260820075348_solver_progress_select_grants.sql:33` — `heartbeat_at` SELECT, pre-paid for this slice

**App**
- `src/_pages/plan-detail/api/generation-job.ts:14-17` — the stranded-`queued` window, assigned here
- `generation-job.ts:142-146` — `23505` → `CONFLICT`, the natural home for R-a
- `src/_pages/plan-detail/api/generation-delivery.ts:89` — the `succeeded`-only delivery gate
- `generation-delivery.ts:92-95` — `stopped`/`interrupted` clones deliberately not swept
- `generation-delivery.ts:288-299` — `loadPayload`, the one line blocking checkpoint delivery
- `src/_pages/plans-list/api/generation-status.ts:24` — the six-column poll projection
- `src/_pages/plans-list/model/job-progress-store.ts:59` — the 5 s poll
- `src/_pages/plans-list/model/plan-indicators.ts:85-86` — the `interrupted` branch, already written
- `src/entities/timetable/model/generation/job-status.ts:20` — the status union, already complete
- `src/entities/timetable/model/generation/wire.ts:105,153-158` — snapshot-only hashing; optional `warmStart`

## Architecture Insights

- **The schema has led the slices from the start, and it keeps paying.** F-301 declared all six job
  statuses on day one and S-303 pre-paid the SELECT grant this slice needs. The result is a
  correctness-critical slice with **no migration at all** — the third time forward-designed persistence
  has removed a whole phase from a downstream slice.
- **Filters, not policies, carry the concurrency semantics.** `status=eq.queued` on claim and
  `status=eq.running` on progress are the two load-bearing predicates, and RLS deliberately cannot help
  (`with check` permits `running → running`). Any lifecycle design has to reason in terms of those two
  filters, which is also why fail-forward reclaim is safer than redispatch: it uses them as built.
- **The cheapest recovery is the one that runs where the failure is felt.** The wedged row's real
  symptom is "Generate says a job is already running". Handling it at the `23505` that produces that
  message needs no scheduler, no new identity, and no threshold guessing about jobs nobody is waiting
  for.
- **A platform fact cited as a rationale is coupled to the platform.** Both prose corrections above are
  instances of the register's existing lesson about conventions that cite mechanisms — here the
  mechanism belongs to Cloudflare, and it moved. The mitigation is the same: verify the symbol, and
  prefer an invariant to a mechanism when writing the rationale down.

## Historical Context (from prior changes)

- `context/archive/2026-08-11-solver-service-transport/reviews/impl-review.md:50-68` (F-302, finding
  **F2**) — the origin of the "widen the claim CAS" scope item. Fix A (bounded retry) shipped; Fix B
  (*"let S-304's stale-heartbeat reclaim handle it"*) is the deferral, and it noted the CAS widening
  *"is not currently in its scope"*.
- `context/archive/2026-08-15-solver-deploy-lane/change.md:75-88` (S-302) — the single most important
  measurement for this slice: sleep runs 30.002 min **from the last request**, and the whole shutdown
  sequence completes inside 100 ms. Also `:150-155`: a deploy alone starts a billing window.
- `context/archive/2026-08-19-staged-progress-and-checkpoints/research.md:449` (S-303, **D5**) — *"S-304's
  SIGTERM handler cannot flush in-memory state — the checkpoint must already be durable."* And
  `change.md:98-103`: the reproduction — killing the solver mid-solve wedges the row and the partial
  unique index then refuses the next Generate.
- `context/archive/2026-08-12-first-verified-proposal/change.md:130-167` (S-301) — the RLS narrowing
  that was shipped and reverted: PostgREST's `RETURNING` makes the SELECT policy apply to the NEW row,
  measured as a 403 `42501` with the row stuck at `running`. Any RLS change here must re-run that probe.
  And `change.md:232-238`: the app-side stranded-`queued` window, assigned to S-304 by name.
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md:317-321` — the original lifecycle
  sketch and the origin of FR-311's wording. Two of its three API names check out; `keepAlive` does not.
  Its `:325` also proposed per-job-id container addressing (`getContainer(env.SOLVER, jobId)`), which
  production did not take — an unresolved tension, since it would change what "activity renewal" means.

## Related Research

- `context/archive/2026-08-19-staged-progress-and-checkpoints/research.md` — the direct predecessor;
  its D1–D7 downstream table was written to make this slice cheap, and it did
- `context/archive/2026-08-15-solver-deploy-lane/research.md` — the container config decisions and the
  first (now partly corrected) reading of the rollout grace period
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md` — the forward-designed schema
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — the pre-roadmap exploration

## Open Questions

1. **Which reclaim actor?** R-a / R-b / R-c (§4). *Owner: plan phase.* Recommendation: R-a + R-b.
2. **Do we widen the claim CAS at all?** Only redispatch needs it, and redispatch weakens B5. If the
   answer is no, the roadmap's "Inherited from F-302" note needs truing up — the finding is satisfied,
   just not the way it predicted.
3. **What is the grace threshold, and what renews at what cadence?** These are one question. A
   seconds-resolution timer makes a minutes-scale grace safe; per-stage-only renewal does not.
4. **Does "every completed stage is recoverable" get built or reworded?** §6 (a)/(b)/(c).
5. **How low does `sleepAfter` go, and when?** Not before the production drill passes. The trade is
   idle billing against cold starts on a 394 MB image (measured: ~5.5 s).
6. **Is the deploy-during-solve drill run against production, or is a staging Worker stood up for it?**
   No staging environment exists today; the drill writes real rows.
7. **Does the singleton container addressing still stand?** `getContainer(env.SOLVER, "solver")` at
   `max_instances: 1` versus the seed research's per-job-id proposal. Not S-304's to change, but S-304
   is the slice whose design would have to be redone if it ever changes.
8. **Adjacent and still unowned** (recorded, not claimed): the image has no vulnerability scanner, egress
   is unrestricted (`allowedHosts`/`deniedHosts` unset), and `pingEndpoint` is left at its default.
