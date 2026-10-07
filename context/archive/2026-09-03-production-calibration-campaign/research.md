---
date: 2026-09-03T14:32:00+02:00
researcher: Claude (Fable 5.1) for Dobromir Kropielnicki
git_commit: 80e2bcfa67542a0ff2e47f85464fc7030e1cab2d
branch: main
repository: dobrek/ib-timetable-planner
topic: "S-308 production calibration campaign — is it still needed, is it feasible, and what attributes/changes/actions does it actually involve?"
tags: [research, codebase, solver, cp-sat, calibration, generation_jobs, solver-container, roadmap, S-308, S-304, S-309]
status: complete
last_updated: 2026-09-03
last_updated_by: Claude (Fable 5.1)
last_updated_note: "Added follow-up: plain-language explanation of the goal, the parameters, and their current status"
---

# Research: Is S-308 (production calibration campaign) still needed and feasible?

**Date**: 2026-09-03T14:32:00+02:00
**Researcher**: Claude (Fable 5.1) for Dobromir Kropielnicki
**Git Commit**: 80e2bcfa67542a0ff2e47f85464fc7030e1cab2d
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/80e2bcfa67542a0ff2e47f85464fc7030e1cab2d/`

## Research Question

Roadmap S-308 (`production-calibration-campaign`) is the last `proposed` slice on Stream B before greedy retirement (S-309). Check whether it is still needed and feasible now that S-301–S-307 have shipped, and enumerate concretely which attributes (knobs), code changes, and operational actions it involves.

## Summary

**Still needed — but roughly half of its written outcome is stale, and its prerequisite is not actually satisfied.**

The S-308 outcome sentence in the roadmap ([roadmap.md:239](https://github.com/dobrek/ib-timetable-planner/blob/80e2bcfa67542a0ff2e47f85464fc7030e1cab2d/context/foundation/roadmap.md#L239)) bundles five claims. Their status today:

| Outcome clause | Status | Evidence |
|---|---|---|
| Solve **budgets** set from a production campaign | **Open — and there is no knob.** `stage_budget_s=120`, `mode_a_budget_s=300` are dataclass defaults the service never overrides; changing them is a code edit. | `solve.py:134-136`, `runner.py:269-283` |
| **Stage targets** set from a production campaign | **Open — and unreachable in production.** `SOLVER_STAGE_TARGETS` is parsed by the container but is **not one of the six env keys the Worker forwards**. | `settings.py:110-136`, `src/solver-container-env.ts:25-43`, pin test `solver-container-env.test.ts:62` |
| Fast solves (Mode A / small repair) return within an interactive budget **or fall back to the background job** | **Not a calibration task — the path does not exist.** Every Generate is a 202-and-detach background job; Mode A is never surfaced as a returnable answer; Mode B is inert because the app never sends `warmStart`. | `generation-job.ts:242-249`, `solver-transport.ts:18-22`, `runner.py:285` |
| UI communicates a **realistic full-ladder ceiling** instead of an indefinite spinner | **Half-moot.** There is no spinner: the UI shows "stage N of 10" plus four "several minutes" strings, and quotes no number on purpose. A ceiling number would be a *new* string, not an updated one. | `StopAndKeep.tsx:42-44`, `GenerateButton.tsx:111`, `plan-indicators.ts:197` |
| **Hint-free Mode A is measured** | **Done as an engineering question** (OPTIMAL in 0.7 s, M4, F-302). Production already runs hint-free; a production re-measure falls out of any campaign run for free (tier-1 `wallClockS`). | `2026-08-11-solver-service-transport/research.md:220-238`, `runner.py:194-200` |
| The **calibration gate for the default-path switch** is evaluated | **Moot.** S-301 made CP-SAT the only Generate path, ungated; the greedy Worker path was deleted in `clean-up-bench-generation`. FR-314 was corrected; the roadmap line and two PRD clauses were not. | `prd.md:583-586` (corrected) vs `prd.md:205-207`, `prd.md:680-682`, `roadmap.md:239` (stale) |

**What is genuinely un-done and only S-308 can do:** every shipped number is uncalibrated. Exactly **one** production-container solve has ever been recorded (14.72 min, 248 placements, 4 workers, 2026-08-18). The M4→cloud multiplier the PRD feared (3–5×) was falsified by that run (≈18 % slower than 8 workers on M4), so the scariest assumption is already softer than feared — but budgets, targets, the worker count, and the sleep boundary are all still guesses.

**Feasibility verdict: feasible, cheaply, with four gaps to close first.** Measurement plumbing already exists (per-stage `wallClockS`/`best`/`bound`/`stoppedBy` is persisted on every job row). What is missing: (1) target forwarding to the container, (2) a budget knob, (3) any tooling to extract hosted `generation_jobs` rows, and (4) the production lifecycle proof — **S-304 was archived with its Phase 6 "production proof" entirely unchecked**, so `sleepAfter` is still 30 m, the deploy-during-solve drill never ran, and the README's hard "do not merge while a solve runs" rule is still in force. S-308 lists S-304 as its prerequisite; that prerequisite is only nominally met.

**Recommendation:** keep S-308, re-frame it. Strike the interactive-fallback clause and the default-switch gate; inherit S-304's Phase 6; scope the deliverable as *plumbing + campaign + shipped values + doc truing*. Detail in §Architecture Insights and §Open Questions.

## Detailed Findings

### 1. The knob inventory — what a campaign would actually set

Every number a calibration could touch, where it lives, and who owns it:

| Knob | Where | Current value | How set today | Owner |
|---|---|---|---|---|
| `stage_budget_s` | [`solve.py:134`](https://github.com/dobrek/ib-timetable-planner/blob/80e2bcfa67542a0ff2e47f85464fc7030e1cab2d/services/solver/src/cpsat_engine/solve.py#L134) | 120 s per ladder stage | Dataclass default; CLI `--stage-budget` only; **runner never sets it** | engine (code) |
| `mode_a_budget_s` | `solve.py:135` | 300 s | same | engine (code) |
| `repair_budget_s` | `solve.py:136` | 30 s | same; Mode B unreachable from the app | engine (inert) |
| `seed` | `solve.py:137` | 1 | same | engine (code) |
| `targets` (`SOLVER_STAGE_TARGETS`) | [`settings.py:110-136`](https://github.com/dobrek/ib-timetable-planner/blob/80e2bcfa67542a0ff2e47f85464fc7030e1cab2d/services/solver/src/cpsat_service/settings.py#L110), applied `solve.py:610-615` | empty | Container env, `tier=value[,…]`, tiers 2–10 only; **not forwarded by the Worker** | container env |
| `SOLVER_WORKERS` | [`solver-container-env.ts:21`](https://github.com/dobrek/ib-timetable-planner/blob/80e2bcfa67542a0ff2e47f85464fc7030e1cab2d/src/solver-container-env.ts#L21) | `"4"` (service default 8) | Hard-coded constant, forwarded | Worker code |
| `SOLVER_MAX_CONCURRENT_JOBS` | `solver-container-env.ts:22` | `"1"` | same | Worker code |
| `SOLVER_HEARTBEAT_INTERVAL_S` | `settings.py:53` | 15 s | container env default, not forwarded | container |
| `SHUTDOWN_JOIN_BUDGET_S` | `app.py:43` | 120 s | hardcoded | container |
| `sleepAfter` | [`solver-container.ts:34`](https://github.com/dobrek/ib-timetable-planner/blob/80e2bcfa67542a0ff2e47f85464fc7030e1cab2d/src/solver-container.ts#L34) | `"30m"` (S-302 stopgap; S-304 Phase 6 was to drop it to 10 m) | code | Worker code |
| `rollout_active_grace_period` | `wrangler.jsonc:66` | 1200 s | config | wrangler |
| `instance_type` / `max_instances` | `wrangler.jsonc:39,43` | `standard-4` / 1 | config | wrangler |
| `HEARTBEAT_GRACE_MS` | `job-staleness.ts:23` | 5 min | code | app |
| `DISPATCH_TIMEOUT_MS` / `HEALTH_TIMEOUT_MS` | `solver-transport.ts:63-64` | 15 s / 3 s | code; dispatch-acceptance timeouts, not solve budgets | app |
| UI duration copy | `GenerateButton.tsx:111`, `StopAndKeep.tsx:99`, `PendingProposalPage.tsx:71`, `GenerationStatusStrip.tsx:75` | "several minutes" / "a few minutes" | literal strings, deliberately number-free | app |
| Prose numbers | `settings.py:35` "~21 minutes"; `prd.md:219` "~2–4 s"; `prd.md:222` "~12–20 minutes"; `PlansHub.tsx:45` comment | estimates | docs/comments | — |

**Nothing crosses the wire.** `SolveRequest` is `{formatVersion, snapshot, warmStart?, policy?}` with `additionalProperties: false` ([schema:222-245](https://github.com/dobrek/ib-timetable-planner/blob/80e2bcfa67542a0ff2e47f85464fc7030e1cab2d/contracts/generation-wire.schema.json#L222)); `policy` is `{preset}` only. A per-request budget would be a `formatVersion` decision — out of S-308's scope.

**Worst-case full-ladder wall clock at current budgets:** 300 + 9 × 120 = **1380 s (23.0 min)**, or **1680 s (28 min)** if the clean-mode infeasibility fallback fires (`_feasibility` solves twice, `solve.py:325-329`, and only the second solve's time lands in the tier-1 transcript). Two in-repo numbers are inconsistent with this: `settings.py:35` says "~21 minutes" and the PRD's "20-minute ceiling" (which `rollout_active_grace_period: 1200` was sized against) is *below* the engine's own worst case.

### 2. What is already measured — and on what hardware

| What | Value | Hardware | Source |
|---|---|---|---|
| Mode A completeness, golden catalog | OPTIMAL in 0.7 s, 0 h unplaced | M4, POC | `2026-07-15-poc-cp-sat-backend-service/results.md:29-33` |
| Hint-free vs hinted Mode A | 0.7 s vs 0.6 s, both OPTIMAL, 232 placements | M4, F-302 | `2026-08-11-solver-service-transport/research.md:228-231` |
| Full ladder at 60/30 s budgets | 243 s; tiers 1–2 OPTIMAL, tiers 3–10 all budget-capped FEASIBLE | M4, POC | `results.md:99-115` |
| Three-policy frontier (90 s + 150 s/stage) | clean 75/765/0/93 dominates canonical 95/824/3/95; student-first 124/579/0/97 | M4, POC | `results.md:180-231` |
| Non-determinism | two identical clean solves: teacher 60/student 889 vs 75/765 — neither dominates | M4, POC | `results.md:232-238` |
| Target-stop mechanics | tier-6 target 1050 fired at 2.11 s of a 10 s budget; a target below what the budget reaches never fires | local seed, S-303 | `2026-08-19-staged-progress-and-checkpoints/change.md:59-66` |
| **Production solve** (the only one) | **14.72 min**, 248 placements, cold start ≈5.5 s, sleep boundary 30.002 min after last request | `standard-4`, TXL, 4 workers, S-302 | [`2026-08-15-solver-deploy-lane/change.md:57-112`](https://github.com/dobrek/ib-timetable-planner/blob/80e2bcfa67542a0ff2e47f85464fc7030e1cab2d/context/archive/2026-08-15-solver-deploy-lane/change.md#L57) |
| 4 workers on 4 vCPU vs 8 on M4 | ≈18 % slower, **not** the predicted 3–5× | production vs M4 | same, `:92-94` |
| Cost per solve | ≈$0.13 (30 min provisioned + 14.7 min active) — now an underestimate, see §4 | production | same, `:145-154` |
| SIGTERM → `interrupted` latency | ≈4.1 s against a 120 s join budget | tier 3 (local Docker), S-304 | `2026-08-20-job-aware-container-lifecycle/change.md:85-97` |
| Expert bar | `teacherHoles ≤ 148` (2× the expert's 74); greedy measured 217; CP-SAT reached 95 (POC) | — | `2026-07-12-generation-quality-tuning/analysis-run-2.md:35`, `prd.md:55,81` |

Every archived slice that touched a number explicitly refused to promote it into a budget and handed the measurement to S-308 (S-301 research :398, S-302 change :112/:491-501, S-303 change :111, S-304 research :130/:442, S-305 plan-brief :41, S-307 research :311/:528). The discipline held; the campaign just never ran.

### 3. S-304 was archived with its production proof unrun — S-308's prerequisite is nominal

[`2026-08-20-job-aware-container-lifecycle/plan.md:756-770`](https://github.com/dobrek/ib-timetable-planner/blob/80e2bcfa67542a0ff2e47f85464fc7030e1cab2d/context/archive/2026-08-20-job-aware-container-lifecycle/plan.md#L756): Phase 6 "Production proof — the drill, the numbers, the dividend" has all six boxes `- [ ]`:

- 6.3 deploy-during-solve drill (interrupted + delivered + self-heal) — never run
- 6.4 renewal proof at `sleepAfter: 10m` (>10-min solve survives; idle sleep ~10 min post-solve) — never run
- 6.5 production numbers recorded — never done; the plan declared these "the only numbers S-308 may inherit" (`plan.md:594-601`)
- 6.6 README advisory + roadmap/PRD truing — never merged

Physical corroboration: `src/solver-container.ts:34` still reads `sleepAfter = "30m"`, and README § Deployment still carries the hard no-merge rule. The archive commit (`9d53c6e`) touched only front-matter and the roadmap. S-304's own change note (`change.md:94-97`) says the idle half of the activity override "is not proven here … Phase 6's criterion 6.4 is where the idle sleep boundary gets measured for real."

Consequences for a campaign:
- **A deploy still kills an in-flight solve**, and the mitigation (SIGTERM → checkpoint → `interrupted` → delivery on next visit) is proven at tiers 1 and 3 only. A campaign run lost to a merge yields a partial transcript, not nothing — but nobody has watched that on Cloudflare. CI has no path filters, so a doc-only merge rolls the image too.
- **Recovery of a wedged `running` row is app-side** (a plan visit runs the reclaim at 5-min heartbeat grace); the solver's claim CAS was deliberately left at `status=eq.queued` (`supabase.py:150`). An unattended campaign row that dies needs a visit or manual SQL.
- **Per-run billing is longer than S-302 modelled.** Post-S-304, `onActivityExpired` declines the stop while a solve is in flight and the SDK re-arms a full 30-min window, so a run now keeps the container awake ≈ solve + up to 30 min. Roughly $0.15–0.20/run; a 20–40-run campaign is a few dollars. Money is not the constraint — wall clock and the merge freeze are.

### 4. Measurement plumbing exists; extraction and variation do not

**Exists:** `generation_jobs.stages` is written once per completed stage (`runner.py:339-367`) as the contract's `StageReport` — `{tier, name, status, best?, bound?, wallClockS, stoppedBy?}` ([schema:189-221](https://github.com/dobrek/ib-timetable-planner/blob/80e2bcfa67542a0ff2e47f85464fc7030e1cab2d/contracts/generation-wire.schema.json#L189), `wire.py:139-155`, TS mirror `stage-report.ts:15-33`). Row-level `started_at`/`finished_at` give the end-to-end clock; `result.diagnostics.elapsedMs`/`stopReason` the run verdict. Interrupted and stopped runs keep their partial transcript. **The campaign does not need to build any measurement.**

**Missing:**
- **Variation.** Targets cannot reach the container (six-key forward list, pinned by test). Budgets have no knob at all — not in `Settings`, not in `runner.py`, not on the wire.
- **Extraction.** No script, mise task, or runbook reads hosted `generation_jobs` (`grep generation_jobs scripts/ bench/` → only a prose mention in `hosted.sh`). The S-302 numbers came from the Cloudflare container log export (`dataset: containers`), bracketed by the two `runner.py` log lines (`:264` "solving with N workers", `:320` "succeeded"). **There is no per-stage log line** — `_progress_reporter` writes the row and logs nothing. The one sanctioned hosted read path is `pnpm analyze:plans` with `ANALYZE_ALLOW_REMOTE=1` (`bench/plan-quality.analyze.ts`), which reads plans, not jobs.
- **Dispatch.** No tooling dispatches through the deployed Worker + container; a production run is a human clicking Generate in the deployed app. `mise run solver:hosted` is hosted DB + *native M4 solver* — its own banner says timing there is invalid (`hosted.sh:79-80`).
- **Observation runbook.** `docs/runbooks/` has no ops content for production solves (`plan-generation.md` is greedy-era and stale: "give it its budget (20 s)").
- **Cleanup.** Each production run creates a real `clone_plan` proposal (`pending_proposal`) plus a job row; S-304's "drill artifacts cleaned from hosted" step (6.5) also never ran.

### 5. The "hint-free Mode A" and "default-path switch" clauses

**Hints are real, not a figure of speech.** `_hint_board` (`solve.py:749-751`) calls `model.add_hint`; Mode A hints from `_greedy_board(dump)` at `solve.py:438`; the ladder re-hints the incumbent between stages (`:607-608`). But `dump.greedy_placements` is filled from `request["warmStart"]`, and the app never sends one (`generation-job.ts:247`: `{ formatVersion: 1, snapshot, policy }`). So **production already runs hint-free Mode A and without the tier-3 clique cut** (`runner.build_dump` sets `greedy_diagnostics={}`; `_add_clique_cuts` at `solve.py:676-685` reads `dump.lower_bound`). `runner.py:194-200` records the F-302 measurement in the shipped code. The engineering unknown is closed; the roadmap/PRD phrasing (`roadmap.md:252`, `prd.md:653`) survives only as a hardware caveat, and tier-1 `wallClockS` on any production run answers it.

Side effect worth stating: **Mode B is inert in production** (`solve_repair`'s neighbourhood is computed from `greedy_placements`; without a warm start the whole board reads as residue — F-302 research :183-186). The S-308 clause "small repair returns within an interactive budget" describes something that cannot run.

**The default-path switch already happened.** Single path: `use-cohort-board-state.ts:121-125` → `use-generation-job.ts:88-104` → `actions/index.ts:27`. No engine flag anywhere in `src/`; `contracts/generation-wire.schema.json:151` says "CP-SAT is the sole producer on this wire." FR-314 (`prd.md:583-586`) was corrected; `prd.md:205-207` ("Greedy remains the working Generate path until the calibration gate passes"), `prd.md:680-682` ("…and gates the default-path switch"), and `roadmap.md:239` still say otherwise.

### 6. The S-309 preconditions that touch S-308

| FR-314 precondition | Status | Note |
|---|---|---|
| Clique-bound derivation extracted out of greedy | **Not done** | `engines/greedy/problem.ts:110,136`; Python has no clique algorithm of its own (`schema.py:111-113` is a dict lookup). Since production never feeds `lowerBound`, extraction is a pure code move plus a decision about the field's future. |
| CP-SAT regression baseline pinned and executable | **Not done** | Only greedy-parity (`test_objective.py:24,44`, the golden-dump variant `skipif`-gated on a gitignored file) and format gates exist; `test_solve.py` pins structure, never quality. `clean-up-bench-generation/research.md:389` named S-308 as the successor of the deleted bench quality bar ("which S-308 produces anyway"). |
| Hint-free Mode A measured | **Done** (M4) | §5 |
| Calibration passed | **Not done** | this slice |
| Proposal flow shipped | **Done** | S-305/S-306/S-307 archived |

The campaign's per-stage `best` values on the production catalog *are* the raw material for a pinned baseline. Whether the executable test lands in S-308 or S-309 is a scoping call (§Open Questions).

## Code References

- `services/solver/src/cpsat_engine/solve.py:130-169` — `SolveConfig` defaults (120 s / 300 s / 30 s / seed 1); `:314` `solve_complete`; `:414-443` `_feasibility` + Mode A budget; `:438` greedy hint; `:610-615` targets applied per stage; `:788-816` `_StageStop` callback; `:854-866` `_stopped_by`; `:835` `max_time_in_seconds`
- `services/solver/src/cpsat_service/runner.py:262-285` — builds `SolveConfig` with workers/policy/targets/hooks only; `:194-200` hint-free note; `:264,:320` the only per-job log lines; `:339-367` incremental `stages` write
- `services/solver/src/cpsat_service/settings.py:30-58,110-136` — `DEFAULT_WORKERS=8`, "~21 minutes" comment, `SOLVER_STAGE_TARGETS` parser, `TARGETABLE_TIERS = range(2, 11)`
- `src/solver-container-env.ts:18-51` — the six forwarded keys, `CONTAINER_WORKERS = "4"`; `src/solver-container-env.test.ts:62` pins the list
- `src/solver-container.ts:20-34,76-104` — `sleepAfter = "30m"` with the S-304 rationale; `onActivityExpired` job-aware refusal
- `wrangler.jsonc:39-66` — `standard-4`, `max_instances: 1`, EEUR, `rollout_active_grace_period: 1200`; no `vars` block
- `contracts/generation-wire.schema.json:189-221,222-245` — `StageReport` shape; `SolveRequest` (no budget/target fields)
- `supabase/migrations/20260810200122_generation_jobs.sql:59-104` — columns incl. `stages`, `checkpoint`, `heartbeat_at`, `started_at`, `finished_at`
- `src/entities/timetable/model/generation/stage-report.ts:15-33` — TS projection; `clean-label.ts:47` the only consumer of `stages` (reads `best`, never `wallClockS`)
- `src/_pages/plan-detail/api/generation-job.ts:242-249` — dispatch awaits only the 202; `src/entities/timetable/api/solver-transport.ts:18-22,63-64`
- `src/_pages/plan-detail/model/generation/use-generation-job.ts:9-13,88-104` — "owns an ENQUEUE and a RE-READ", single CP-SAT path
- UI copy: `GenerateButton.tsx:111`, `StopAndKeep.tsx:42-44,99`, `PendingProposalPage.tsx:71,168`, `GenerationStatusStrip.tsx:75`, `plan-indicators.ts:197`
- `scripts/solver/hosted.sh:79-80` — "TIMING MEASURED HERE IS INVALID"; `bench/plan-quality.analyze.ts` — `ANALYZE_ALLOW_REMOTE=1`
- `src/entities/timetable/model/generation/engines/greedy/problem.ts:110,136` — clique derivations still inside greedy

## Architecture Insights

1. **Targets and budgets are different kinds of number, and the code treats them differently.** Targets are objective *values* — hardware-independent by design (PRD "Outcome reproducibility"), catalog-dependent by nature, and plumbed as env (`Settings → SolveConfig.targets`). Budgets are wall-clock — hardware-dependent, catalog-independent-ish, and *not* plumbed at all. A campaign that wants to ship both needs one new knob (budgets) and one new forward (targets). The cheapest honest deliverable is: forward `SOLVER_STAGE_TARGETS` as a seventh key sourced from a code constant beside `CONTAINER_WORKERS`, and add `SOLVER_STAGE_BUDGET_S` / `SOLVER_MODE_A_BUDGET_S` to `Settings` with the current literals as defaults, so "left unset, behaviour is exactly what it was" (the S-303 discipline) holds.

2. **On the current ladder, wall clock ≈ sum of budgets.** The POC showed tiers 3–10 burn their full budget on every run; production's 14.72 min ≈ ~1 s Mode A + 8 × 120 s confirms it. So "calibrating budgets" is not "measure how long it takes" — it is **measuring the marginal quality per extra minute per tier** (`best`/`bound` progression at 60 / 120 / 240 s) and making a product call about where the curve flattens. That is the actual scientific content of the campaign, and it is what `stages[].best` + `bound` were persisted for.

3. **Quality comparisons can be done off-production; only timing must be on-production.** Board quality is target-defined and hardware-independent (README § hosted campaign), so exploring *which tiers deserve targets and roughly at what values* can run through `mise run solver:hosted` on the M4 at zero container cost, with production runs reserved for the timing-dependent questions (budget per tier, 4 vs 8 workers on 4 vCPU, sleep boundary). This shrinks the production run count from "dozens" to roughly a handful per candidate budget.

4. **Targets are catalog properties; shipping them as a deployment constant is fragile.** `teacherHoles ≤ 148` is 2× one expert's result on one year's catalog, and the S-303 trap (a target below what the budget reaches never fires — it just silently degrades to budget-stop) means a stale target is harmless but useless. The campaign should say explicitly whether targets ship at all, or whether budgets alone (plus the existing target machinery for the next catalog) is the honest MVP.

5. **Non-determinism bounds what a campaign can conclude.** Two identical clean solves on the POC landed at incomparable boards. A single run per configuration is not a measurement; the campaign design needs ≥ 3 runs per cell or must confine itself to claims that survive that variance (e.g. "tier 3 reaches OPTIMAL within 120 s on production in N/N runs").

6. **The "gate" S-308 was meant to evaluate has become a document truing exercise.** Three stale clauses (`prd.md:205-207`, `prd.md:680-682`, `roadmap.md:239`) still describe a greedy fallback and a switch to gate. Per the lessons register ("a convention that cites a code mechanism is coupled to it"), those belong in this slice's definition of done.

## Historical Context (from prior changes)

- `context/changes/post-poc-cp-sat-refactoring-plan/research.md:44,130-140,210-211,394` — origin of the campaign idea, the 3–5× multiplier estimate, and "Phase 5 is the gate for switching the default generate path"
- `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md` — all POC numbers (M4), the policy frontier, the non-determinism observation
- `context/archive/2026-08-11-solver-service-transport/research.md:220-238` — hint-free Mode A measured and explicitly *not* a budget; Mode B inert without `warmStart` (`:183-186`)
- `context/archive/2026-08-15-solver-deploy-lane/change.md:57-112,145-154,491-501` — the single production run; `SOLVER_WORKERS=4` shipped explicitly "as the fixture S-308's calibration measures against"; cost note; "S-308 inherits whether 4 remains right"
- `context/archive/2026-08-19-staged-progress-and-checkpoints/change.md:56-66,111-112`, `plan.md:115`, `plan-brief.md:58` — `SOLVER_STAGE_TARGETS` ships empty; "no container forwarding of the knob (S-308)"; the target-below-reach trap
- `context/archive/2026-08-20-job-aware-container-lifecycle/plan.md:594-601,756-770`, `research.md:130,368,442,495`, `change.md:85-97` — Phase 6 designated S-308's inheritable numbers; Phase 6 unchecked; idle sleep unproven
- `context/archive/2026-08-14-clean-up-bench-generation/research.md:235-252,301,389` — bench quality bar deleted with S-308 named as successor; "a CP-SAT regression baseline … which S-308 produces anyway"
- `context/archive/2026-09-01-stop-and-keep/plan-brief.md:41,78` — stop-latency copy kept qualitative; worst case ≈ 5 min click→terminal
- `context/archive/2026-09-02-solve-policy-choice/research.md:311,528` — "Student-first has one POC run behind it and no calibration"

## Related Research

- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — the migration's founding research (Phase 5 = calibration)
- `context/archive/2026-08-20-job-aware-container-lifecycle/research.md` — lifecycle numbers and their invalidity off-production
- `context/archive/2026-08-15-solver-deploy-lane/research.md` — worker-count trade-off and container cost model

## Open Questions

1. **Re-scope or keep the outcome as written?** Recommended re-scope: strike "fast solves … or fall back to the background job" (no such path; Mode B inert) and "the calibration gate for the default-path switch" (moot); keep budgets, targets, the ceiling copy, and the recorded verdict; **add** S-304's Phase 6 (deploy-during-solve drill, renewal proof at `sleepAfter: 10m`, production numbers, README advisory) as inherited prerequisites. Owner: frame/plan phase.
2. **Do targets ship at all in this slice, or budgets only?** Targets are catalog properties (Insight 4). Options: (a) ship budgets + forward the target key with an empty default, values deferred to the first real planning season; (b) ship a conservative target on one or two tiers (e.g. `teacherHoles` at the expert bar). Owner: author + expert input (PRD Open Question 2).
3. **Where does the budget knob live?** Env (`Settings`) is consistent with targets and needs no image rebuild to tune; a code constant in `solve.py` is what exists. Recommended: env with current literals as defaults. Owner: plan phase.
4. **How are production rows extracted?** Options: a read-only `scripts/` query over hosted `generation_jobs.stages` (extending the `ANALYZE_ALLOW_REMOTE` precedent), or Studio by hand. Also whether to add a per-stage log line in `_progress_reporter` so the container log export carries stage timings too. Owner: plan phase.
5. **Does the CP-SAT regression baseline test land here or in S-309?** The campaign produces the pinned values; FR-314 lists the executable test as a retirement precondition. Owner: plan phase, with S-309 in view.
6. **Campaign design:** how many runs per cell given non-determinism (Insight 5); which budget candidates (60 / 120 / 240 s); whether to re-test 8 workers on `standard-4`; which production catalog/plan is the fixture; who holds the merge freeze during each ~15–28 min run; cleanup of the proposal plans and rows afterwards. Owner: plan phase.
7. **Fix the two inconsistent prose numbers** — `settings.py:35` "~21 minutes" and the PRD/`rollout_active_grace_period` "20-minute ceiling" vs the engine's 23-min (28-min with clean fallback) worst case. Owner: this slice.

## Follow-up Research 2026-09-03T15:05:00+02:00 — plain-language summary

**Goal.** Generate builds a complete timetable, then polishes it in ten rounds, one quality aspect per round. Each round runs until it proves optimality, exhausts its time allowance, or reaches a "good enough" score if one is set. Every allowance and score in production today is a proof-of-concept guess made on the developer's Mac. The project rule is that shipped numbers come only from measurements on the production server. The campaign takes those measurements and replaces the guesses.

**The parameters and what they mean in practice.**

| Parameter | Meaning for the author | Today | Changeable without a deploy? |
|---|---|---|---|
| Time per polishing round | how long each of the nine quality rounds may run; in practice every round uses all of it, so this *is* the run length | 2 min (guess) | No — literal in `solve.py` |
| Time for the fill step | reserve for placing every hour before polishing; actually takes ~1 s | 5 min (guess) | No — literal in `solve.py` |
| Good-enough score per round | lets a round finish early once a quality bar is met; values are catalog-specific | none set | No — container cannot receive the key |
| Solver threads | parallelism on the 4-core container; library recommends 8 | 4 | No — constant in Worker code |
| Container idle time after work | idle billing window; 10 min intended, 30 min stopgap | 30 min | No — constant in Worker code |
| Duration shown to the author | honest ceiling the product spec asks for | "several minutes", no number | No — UI strings |

**What the campaign actually measures.** Not "how long does it take" (that is the sum of allowances) but "how much better does each round get per extra minute" — using the per-round score and bound the app already saves on every job row. Several runs per setting are needed because identical runs land on different boards.

**What changed since the task was written.** The default-engine switch it was meant to gate already happened (S-301). The prerequisite lifecycle slice (S-304) was archived without its production drills, so a deploy still kills an in-flight solve; the campaign must freeze merges per run or finish those drills first.

**Cost.** A few dollars of compute for the whole campaign; the real cost is serial wall clock (15–25 min per run) and the merge freeze.
