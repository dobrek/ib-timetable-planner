# Automate the Production Calibration Campaign — Plan Brief

> Full plan: `context/changes/automate-production-calibration-campaign/plan.md`
> Research: `context/changes/automate-production-calibration-campaign/research.md`

## What & Why

S-308's remaining work is operational: lifecycle drills, twelve production runs, then shipping and cleanup. By hand each run costs about eight human touches plus attention through 15–35 minutes of waiting. This change builds the tooling that runs it unattended from a laptop over two office days, and corrects S-308's plan where research showed its protocol cannot work.

This plan does not run the campaign. The runs, the ledger and the verdict stay in S-308.

## Starting Point

Job rows record stages and clocks but not which budgets or worker count solved them. The tuning constants are literals that change only by a merge to `main`, and every merge rolls the container. `SolverContainer` has no way to report its state or be stopped. `pnpm analyze:jobs` prints tables for a human and nothing a program can read.

## Desired End State

Every job row says what solved it. A cell switch takes seconds and needs no deploy of code. `mise run solver:campaign` drives setup, the cell grid, the drill, the renewal observation and cleanup; it survives a closed laptop and parks the production override when stopped. The runner has been rehearsed locally end to end, and S-308's plan carries dated amendments.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Relation to S-308 | Tooling here, dated amendments there, runs ticked in S-308 | One record of the campaign, and S-308 stops describing a protocol that fails | Plan |
| Attribution | `solver_config` column with `cleanFallback` and host fingerprint | Attribution becomes a fact on the row, so a stale container is detected | Research |
| Cell switch | Worker-secret override via `wrangler secret bulk` | Seconds instead of ~9.5 min, no container roll, independent of CI | Research |
| Cold start | `stopIfIdle()` and `status()` behind an allowlisted route | The only reliable asleep/awake answer, and a forced cold start | Research |
| Drill | 240 s solve, local `wrangler deploy` trigger | SIGTERM lands mid-solve whether or not the grace window applies | Plan |
| Schedule | Two office days | About 3 h of slack per day for a retry or a CI flake | Plan |
| Runner host | The developer's laptop, resumable | No hosted credentials leave the machine | Plan |
| Parking | Override removed on graceful stop | Production never sits overnight on campaign budgets | Plan |
| Failures | Record, retry once, then halt | A transient glitch costs one run, and nothing is dropped from the record | Plan |
| Campaign plan | Cloned **with** the current board | Measures the everyday fill-the-gaps case | Plan |
| Proof before production | Unit tests plus a full local rehearsal | The first resume and cleanup must not run on real student data | Plan |
| Runner shape | One Node TypeScript program in `bench/campaign/` | `bench/` is linted and type-checked; `scripts/` is not | Plan |
| Control surface transport | API route, not an Astro Action | The runner is a non-Astro consumer, and the middleware covers the route | Plan |

## Scope

**In scope:**

- `solver_config` migration, grant, solver writes, reader and tests
- `CALIBRATION_*` overrides, the two Durable Object methods, the allowlisted route
- Analyzer ledger, matrix, baseline, active guard, remaining-hours preflight
- The runner, its launcher and mise task
- Telemetry client, drill and renewal commands
- Local rehearsal, runbook, README, amendments to S-308

**Out of scope:**

- Running the campaign or shipping constants
- `sleepAfter`, the UI ceiling, the grace period, PRD and roadmap prose
- Any wire-contract change
- Service-role writes to hosted
- A CI-hosted or cloud-scheduled runner

## Architecture / Approach

The job row is the campaign's record. The solver writes its effective configuration to the row; the analyzer turns rows into a JSON ledger; the runner reads the ledger to decide whether a run counts.

The runner drives production only through the app's own actions over HTTP. It switches cells through Worker secrets and the control route, behind a `CellController` interface whose local implementation restarts the native solver instead. A write-ahead journal makes every step resumable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Self-describing job rows | `solver_config` on every row | A misplaced write wedges a row or loses a board |
| 2. Worker control surface | Overrides, status and stop, the route | A new production route that can stop the solver |
| 3. Analyzer extensions | Ledger, matrix, baseline, guards | Output must stay free of real names |
| 4. Campaign runner | Journal, client, controller, commands, launcher | A lost job-to-cell mapping after a closed laptop |
| 5. Lifecycle commands | Telemetry, drill, renewal, five numbers | Telemetry filter keys are unverified until the spike |
| 6. Rehearsal and handoff | Local rehearsal, runbook, S-308 amendments | Rehearsal cannot cover secrets or telemetry |

**Prerequisites:** Docker Desktop; a `wrangler` login with Workers Scripts and Containers edit; a Cloudflare token that can query Workers Observability; a dedicated campaign author account; the hosted service-role key, held in `.envs/campaign.vars` only.

**Estimated effort:** About 5–6 implementation sessions across 6 phases. Two of them end in a production deploy that must land on an idle container.

## Open Risks & Assumptions

- **The cloned board may be too full.** If few hours remain unplaced, solves may be too short to tell the budgets apart. `setup` prints remaining hours so this is seen before any container time is spent.
- **Whether a secret change disturbs a running solve is undocumented.** The drill observes it once; until then the runner will not park while a solve is in flight.
- **Telemetry specifics are unverified.** Filter keys, permission name and ingestion latency are confirmed by the Phase 5 spike.
- **`status()` reports intent, not fact.** Only `solver_config` proves what solved a run.
- **Campaign days need a merge freeze.** Any merge to `main` rolls the container.
- **A hard lid-close skips parking.** The next `status` reports the live override, but does not prevent it.

## Success Criteria (Summary)

- A full campaign grid runs on the local stack from one command, survives a forced stop, and cleans up after itself.
- A production cell switch is a single command that takes seconds, and every job row says which cell solved it.
- S-308's plan can be followed as written, with a human needed only for setup, the drill and the Cell D choice.
