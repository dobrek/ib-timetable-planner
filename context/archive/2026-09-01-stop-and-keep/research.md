---
date: 2026-09-01T14:23:39+02:00
researcher: Dobromir Kropielnicki
git_commit: 750830ac17ae274a57a2e863405b6a6337f785fc
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility and challenges of implementing stop-and-keep as roadmap slice S-305"
tags: [research, codebase, s-305, stop-and-keep, cp-sat, solver, generation-jobs, checkpoints, delivery, cancellation]
status: complete
last_updated: 2026-09-01
last_updated_by: Dobromir Kropielnicki
---

# Research: Feasibility of implementing S-305 (Stop & keep)

**Date**: 2026-09-01T14:23:39+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `750830ac17ae274a57a2e863405b6a6337f785fc`
**Branch**: `main`
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility and potential challenges of implementing the `stop-and-keep` change as
roadmap slice **S-305** — "Author can stop a running job and keep the best checkpointed board
('Stop & keep') … the affordance states exactly what will be kept — the last *completed* stage's
board, not the in-flight stage — and the kept board is delivered onto the proposal clone rather
than discarded" (`context/foundation/roadmap.md:181-198`; PRD FR-305 at
`context/foundation/prd.md:356-364`, US-302 at `:260-269`).

Scope agreed before research: a full end-to-end dive across the solver, the database, the app, and
the prior-change record, with the challenge register weighted toward **race conditions and
correctness**, **the S-306 delivery interaction**, **the UX-honesty obligation**, and **platform /
container lifecycle**.

## Summary

**S-305 is feasible, and it is materially smaller than its roadmap entry describes — the entry was
written before S-304 and S-306 shipped, and both of them pre-paid the expensive half.** The slice
needs **zero migrations, zero contract changes, and zero delivery work**. What remains is roughly
**four small Python edits, one Astro Action, one button, and one genuinely missing test**.

Five findings dominate.

1. **Everything downstream of `status = 'stopped'` already exists and is green.** `'stopped'` has
   been in the status CHECK since day one (`supabase/migrations/20260810200122_generation_jobs.sql:97`,
   with `:44` naming it "S-305's"), in the solver's RLS `with check`
   (`20260810200931_solver_job_writer_role.sql:99`), and in `GENERATION_JOB_STATUSES`
   (`src/entities/timetable/model/generation/job-status.ts:20`). S-306 shipped the delivery
   predicate that admits it — `isDeliverableJob` accepts a halted status with a checkpoint and
   `payloadColumn` already routes halted rows to the `checkpoint` column
   (`src/entities/timetable/model/generation/job-delivery.ts:61-72`,
   `src/_pages/plan-detail/api/generation-delivery.ts:476-479`) — **with two passing integration
   tests written against a hand-made `stopped` row**
   (`generation-delivery.integration.test.ts:235,257`). `job-delivery.ts:51-54` states the hand-off
   outright: *"S-305 owns the PRODUCER of a `stopped` row; admitting one for delivery is S-306's
   one-predicate down-payment on it."* **S-305 needs a producer, not a pipeline.**

2. **The one-line change is literally one line, and it is already written as a comment.**
   `services/solver/src/cpsat_service/runner.py:77-82` carries the map and its own instruction:
   *"S-305's `stop_requested_at` polling adds `"requested" -> stopped` here and nowhere else."*
   Everything the terminal write touches (`status`, `error`, `finished_at`, `stages`) is inside the
   solver's existing 11-column UPDATE grant, and `stopped` is inside its RLS `with check`.

3. **The roadmap overstates the stop mechanism's latency, and this is the biggest real risk.**
   `SolveHooks.should_stop` is polled **only at improving solutions** — there is no timer in the
   engine (`services/solver/src/cpsat_engine/solve.py:758-788`) — and `stop_search()` is a no-op
   unless a solve is in flight on the attached handle
   (`.venv/…/ortools/sat/python/cp_model.py:1781-1785`). A stage that finds no improving solution
   runs its **full budget**: 120 s for a ladder tier, 300 s for Mode A (`solve.py:124-126`). Add the
   15 s heartbeat poll interval (`settings.py:53`) and the honest worst case from click to terminal
   row is **~5 minutes**, not "immediately". The affordance must not promise otherwise.

4. **The roadmap's ladder-break claim is true only for the predicate-observed path**, and S-305 must
   inherit S-304's decision rather than the roadmap's sentence. `roadmap.md:188-190` says a stopped
   stage "records `stoppedBy: "cancelled"` and the ladder breaks out". That happens only when
   `should_stop` fires *inside* the solution callback. An asynchronous latch — which is what a
   `stop_requested_at` poller produces — typically leaves the stage reading `"budget"` (FEASIBLE) or
   nothing (UNKNOWN), and the ladder breaks one tier later. S-304 already hit this and resolved it:
   **key the terminal write on the latch, never on a transcript scan**
   (`context/archive/2026-08-20-job-aware-container-lifecycle/plan.md:206-218`, its plan-review's
   CRITICAL F1). A transcript scan would write `succeeded` over a stop during the last stage.

5. **FR-305's "mirroring the greedy path's existing cancel semantics" is stale — there is nothing
   left to mirror.** The greedy "Stop & keep" button died with S-301, and `GenerateButton.tsx:17-19`
   carries its epitaph: *"It used to own a whole ~20 s greedy solve — elapsed vs budget, 'Stop &
   keep' — and none of that survives … a stop path that works from a closed tab is S-305's."* The
   semantics have to be restated from the checkpoint model, not inherited from a deleted affordance.

There is also one pleasant surprise that cuts against the PRD's stated fear (§UX honesty below):
the code keeps **more** than FR-305 promises, not less.

**Verdict: ready to plan now.** The roadmap's own gate — *"Promotes to `ready` once S-303 done"*
(`roadmap.md:279`) — is satisfied, and S-304/S-306 landing since have shrunk the slice further.

---

## Detailed Findings

### 1. The database layer — zero migrations owed

Every persistent thing S-305 needs was pre-paid, deliberately and by name.

| Need | Status | Evidence |
| --- | --- | --- |
| `stop_requested_at timestamptz` | exists, nullable, no default | `supabase/migrations/20260810200122_generation_jobs.sql:81` |
| `'stopped'` in the status CHECK | exists | `:97`, declared as S-305's at `:44` |
| `'stopped'` in the solver's RLS `with check` | exists | `20260810200931_solver_job_writer_role.sql:99` |
| Solver may **SELECT** `stop_requested_at` | granted | `20260820075348_solver_progress_select_grants.sql:33` |
| Solver may **UPDATE** `stop_requested_at` | **deliberately NOT granted** | `20260820075348:16-19` |
| `authenticated` may write the flag | yes — table-wide UPDATE, `using(true) with check(true)` | `20260617171048_grant_authenticated_table_access.sql:14-16`; `20260810200122:117-118` |
| `checkpoint` + `checkpoint_stage_index` | exist | `20260810200122:83-91` |

The grant asymmetry is the design, not an oversight — `20260820075348:16-19`:

> *"UPDATE on `stop_requested_at` is DELIBERATELY NOT granted, and that asymmetry is the point: the
> app writes the stop request and the solver only ever observes it. A solver that could clear its own
> stop flag would be able to ignore Stop & keep, so the read stays one-way at the grant layer rather
> than by convention."*

Two exact-list integration pins police any attempt to widen it:
`src/test/solver-credential.integration.test.ts:211-217` (the 5 readable columns) and `:224-236`
(the 11 writable ones). **If either goes red, the change has widened a grant** — which for S-305
would mean it took a wrong turn.

There is **no SQL function on `generation_jobs` at all** — no `claim_job`, no RPC. Every write is a
plain PostgREST PATCH. So `lessons.md`'s "re-create SQL functions from the latest live definition"
rule does not fire here; the rule that *does* is the policy-name pin in the credential test.

**One structural note, not a blocker:** there is no ownership model in this database. `plans` has no
owner column, and every RLS policy is `using (true) with check (true)`. So "the author's own job" is
a session-level concept enforced by `src/middleware.ts`, not a row-level one — any authenticated
user can stop any job. Consistent with the whole single-tenant app; worth stating rather than
implying a per-author guarantee.

### 2. The solver — four small edits and one missing test

#### The seam, as actually built

`SolveHooks` (`services/solver/src/cpsat_engine/solve.py:95-117`) exposes `on_stage`, `on_solver`
and `should_stop`, and its docstring already instructs S-305:

> *"It must also be TOTAL: … this one runs inside OR-tools' solution callback, where a raise surfaces
> through the pybind layer in a way the engine does not define. **Wrap it before wiring it (S-305).**"*

Today `runner.py:252` passes `entry.stop.is_set` — an `Event.is_set` cannot raise. **A poller wired
directly into `should_stop` could**, so the latch must stay the thing the predicate reads and the
poll must set the latch from outside. That is exactly the shape `registry.py:18-20` describes:
*"One latch, two producers: the lifespan's SIGTERM path fires it with reason `"shutdown"` (S-304),
and S-305's `stop_requested_at` polling will fire it with its own."*

`_latch` (`registry.py:149-169`) is first-writer-wins, sets the `Event`, then calls `stop_search()`
last and only as a speed-up. `stop_search()` is lock-guarded and safe from another thread
(`ortools/sat/python/cp_model.py:1781-1785`); the solve runs on a plain daemon thread
(`runner.py:104-113`), and an earlier empirical probe measured `stop_search()` returning in 0.00 s
(`context/archive/2026-08-11-solver-service-transport/research.md:58`).

#### What is missing

| # | Change | Where |
| --- | --- | --- |
| 1 | Read `stop_requested_at` — `JobRowClient` has **no read method at all** (only `sign_in`, `claim`, `progress`, `finish`) | `services/solver/src/cpsat_service/supabase.py:112-284` |
| 2 | Let the heartbeat thread fire `registry.request_stop(job_id, "requested")` — it currently receives only `(job_id, client, interval_s)` | `runner.py:388-435` |
| 3 | `"requested": StopOutcome(status="stopped", cause=…)` in `STOP_OUTCOMES` | `runner.py:80-82` |
| 4 | Parameterise `_stop_error`'s hardcoded `"interrupted by …"` prefix | `runner.py:354-365` |
| 5 | A test firing `request_stop` against a **real live solve** | `services/solver/tests/` |

**Recommended shape for (1): widen the existing heartbeat PATCH rather than add a GET.**
`progress` already issues `PATCH … id=eq.<id>&status=eq.running` with `Prefer: return=representation`
and `select=id`, parses the response, and **never raises** (`supabase.py:175-209`). Changing the
projection to `select=id,stop_requested_at` delivers the flag **in the same round-trip as the
heartbeat** — no new request, no new thread, no new grant, and the `status=eq.running` filter means a
terminal row simply stops answering. Two constraints to preserve: the never-raises contract, and the
15 s cadence (`DEFAULT_HEARTBEAT_INTERVAL_S`, `settings.py:53`), which becomes the stop poll's
granularity.

**(4) is a real user-facing bug, not polish.** `_stop_error` hardcodes:

```python
return (
    f"interrupted by {stop.cause}: the solve was stopped {where} — the board kept is the last "
    "completed stage's checkpoint, not a finished ladder"
)
```

An author-requested stop would render *"interrupted by the author's stop request"* — and `interrupted`
is a sibling status with a different meaning. This string reaches the author through
`GenerationJobView.error` (`src/_pages/plan-detail/api/generation-delivery.ts:103`).

#### The coverage hole

`services/solver/tests/test_stage_stop.py` tests the `should_stop`-predicate path against the real
engine thoroughly (`:259` one stage cancelled and the ladder ends; `:278` the incumbent board
survives — *"Stop & keep is only possible if a cancelled run keeps its board"*). But **every SIGTERM
test substitutes a fake `solve_complete`** (`test_service.py:1209-1222` is a `while` loop polling the
hook), so **the "immediate `stop_search()` from another thread against a live CP-SAT solve" path is
wired and unproven** — and that is precisely the mechanism the roadmap advertises as inherited. One
new test earns its keep here, and it is also where the honest latency number for the UI copy comes
from.

Note `test_service.py:887` already asserts first-recorded-reason-wins by firing `"shutdown"` then
`"requested"` — S-305's reason string is anticipated in the existing suite.

### 3. The app — a button, an action, and one narrow projection

The generation actions factory has exactly two members today — `startGeneration` and `checkPlan`
(`src/_pages/plan-detail/api/generation-actions.ts:20-28`). **There is no cancel or stop action, and
nothing anywhere writes `stop_requested_at`.**

Adding one follows the established rule (`lessons.md:19-24`): a `defineDomainAction` with a shared
Zod input, `requireSession → requireSupabase → runDomain(…)`, and a framework-free domain function.
This is also the *only* credential the project will accept — S-304 refused a session-free write
identity twice (a service-role Worker secret, and the Worker signing in as the machine user;
`context/archive/2026-08-20-job-aware-container-lifecycle/research.md:255-266`), and the solver is
barred from the column at the grant layer. So the stop write has exactly one legitimate actor: the
author's own authenticated request.

#### Where the button belongs

**`PendingProposalPage.tsx` is the near-free home.** It already polls (`use-pending-proposal.ts`,
over the shared `@/shared/lib/polling-store` factory), and its `GenerationJobView` already carries
`checkpointStageIndex`, `stageIndex` and `stageName`
(`src/_pages/plan-detail/api/generation-delivery.ts:91-113`), with `tierLabel` already imported into
the page (`PendingProposalPage.tsx:2`). **So FR-305's "name the stage being kept" obligation is
satisfiable with no data-layer change at all.** The page's own docblock also settles the FR-312
objection in advance: *"A *pending* proposal has no board either … So the same structural argument
permits the loop, rather than an exception being carved for it."*

The **hub** is the expensive alternative. `src/_pages/plans-list/api/generation-status.ts` produces a
deliberately narrow 10-key indicator that **excludes `checkpointStageIndex`**, and
`generation-status.integration.test.ts:230-241` pins that key set as an exact list with a comment
saying it *"must be updated deliberately, never to make a red test green"*. A hub-side affordance
that names the stage costs a projection widening plus a deliberate edit to that pin.

Either way, showing a "Stopping…" state needs `stop_requested_at` added to `STATUS_COLUMNS`
(`generation-delivery.ts:117-118`) — one narrow, payload-free column, consistent with the standing
discipline that pollers project explicitly because `snapshot` is ~124 KB and `checkpoint` ~35 KB
(`20260810200122:20-25`).

#### The copy that already exists

`GenerationStatusStrip.tsx:176-179` already writes the halted summary:

```ts
const haltedSummary = (checkpointStageIndex: number | null): string =>
  checkpointStageIndex === null
    ? "Stopped — nothing was kept."
    : `Stopped early — kept the board from stage ${String(checkpointStageIndex)} of ${String(LADDER_TIER_COUNT)}.`;
```

Note it already says *"Stopped"* for an **interrupted** job — so the strip's vocabulary was written
for S-305 and is currently mildly wrong for S-304's case. Worth truing up in the same diff.

### 4. Delivery — already built, and idempotent

The full chain (`generation-delivery.ts`) is `reclaim CAS → deliverability gate → oracle verify →
id translation → apply onto the proposal → clear `pending_proposal` → delivered-marker CAS (last)`.
It is idempotent across both entry points (source id and proposal id), documented as crash-safe
because the marker is written last, and already exercised concurrently in the integration suite
(`context/archive/2026-08-25-drift-decided-delivery/plan.md:26-29,684-686`).

A `stopped` job enters this chain **unchanged**, because the checkpoint is a full `GenerationResult`
— byte-identical shaping to a terminal `result`, deliberately (`solve.py:635-644`; PRD's 2026-08-20
true-up at `prd.md:340-346`). That was S-303's decision D1, made for exactly this reason
(`context/archive/2026-08-19-staged-progress-and-checkpoints/research.md:445`):

> *"Then S-305's 'Stop & keep' is: solver writes `status='stopped'` + copies `checkpoint` into
> `result`; the app widens **one predicate** … and the whole oracle → translate → apply →
> delivered-CAS chain works unchanged."*

In the event even that copy is unnecessary: `payloadColumn` reads `checkpoint` directly for halted
statuses, so the solver's `finish` deliberately sends **no `result`** (`runner.py:265-266`).

One ordering rule S-305 must not break (`drift-decided-delivery/plan.md:132-137`): every
**terminal-without-delivery** branch must clear `plans.pending_proposal` on any clone it leaves
alive, or the plan is stranded read-only. A `stopped`-with-no-checkpoint row is `isSweepableJob`, so
it takes the `failed` path — already handled, but it is the branch to test.

---

## Challenge Register

Ordered by how much they should shape the plan.

| # | Challenge | Severity | Owner |
| --- | --- | --- | --- |
| C1 | **Stop latency is up to ~5 minutes in the worst case**, not sub-second: `should_stop` fires only at improving solutions, `stop_search()` no-ops between solves, an unproductive stage burns its full 120 s / 300 s budget, and the poll adds ≤15 s. The affordance and the confirm copy must be honest about this. | HIGH | plan (copy) + a measured test |
| C2 | **Do not key the terminal status on the transcript.** An async latch usually leaves `stoppedBy: "budget"`, so a stage scan would write `succeeded` over a stop in the last stage and `failed` over a stop before the first feasible solution. Copy S-304's latch-is-the-signal decision verbatim. | HIGH | plan |
| C3 | **`stop_search()` from another thread against a live CP-SAT solve is untested.** Every existing shutdown test fakes the solve. This is the inherited mechanism; one real test is the highest-value item in the slice. | HIGH | plan (testing strategy) |
| C4 | **A stop on a `queued` row is a write into a void.** The claim CAS filters `status=eq.queued` and does not consult the flag (`supabase.py:167`); the registry can only latch a *registered* job. Three options — tighten the CAS with `stop_requested_at=is.null` (solver-side, allowed by the existing SELECT grant), terminalise app-side to `stopped` with no checkpoint (allowed; the row is then `isSweepableJob` and the clone is swept), or disable the button while queued. **Needs an explicit decision.** | MEDIUM | plan |
| C5 | **A stop cannot reach a dead or sleeping container.** Nothing polls if the container is gone, so the row sits until `generation-reclaim.ts` sweeps it after `HEARTBEAT_GRACE_MS` (5 min) — and it lands `interrupted`, not `stopped`, because S-304 deliberately left `stopped` out of the reclaim CAS (`job-aware-container-lifecycle/plan.md:430`). The author who pressed Stop then sees "Interrupted", which reads as a platform failure rather than their own act. Delivery is identical either way (`isHaltedJobStatus`), so this is copy/observability, not correctness. | MEDIUM | plan |
| C6 | **Stop-vs-completion race.** If the solve finishes first, `progress`'s `status=eq.running` filter matches nothing, the poll never fires, and the job lands `succeeded` with a full board — benign and correct. The UI must handle "I pressed Stop and got a complete board" without looking broken. | MEDIUM | plan (UI states) |
| C7 | **The UX-honesty obligation cuts the opposite way from the PRD's fear.** FR-305 guards against the author believing they kept *more* than they did. The code keeps more than promised: a cancelled-but-FEASIBLE stage checkpoints its incumbent *before* breaking (`solve.py:605-625`). Under-promising is safe, but the copy must not be justified by a mechanism that isn't there (`lessons.md:68-73`). | MEDIUM | plan (copy) |
| C8 | **Doc drift — the highest-frequency finding in this slice family.** S-305's diff falsifies at least eight in-code comments that name it as future work: `registry.py:19`, `runner.py:77`, `supabase.py:186-188`, `job-delivery.ts:51-54`, `GenerateButton.tsx:17-19`, `20260820075348*.sql:14-19`, `GenerationStatusStrip.tsx:176-179`, plus the roadmap and PRD entries. S-303 gated this with a grep in its success criteria — copy that. | MEDIUM | plan (success criteria) |
| C9 | **`_stop_error` renders "interrupted by the author's stop request"** for a `stopped` row, and the string is author-facing. Parameterise the prefix. | MEDIUM | impl |
| C10 | **Where the button lives is a cost decision.** `PendingProposalPage` is free (already polls, already holds `checkpointStageIndex` + `tierLabel`). The hub costs a projection widening plus a deliberate edit to the pinned 10-key indicator list at `generation-status.integration.test.ts:230-241`. | LOW-MED | plan |
| C11 | **If any field joins the poll snapshot, it must join `sameView` too.** The equality gate silently defeats republishing otherwise — this was finding F5 of `extract-share-polling-store`, and `cleanLabel` needed a structural comparison because it is a fresh object every tick. | LOW-MED | impl |
| C12 | **FR-305's "mirroring the greedy path's existing cancel semantics" is stale.** The affordance was deleted by S-301 on 2026-08-13; `GenerateButton.tsx:17-19` is its epitaph. The PRD line should be trued up rather than followed. | LOW | plan (PRD note) |
| C13 | **First-writer-wins on the latch** means a stop racing a deploy SIGTERM yields whichever landed first (`registry.py:149-153`, pinned by `test_service.py:887`). Both deliver identically; only the copy differs. Accepted, worth naming. | LOW | — |
| C14 | **No per-author ownership exists** — any authenticated user can stop any job. Consistent with the app; do not claim otherwise in copy. | LOW | — |
| C15 | **`src/shared/lib/` is at the steiger child ceiling** (15 of 15 after `polling-store`). A new shared folder would trip it. | LOW | impl |

---

## Code References

- `supabase/migrations/20260810200122_generation_jobs.sql:44,81,83-91,97` — `'stopped'` declared as S-305's; `stop_requested_at`, `checkpoint`, `checkpoint_stage_index`
- `supabase/migrations/20260810200931_solver_job_writer_role.sql:62-74,96-99` — the 11-column UPDATE grant and the solver RLS policy already admitting `stopped`
- `supabase/migrations/20260820075348_solver_progress_select_grants.sql:16-19,33` — the deliberate read-only asymmetry on `stop_requested_at`
- `services/solver/src/cpsat_engine/solve.py:95-117` — `SolveHooks`, and the "wrap it before wiring it (S-305)" instruction
- `services/solver/src/cpsat_engine/solve.py:124-126,605-625,758-788,823-835` — stage budgets, the checkpoint-then-break path, `_StageStop`, `_stopped_by`
- `services/solver/src/cpsat_engine/solve.py:635-644` — the checkpoint is a self-contained deliverable `SolveResult`
- `services/solver/src/cpsat_service/registry.py:18-20,47-63,149-169` — the two-producer latch
- `services/solver/src/cpsat_service/runner.py:64-88,259-276,320-334,354-365,388-435` — `STOP_OUTCOMES`, the latch-keyed terminal write, the checkpoint payload, `_stop_error`, `_Heartbeat`
- `services/solver/src/cpsat_service/supabase.py:147-173,175-209,211-232` — claim CAS (still `status=eq.queued`), `progress` (never raises), `finish`
- `src/entities/timetable/model/generation/job-delivery.ts:51-72` — `isDeliverableJob` / `isSweepableJob` / `isHaltedJobStatus`, and the S-305 hand-off note
- `src/entities/timetable/model/generation/job-status.ts:20-29` — the status union and active/terminal helpers
- `src/_pages/plan-detail/api/generation-actions.ts:20-28` — the two existing actions; no stop action
- `src/_pages/plan-detail/api/generation-delivery.ts:91-113,117-118,476-479` — `GenerationJobView`, `STATUS_COLUMNS`, `payloadColumn`
- `src/_pages/plan-detail/ui/PendingProposalPage.tsx:1-60` — the page that already polls and already holds the stage data
- `src/_pages/plan-detail/model/generation/use-pending-proposal.ts:1-45` — why this island may loop where the board island may not
- `src/_pages/plan-detail/ui/chrome/GenerateButton.tsx:17-19` — the deleted greedy affordance's epitaph, naming S-305
- `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:95,133-137,176-179` — the halted summary copy
- `src/_pages/plans-list/api/pending-guards.ts:1-40` — `assertNotPending` / `assertNoActiveJob`, both already halted-aware
- `src/_pages/plans-list/api/generation-status.integration.test.ts:230-241` — the pinned 10-key indicator list
- `src/test/solver-credential.integration.test.ts:211-217,224-236` — the exact-list grant pins

## Architecture Insights

- **Pre-paying is this project's dominant pattern, and it worked.** Three consecutive slices left
  named seams for S-305 — a column, a status value, an RLS window, a SELECT grant, a latch with two
  documented producers, a delivery predicate, and a strip branch. The result is that the slice's
  cost is now concentrated almost entirely in *one Python dict entry and one button*.
- **The latch is the signal; the transcript is informational.** This is the single most reusable
  decision in the family (S-304's CRITICAL plan-review finding), and it exists because CP-SAT's
  callback only observes what it observes. Any future stop source inherits it.
- **Grant-layer asymmetry as a design tool.** The solver *cannot* clear its own stop flag, so "the
  solver honours Stop & keep" is enforced by Postgres rather than by discipline.
- **Narrow projections are correctness-adjacent, not an optimisation** — a standing 5 s poll over a
  124 KB `snapshot` column. Every read of `generation_jobs` in the app projects explicitly.
- **Structural arguments beat measured ones for the FR-312 guardrail.** Both places that poll (the
  hub, the pending proposal page) are permitted because they render no board, not because a
  measurement said polling was cheap enough.

## Historical Context (from prior changes)

- `context/archive/2026-08-19-staged-progress-and-checkpoints/change.md:104-107` — S-303's closing
  hand-off: *"the seam is wired and tested … **Owed: the button, the write, and the predicate that
  polls the column.**"* Still an accurate description of the remaining app-side work.
- `context/archive/2026-08-19-staged-progress-and-checkpoints/research.md:445` — decision D1, storing
  a full `GenerationResult` as the checkpoint *specifically* so S-305 would be a one-predicate change.
- `context/archive/2026-08-19-staged-progress-and-checkpoints/reviews/plan-review.md:95` — F6, the
  cascade hazard, resolved inside S-303 by breaking the ladder after a cancelled stage.
- `context/archive/2026-08-20-job-aware-container-lifecycle/plan.md:206-218` — the latch-not-transcript
  rule, and `:430` — *"`stopped` rows remain untouched (S-305)"*, the source of C5.
- `context/archive/2026-08-20-job-aware-container-lifecycle/research.md:255-266` — the two refused
  session-free write credentials, which is why the stop write must be the author's own request.
- `context/archive/2026-08-25-drift-decided-delivery/plan.md:294-295` — the deliverability predicate
  including `stopped` from the start; `:63-65,114-115` — *"No `stopped` producer — S-305's."*
- `context/archive/2026-08-31-extract-share-polling-store/` — the shared polling factory, its F5
  equality-gate finding (C11), and its open F1 (the hub snapshot is keyed by source `planId`, so two
  jobs on one source collapse — relevant if the stop affordance ever moves to the hub).
- `context/archive/2026-08-11-solver-service-transport/reviews/impl-review.md:40-68` — F1/F2, the
  wedged-row and lost-board races that shaped the current retry and CAS discipline.
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md:291,299` — the origin of the
  affordance and its business framing: *"the author sees quality accrue stage by stage and can stop
  when satisfied — which is solve-to-target with a human in the loop."*

**Applicable lessons** (`context/foundation/lessons.md`): Actions-as-single-transport (`:19-24`) for
the stop write; `pnpm check` as the only type gate (`:54-59`) for the consumer sweep; semantic theme
tokens (`:12-17`) for the new button and any badge tone; and above all *"a convention that cites a
code mechanism is coupled to it"* (`:68-73`), which is C8.

## Related Research

- `context/archive/2026-08-19-staged-progress-and-checkpoints/research.md` — S-303, the checkpoint
  and stop-seam design
- `context/archive/2026-08-20-job-aware-container-lifecycle/research.md` — S-304, the closest
  structural precedent for this slice (same shape: a halted status, a checkpoint, a delivery)
- `context/archive/2026-08-25-drift-decided-delivery/research.md` — S-306, the delivery chain
- `context/archive/2026-08-31-extract-share-polling-store/research.md` — the polling factory

## Open Questions

1. **What happens to a stop on a `queued` row?** (C4) Tighten the claim CAS, terminalise app-side, or
   disable the button. Owner: plan phase. Block: no — any of the three is shippable.
2. **Where does the affordance live** — the pending proposal page (free) or the hub (a pinned-test
   edit)? (C10) Owner: plan phase. Recommendation: the pending page, with the hub deferred.
3. **What is the honest measured stop latency** on the real engine? (C1/C3) Owner: the new test.
   Block: no, but the UI copy should not be finalised before the number exists.
4. **Should the stop poll piggyback the heartbeat PATCH or be its own GET?** Recommendation:
   piggyback — zero extra round-trips and no new grant — provided `progress`'s never-raises contract
   survives. Owner: plan phase.
5. **Does a stop-requested row that then wedges deserve to be reclaimed as `stopped` rather than
   `interrupted`?** (C5) Purely cosmetic today; delivery treats both identically. Owner: plan phase.
