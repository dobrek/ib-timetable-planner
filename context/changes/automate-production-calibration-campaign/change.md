---
change_id: automate-production-calibration-campaign
title: Automate production calibration campaign
status: implementing
created: 2026-09-29
updated: 2026-10-01
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
