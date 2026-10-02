---
change_id: automate-production-calibration-campaign
title: Automate production calibration campaign
status: impl_reviewed
created: 2026-09-29
updated: 2026-10-02
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### 2026-09-29 — Planning decisions and the campaign's time budget

Decisions taken with the author during `/10x-plan`; the full table is in `plan-brief.md`.

- This change builds tooling and amends S-308's plan. It does not run the campaign.
- Cells switch by Worker-secret override, not by merge. The runner parks the override on a graceful stop.
- The campaign plan is cloned **with** the current board. The author chose this over the research's recommendation of an empty board, so the campaign measures a fill-the-gaps solve and is not comparable with S-302's full-catalog run.
- The runner runs on the author's laptop and must survive a closed lid, because the machine is off during the commute.

Time budget the schedule rests on. Per-run figures are the research's estimates for an empty board, so a cloned board should come in under them.

| Block | Expected | Worst case |
|---|---|---|
| Phase 3 of S-308 (setup, drill, `sleepAfter` deploy, renewal proof) | ~1.5 h, ~45 min attended | ~2.5 h |
| Drill step 8 (a second full 240 s ladder, which doubles as Cell C run 1 — plan review 2026-09-30) | ~45 min, unattended after dispatch | ~50 min |
| Phase 4 of S-308 (twelve runs, four cell switches) | ~4.2 h, ~10 min attended | ~5.8 h, plus up to 33 min per retried run |

Two office days, each with about 3 h of slack: Day 1 is setup, the drill, the renewal proof and Cells A and B; Day 2 is Cell C, the Cell D choice, and Cell D.

### 2026-10-01 — Telemetry spike (Phase 5 §1): four findings from the live account

Docs first (the Telemetry Query, Keys and Values API reference), then the account. Production had no container or Durable Object event in the 7-day log window, so the author ran **one production Generate** as the probe: job `351d5c9e-f7c4-4395-aded-90bd609f8b1a`, dispatched 12:01:53Z, `succeeded with 246 placements` at 12:16:21Z, container idle-stopped at 12:31:54Z. Its proposal plan is to be deleted by hand.

1. **Filter keys.**
   - Container stdout lands in its own dataset, `containers`, as `$metadata.type = cf-container`. Its `$metadata.service` is the container application id, not the Worker name, and `$container.*` keys come with it.
   - Durable Object lines land in `cloudflare-workers` as `$metadata.type = cf-worker` with `$workers.executionModel = durableObject`.
   - A line's text is in `$metadata.message`, and its time in `timestamp` (epoch ms).
   - Select lines with a **filter** (`$metadata.message includes "<fixed text>"`), never a bare `needle`. A needle searched only the Workers dataset and missed every container line.
   - `/telemetry/values` rejects a body without `datasets` (`[]` is accepted), although the docs mark it optional.
   - A query over a long window loses events: the same filters found the startup line over 120 h and nothing over 144 h, as the reported granularity coarsened. The client splits searches into windows of at most 48 h.
2. **Token permission.**
   - A user API token with **Account → Workers Observability: Edit** works.
   - The `wrangler` OAuth token is refused with `10000 Authentication error` on every `/workers/observability/*` endpoint. Its scopes include `workers (write)` and `containers (write)`, and a control call that lists the account's Workers succeeds with it.
   - The research's "or reuse `wrangler auth token`" does not hold.
3. **Ingestion latency.** A line becomes queryable 15–36 s after it is logged: median 24 s and p90 33 s over 49 events first seen after the poller's first pass. These are upper bounds, since the poller ran every 15 s.
4. **Durable Object lines arrive.** Every expected line was seen: `[solver-container] started` at the dispatch, then `idle at sleepAfter` and `stopped: exitCode=0 reason=exit`, beside the SDK's own `Activity expired, signalling container to stop`.
   - The idle stop came **30 min 0.24 s after the last request** (the dispatch), which agrees with S-302's 30.002 min. The solve took 14.5 min, so it never crossed `sleepAfter = 30m` and no `sleep declined` line was expected.
   - The container logged `shutdown: no solve in flight` 0.1 s after the idle line.

Also observed: production's startup line reads `workers=4 max_concurrent_jobs=1 stage_targets=<none> stage_budget_s=120 mode_a_budget_s=300 credential_configured=True wire_contract=loaded`. This is the evidence S-308's check 1.5 asks for; `verify-startup` printed it (Phase 5 check 5.4).

Check 5.5 caveat: the parser fixtures for seven line kinds are lines captured from that probe (cold start, `solving with`, `succeeded with`, `[solver-container] started` / `idle at sleepAfter` / `stopped:`, `shutdown: no solve in flight`). The other four — `sleep declined`, the SIGTERM shutdown pair (`asked N solve(s) to stop`, `every solve wrote its terminal row`), and `stop-if-idle` — cannot occur in a short idle-stopped solve, so their fixtures are built from the source's format strings and labelled as such in `telemetry-lines.test.ts`. Replace them with real lines from the drill and the renewal run (S-308 Phase 3).

### 2026-10-01 — Local rehearsal (Phase 6 §1): every path, against the local stack

`CAMPAIGN_TARGET=local`: the rehearsal grid (A `w4-s6-a300`, B `w4-s3-a300`, C `w4-s12-a300`, then D chosen as `w8-s6-a300`), a native solver started and stopped by the local controller, and campaign plan `2e50aae2-61fc-4912-a807-8bc7de844125` cloned from the seed plan with 250 h to place. The journal ended at 154 entries; the ledger at 14 rows (12 counted, 2 excluded).

| Path | How it was forced | What the runner did |
|---|---|---|
| Resume after a hard stop | SIGKILL during A1's wait | `status` showed the wait as pending; the next `run` reconciled it and A1 counted |
| Hard stop just after a dispatch intent | SIGKILL about 30 ms after `dispatch cell A run 2` was journaled, before any job existed | The next `run` found no job created after the intent and dispatched once (`23ffaf5b`) |
| Hard stop after the server acted | Fault injected into the journal: A3's dispatch outcome removed, so job `677c1811` existed and the journal did not know it | `(found, not re-dispatched)`: adopted, and the plan held exactly 3 jobs |
| Graceful stop and park | One Ctrl-C during A3's record step | The step finished, the override was parked, and the runner exited. `status` showed no override and "next: apply cell B" |
| Excluded run and retry | SIGTERM to the local solver 6 s into B1 (`ea61acd3`) | `interrupted`, checkpoint delivered, recorded as `status interrupted (interrupted)`. Then a stop, a cold start, and attempt 2 |
| Halt after a second failure | SIGTERM again on attempt 2 (`861b56fc`) | `HALT — cell B run 1 failed twice`, state saved. `resume`, then attempt 3 (`b9b7c562`) counted |
| Pause for Cell D, then resume | A, B and C completed | It parked, then paused with the cross-cell matrix. `set-cell D 32 6 300` was refused (workers outside 1–16); `set-cell D 8 6 300` was accepted, and `run` ran D three times, parked and reported done |
| Cleanup order | `cleanup` | It refused until the merged ledger was copied. It then delivered all 14 proposals, deleted the 14 by id, and deleted the campaign plan last. The database afterwards held 0 calibration plans, 0 proposals and 0 job rows |

Two earlier smoke runs (Phase 4) found and fixed one bug: the local controller judged "running" by the launcher's pid, so a dispatch could reach a solver that was still shutting down. It now checks the port. `run-one` was not rehearsed end to end, because locally it means `main`'s 120 s stages, a full ladder of about 15 minutes; `next-step.test.ts` pins its sequence.

### 2026-10-01 — Where Phases 3–6 departed from the plan, and why

- **Analyzer (P3).**
  - Remaining hours applies Generate's own auto-park (`autoParkPhantomCourses`, then `deriveGenerationDeficits`), not `deriveCompleteness` alone, so a zero-student course is not counted.
  - The row's free-text `error` reaches the ledger only as a fixed `errorKind`: a translation failure quotes a course's natural key, which is its name.
  - Ledger mode always computes the delivered 10-tuple, because the ledger must outlive the rows.
  - Validity rules come in through `ANALYZE_CELLS`, `ANALYZE_REQUIRE_SOLVER_CONFIG` and `ANALYZE_EXPECT_HOST`. The host takes a `machine/*` wildcard until the first production run pins the CPU count.
  - Every mode prints one `@campaign {json}` answer line for the runner.
- **Runner (P4).**
  - The launcher `exec`s Node and keeps no shell traps: Node owns the first and second Ctrl-C, and a shell in between would either die early or swallow the signal.
  - Two commands were added. `resume` lifts a policy halt. `setup --adopt|--abandon` settles an interrupted setup instead of cloning real data twice.
  - Every retry, a refused dispatch included, is preceded by a stop, not only the wrong-cell retry.
  - The local target runs a scaled grid (6, 3 and 12 s stages).
  - `cleanup` asks for its own typed confirmation.
  - The controller hands the analyzer a host pattern rather than a predicate, so the ledger and the runner agree.
- **Lifecycle (P5).**
  - The telemetry client selects lines by filter, never by needle, and splits long searches into windows of at most 48 h. Both rules come from the spike's observations.
  - `main.ts` was split: the run machinery moved to `runner.ts`, and the three Phase 3 commands are in `lifecycle.ts`.
  - The drill is journaled as a `drill` pseudo-cell (Cell C's tuning, never a grid slot) plus `drill` fact entries. Its step 9 is an `apply-cell` flagged `duringSolve`, which skips the idle wait on purpose.
- **Handoff (P6).** The two docs that still called the runner "planned" (`src/solver-container-env.ts`, README § Deployment) now name it, following `lessons.md`'s rule that docs naming a mechanism must change with it.

### 2026-10-01 — Checks 1.8 and 2.8: Phases 1–2 deployed with nothing solving

- **The deploy.** Phases 1 and 2 (`8fe5d30`, `33c539d`, plus the review fixes `d4c5f05`) reached `main` in a single push. CI run 36827304107 passed every job, and its **Deploy** finished green 07:01:59–07:09:59Z.
- **Nothing was solving.** The Telemetry API holds **zero** container stdout events and **zero** Durable Object events between 05:00 and 11:55Z. A running solve would log a heartbeat every 15 s, and the Durable Object logs `started` at every dispatch.
- **The query works.** Two positive controls with the same method found events where they exist: a Worker request at 05:59:30Z, and the probe's container lines from 12:01:53Z.
- **Production confirms Phase 1.** The probe's cold start at 12:01:53Z ran the Phase 1 image: its startup line names `stage_budget_s` and `mode_a_budget_s`.
