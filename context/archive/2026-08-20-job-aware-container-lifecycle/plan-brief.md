# Job-Aware Container Lifecycle (S-304) — Plan Brief

> Full plan: `context/changes/job-aware-container-lifecycle/plan.md`
> Research: `context/changes/job-aware-container-lifecycle/research.md`

## What & Why

A running CP-SAT solve must survive the platform's lifecycle (PRD FR-311): Cloudflare does not
guarantee any container instance runs for any set period, dispatch is 202-and-detach so a solving
container looks idle, and a row killed mid-solve today wedges at `running` — permanently
unclaimable, blocking that plan's Generate. S-304 makes the lifecycle job-aware: renewal prevents
mid-solve sleep, SIGTERM lands `interrupted` with the last checkpoint, and a wedged row self-heals.

## Starting Point

F-301/S-303 pre-paid everything persistent: `interrupted` is already in the CHECK, RLS, TS union,
UI switch and wire enum; `heartbeat_at` renews per stage event; every completed stage's board is
already durably checkpointed. What's missing is behaviour: no heartbeat timer, no stop producer
(a cancelled run would even be written `succeeded`), an empty lifespan shutdown, a default
sleep-path that stops a solving container, and nothing anywhere that reads `heartbeat_at` or
`checkpoint`. `sleepAfter: 30m` is a stopgap costing ~$5/month of idle billing per merge window.

## Desired End State

A deploy, sleep, or crash loses at most the in-flight stage. SIGTERM → the row reaches
`interrupted`; the author's next plan visit delivers the kept board onto the proposal clone,
labelled "Interrupted — kept the board from stage N of 10", and Generate re-enables. A hard crash
is detectable within 15 s and reclaimed within a 5-minute grace on the next visit (or at the
enqueue conflict); the `/plans` hub shows "Generating — stalled" meanwhile. Idle containers sleep
after 10 minutes. All proven on the deployed container, with production numbers recorded for S-308.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Recovery model | Fail-forward (no claim-CAS widening) | Preserves F-302's only restart-surviving idempotency guard; zombie writes still match no row by design | Research / Plan |
| Reclaim actor | `checkGeneration` CAS (authoritative) + enqueue-23505 backstop + `/plans` staleness badge | Recovery runs where the failure is felt, with zero new infrastructure or credentials; supersedes S-301's threshold objection via the 20× grace margin | Plan |
| "Recoverable" clause | Deliver interrupted checkpoints via the existing sweep | Makes the roadmap sentence literally true and pre-pays S-305's delivery half | Research / Plan |
| Heartbeat / grace | 15 s timer thread / 5 min stale | 20 missed beats — order-of-magnitude margin — while recovery stays minutes, not stage-budget-scale | Plan |
| SIGTERM path | Lifespan hook fires a reason-carrying latch; worker thread's own writer lands `interrupted` | One write path, no hook-vs-thread race; also fixes the cancelled→`succeeded` mis-write S-305 needs fixed | Research / Plan |
| Activity renewal | `onActivityExpired()` override asks `GET /jobs/active`; unreachable ⇒ stop | The SDK's sanctioned mechanism; the check itself renews; no cron, no DB access from the Worker | Research |
| `sleepAfter` | 30m until the production drill passes, then 10m | D4's gate; 10m cuts idle billing 3× with wide margin over the renewal cadence | Plan |
| Production proof | Deliberate deploy-during-solve drill on a throwaway hosted plan | Only a real rollout produces a real SIGTERM; throwaway plan isolates real data | Plan |
| README no-merge rule | Softened to advisory after the drill | The stated hazard is fixed; keeping a falsified rationale is the stale-prose lesson | Plan |

## Scope

**In scope:** solver heartbeat + stop latch + `interrupted` terminal branch; lifespan shutdown;
`GET /jobs/active`; DO renewal override; app-side reclaim (visit + enqueue) and interrupted
delivery; stalled badge; integration + tier-3 + production drills; prose corrections
(`keepAlive`, rollout-grace rationale, roadmap/PRD CAS note, README advisory).

**Out of scope:** claim-CAS widening, redispatch/`warmStart` resume, Cron Triggers or any new
credential, migrations/contract edits, the Stop button (S-305), objective/model changes, Generate
E2E coverage (S-306).

## Architecture / Approach

Fail-forward, one seam per layer. Solver: a 15 s heartbeat on a second `JobRowClient` plus a
latched stop (`JobEntry.stop`, reason-carrying — SIGTERM now, S-305's poll later) wired into the
engine's existing `should_stop`; the lifespan shutdown stops all jobs and joins the worker threads
(120 s budget inside the platform's 15-minute window) so the existing writer performs the one
`interrupted` PATCH. DO: before sleeping, ask the container if it is solving; renew if yes. App:
`checkGeneration` reclaims stale-active rows with a heartbeat-guarded CAS and delivers interrupted
checkpoints through the unchanged verify→translate→apply chain; the 23505 conflict path is the
race backstop; the `/plans` poll stays read-only and merely displays staleness.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Solver mechanics | Heartbeat timer, stop latch, `interrupted` outcome branch | Thread-safety of the token cache (solved: second client) |
| 2. Lifespan shutdown | SIGTERM → `interrupted` end to end, `/jobs/active` | Blocking the event loop during joins |
| 3. DO renewal | `onActivityExpired` override; prose corrections; `sleepAfter` stays 30m | Untestable locally beyond tier-3 smoke — real proof is Phase 6 |
| 4. App reclaim + delivery | Visit-time CAS reclaim, checkpoint delivery, enqueue backstop, stalled badge | The one deliberate write in a read path — CAS must be unlosable by live jobs |
| 5. Local proof | Lifecycle integration suite; tier-3 SIGTERM drill | Checkpoint fixture must genuinely pass the oracle |
| 6. Production proof | Deploy drill, renewal proof, `sleepAfter: 10m`, S-308 numbers, prose truing | Writes real rows; multi-day human-gated tail (S-302 precedent) |

**Prerequisites:** S-302 + S-303 done (they are); hosted access for the drill; Docker for tiers 2–3.
**Estimated effort:** ~4–5 sessions across 6 phases, with an S-302-style multi-day production tail.

## Open Risks & Assumptions

- A container alive but partitioned from Supabase > 5 min is indistinguishable from dead; the
  fail-forward design bounds the damage (its late writes match no row) but a solve can be
  reclaimed while technically still running. Accepted; a claim token is the recorded future fix.
- The renewal proof requires a >10-minute production solve; if current catalogs solve faster, the
  drill uses the throwaway plan sized to run long enough.
- Uvicorn receives exactly one SIGTERM from the platform (a second would skip the lifespan) —
  consistent with SDK source and S-302 observations.

## Success Criteria (Summary)

- Kill the solver any way (Ctrl-C, `docker kill`, production rollout) mid-solve: the row ends
  `interrupted`, the kept board is delivered and labelled, and Generate works again without SQL.
- A wedged `running`/`queued` row self-heals within the grace on the next author touch, and is
  visibly "stalled" on the hub until then.
- A production solve longer than `sleepAfter` completes untouched; idle containers sleep in 10
  minutes; the numbers are recorded and the README rule is an honest advisory.
