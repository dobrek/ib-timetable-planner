# Production Calibration Campaign (S-308) — Plan Brief

> Full plan: `context/changes/production-calibration-campaign/plan.md`
> Research: `context/changes/production-calibration-campaign/research.md`

## What & Why

Every solve budget the production container runs under is a proof-of-concept guess made on a Mac, and the project's locked rule is that shipped numbers come only from measurements on the production instance. Nobody has taken those measurements: one production solve has ever been recorded. This slice makes the numbers tunable on production, measures them there, ships what the measurements defend, and retires the roadmap clauses that no longer describe the code.

## Starting Point

Per-stage and Mode A budgets are literals in the engine's `SolveConfig` that the service never overrides; the stage-target knob exists in `settings.py` but is not among the six env keys the Worker forwards. Every job row already stores per-tier `best`/`bound`/`wallClockS`/`stoppedBy`, but nothing reads hosted rows. S-304 was archived without running its production drills, so `sleepAfter` is still 30 m and a deploy still kills an in-flight solve.

## Desired End State

Budgets and the (empty) target key are pinned Worker constants forwarded to the container and named in its startup log. A deploy during a solve has been watched to interrupt, keep, deliver and self-heal; `sleepAfter` is 10 m. Twelve production runs sit in a ledger in `change.md`, the shipped budgets and worker count are the ones that ledger defends, the UI states a measured ceiling, and PRD/roadmap/README no longer describe a greedy fallback or an interactive path. The per-tier quality values of the shipped configuration are recorded as S-309's regression baseline.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Interactive Mode A fallback + default-switch gate | Struck; PRD/roadmap trued | No such code path exists and the switch happened in S-301; building it would double scope for a need the proposal flow already serves | Plan |
| S-304's unrun Phase 6 | Inherited as Phase 3 | The campaign cannot trust 20-minute runs on an unproven lifecycle, and each drill run is also a data point | Plan |
| What ships | Budgets ship; target key forwarded empty | Budgets are hardware-derived and catalog-independent; targets are catalog properties, deferred to a real season | Plan |
| Budget knob location | Env in `settings.py`, pinned constants on the Worker, engine default as single source of truth | Same shape as `SOLVER_WORKERS` and targets; a campaign cell is a one-line Worker-only merge | Plan |
| Extraction | Read-only `pnpm analyze:jobs` bench script | Reuses the sole sanctioned hosted-read precedent; tables are regenerable and pasteable | Plan |
| Campaign size | 12 runs: 3 × {60, 120, 240 s} at 4 workers + 3 at 8 workers | Enough to see where per-tier quality flattens and to answer S-302's worker question; ~3–4 h serial, a few dollars | Plan |
| Hint-free Mode A | Already measured (F-302); tier-1 `wallClockS` on every run is the production re-measure | Research |
| Regression baseline test | Values recorded here; executable test lands in S-309 | FR-314 lists it as S-309's precondition and the fixture pipeline is decided there | Research |

## Scope

**In scope:** budget env knobs + runner + startup log; Worker forwarding of three new keys; `pnpm analyze:jobs`; the deploy-during-solve drill, renewal proof, `sleepAfter: 10m`, five production numbers; twelve ledgered runs; shipped constants; UI ceiling constant; `rollout_active_grace_period` re-derived; PRD/roadmap/README/`settings.py` truing; verdict + baseline; hosted cleanup.

**Out of scope:** an interactive Mode A path or Mode B; target values; any wire/`formatVersion` change; the executable CP-SAT regression test; policy grid on production; per-stage log lines; CI path filters; off-Cloudflare hosting; widening the solver's claim CAS.

## Architecture / Approach

`solver-container-env.ts` constants → container env → `settings.py` (`None` = engine default) → `runner.py` → `SolveConfig`. The container's startup line proves which values a run used; the job row's `stages` proves what each tier reached; `pnpm analyze:jobs` turns rows into tables. Campaign cells are Worker-only merges applied to an idle container (env is read at cold start). Drills and runs dispatch from one throwaway clone of the real plan, deleted at the end.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Knobs | Budgets configurable, targets forwardable, startup log names them; ships at today's values | Two places (engine default, Worker constant) must not drift — `None` means engine default |
| 2. Extraction | `pnpm analyze:jobs` per-tier tables from hosted rows | Needs the service-role key in `.env.test.local`; read-only by construction |
| 3. Lifecycle proof | Drill, renewal at 10 m, five production numbers, README advisory | First deliberate mid-solve rollout on production; evidence must be captured live |
| 4. Campaign | Twelve ledgered runs, per-tier analysis, chosen budgets/workers | A merge during a run; env change not taking effect on a warm container |
| 5. Ship & true up | Constants, UI ceiling, grace period, prose, verdict, baseline, cleanup | Prose drift — every number must cite the ledger |

**Prerequisites:** Workers Paid already covers Containers — the campaign is ≈ $1.5–2.5 of overage, no plan or limit change (change.md 2026-09-04); hosted hook enabled and machine user provisioned (done in S-302); `wrangler tail` and Cloudflare container log access; `.env.test.local` with hosted service-role key for Phase 2/4 reads; a real current plan to clone.
**Estimated effort:** ~2 sessions of code (Phases 1–2, 5), plus ~3–4 hours of serial production solving spread over several days (Phases 3–4).

## Open Risks & Assumptions

- A Worker-only merge can still roll the container if the `python:3.13-slim` tag moved; all merges happen while the container is idle.
- The job row records neither budgets nor worker count; attribution rests on the ledger and the startup log line.
- The clean-mode fallback burns a second Mode A budget invisibly; the analyzer flags it from `finished_at − started_at`.
- Run-to-run variance may swamp the 60/120/240 differences on some tiers; "indistinguishable, keep 120 for margin" is an acceptable verdict.
- The 8-worker probe may show only a different equally-good board rather than a better one; that is itself the answer to S-302's question.

## Success Criteria (Summary)

- The production container runs under budgets and a worker count that a twelve-run ledger in `change.md` defends, and its startup log says so.
- A deploy during a solve provably interrupts, keeps, delivers and self-heals; `sleepAfter` is 10 m; README's rule is an advisory.
- PRD, roadmap and README describe what the code does — no greedy fallback, no interactive path, a measured ceiling — and S-309 has its pinned baseline values.
