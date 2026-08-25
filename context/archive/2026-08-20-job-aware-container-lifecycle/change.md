---
change_id: job-aware-container-lifecycle
title: Job-aware container lifecycle
status: archived
created: 2026-08-20
updated: 2026-08-25
archived_at: 2026-08-25T10:33:30Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap slice **S-304** (`context/foundation/roadmap.md:152-179`), PRD **FR-311**. Prerequisites S-302 + S-303 are both `done`, so the slice is unblocked.
- Feasibility research: `research.md` (2026-08-20). Verdict **feasible**; the schema, grants, contract enum and stop seam were all pre-paid by F-301 and S-303, and the one API the design turns on (`renewActivityTimeout()`) exists in the installed SDK.
- Two roadmap/PRD claims were falsified during research and need truing up as part of this change — see research.md § "Corrections owed to in-repo prose".

### Tier-1 drill, 2026-08-24 (phases 1–2)

Local stack + `mise run solver:dev`, the committed golden `SolveRequest` (a full-length solve)
dispatched to a hand-seeded `generation_jobs` row. SIGTERM sent directly to uvicorn rather than
Ctrl-C — the same first-signal lifespan path, and it sidesteps the double-tap that sets `force_exit`.

**Heartbeat (1.5).** Claim at `10:02:05.251`; the heartbeat client's own (lazy) password grant at
`10:02:20.401`. `heartbeat_at` then advanced at `08:02:20.402 → 08:02:35.417 → 08:02:50.431` UTC —
**15.015 s / 15.014 s** — while `stage_index` stayed 3 and `stages` stayed length 2, i.e. the
renewals happened strictly *between* stage events, which is exactly what S-303's cadence could not do.

**SIGTERM (2.3).** Sent `10:03:10.3`. Log:

```
shutdown: asked 1 solve(s) to stop; waiting up to 120s for their terminal writes
job … interrupted: outcome=complete after 4 stage(s)
shutdown: every solve wrote its terminal row in 1.5s
```

Row: `status=interrupted`, `stages` length 4, `checkpoint_stage_index=4`, `checkpoint` non-null,
`result` NULL, `error` naming stage 4 (`teacherHoles`). Process exited ~2 s after the signal —
against a 120 s join budget and the platform's 15-minute window.

`outcome=complete` in that log line is F1's hole reproduced live: the cancelled Mode-A run really
does return `complete`, so the pre-S-304 outcome branch would have written **`succeeded`** over an
interrupted solve. The latch is what caught it.

### Wedged-row drill, 2026-08-24 (phase 4)

`pnpm build && pnpm preview` + local stack + tier-1 solver, driven through the browser as
`e2e-author@example.test`. Generate on **Seed Plan A**, then at `stage_index=3` /
`checkpoint_stage_index=2` the solver was **SIGKILLed** (no SIGTERM, so no `interrupted` write — a
crash, not a shutdown) and the row hand-wedged with
`update generation_jobs set heartbeat_at = now() - interval '10 minutes'`.

| Step | Observed |
| --- | --- |
| `/plans` before the visit | badge **"Generating — stalled, open plan"**, tone `other`, linking to the plan |
| the plan visit | row `running → interrupted`, `error` naming the last heartbeat instant |
| delivery, same visit | `delivered_plan_id` set; **250 placements** landed on the proposal clone from the *stage-2* checkpoint |
| the strip | link **"Partial proposal ready — open"** + "Interrupted — kept the board from stage 2 of 10." |
| Generate | re-enabled (the partial unique index no longer blocks a terminal row) |
| `/plans` after | no badge — the row is terminal and drops out of active discovery, same as any finished job on a cold load |

The reclaim and the delivery happened in **one** visit, which is the point of running the CAS ahead
of the delivery branch.

### Tier-3 drill, 2026-08-24 (phases 3 + 5) — the real container in workerd

`mise run solver:tier3`, so dispatch went through the **binding** (`getSolverTransport()` → `env.SOLVER`
→ `SolverContainer` → `containerFetch`), not a URL. `sleepAfter` was temporarily set to **20s** for
the run so `onActivityExpired` would actually fire inside a solve; it was restored to `30m` before
committing (the committed value is unchanged — Phase 6 owns the drop to `10m`).

**Activity renewal (3.6).** Generate on Seed Plan A, then over the following minute:

```
[solver-container] started
[solver-container] sleep declined: 1 solve(s) in flight — activity renewed
[solver-container] sleep declined: 1 solve(s) in flight — activity renewed
[solver-container] sleep declined: 1 solve(s) in flight — activity renewed
```

Three consecutive `sleepAfter` expiries, three declines, and the row kept advancing
(`running`, `heartbeat_at` renewing) throughout — so the probe reached a container that was busy
solving, which is the fact the whole design turns on. **Pre-S-304 the first of those three would have
stopped the container mid-solve.**

**SIGTERM (5.4).** `docker kill -s TERM` at `10:30:13.3`; terminal write at `10:30:17.43` — **≈4.1 s**,
against a 120 s join budget and the platform's 15-minute window. The container then exited
`exitCode=0 reason=exit` (uvicorn's graceful shutdown ran the lifespan and returned cleanly).

Row: `interrupted`, `checkpoint_stage_index=4`, 4 stages, error naming stage 4 (`teacherHoles`). The
plan visit delivered **250 placements** onto the clone; the strip read "Partial proposal ready — open"
/ "Interrupted — kept the board from stage 4 of 10."; Generate was re-enabled.

> The **idle** half of the override (active = 0 → let the container stop) is not proven here — after
> the SIGTERM there was no live container for the alarm to ask about, and starting one costs a
> full-length solve. It is covered by the unit test on the parse helper plus the SDK's own default,
> and Phase 6's criterion 6.4 is where the idle sleep boundary gets measured for real.
