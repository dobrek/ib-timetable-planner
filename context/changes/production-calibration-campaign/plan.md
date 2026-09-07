# Production Calibration Campaign (S-308) Implementation Plan

## Overview

Every solve budget on production is a proof-of-concept guess, and the project rule is that shipped numbers come only from measurements on the production container. Today nothing can be tuned there: the per-stage and Mode A budgets are dataclass literals the service never overrides, and the stage-target knob the container can parse is not among the six env keys the Worker forwards. This plan makes both reachable, proves the container lifecycle S-304 left unproven, runs a 12-run measured campaign on the deployed container, ships the budgets it defends, and trues up every document that still describes a greedy fallback waiting on a calibration gate.

## Current State Analysis

From `context/changes/production-calibration-campaign/research.md` (2026-09-03):

- **Budgets** — `SolveConfig.stage_budget_s = 120.0`, `mode_a_budget_s = 300.0` (`services/solver/src/cpsat_engine/solve.py:134-136`); `runner.py:269-283` builds `SolveConfig` with `workers`, `clean_mode`, `ladder`, `targets`, `hooks` only. Worst-case ladder: 300 + 9 × 120 = 23 min (28 min with the clean-infeasible fallback). `settings.py:35` says "~21 minutes"; the PRD and `rollout_active_grace_period: 1200` assume 20.
- **Targets** — parsed by `settings.py:110-136` (`SOLVER_STAGE_TARGETS`, tiers 2–10, degrade-never-crash), applied at `solve.py:610-615`. The Worker forwards exactly six keys (`src/solver-container-env.ts:25-43`), pinned by `solver-container-env.test.ts:62`. Targets cannot reach production.
- **Measurement** — `generation_jobs.stages` stores one contract `StageReport` per completed stage: `{tier, name, status, best?, bound?, wallClockS, stoppedBy?}` (`contracts/generation-wire.schema.json:189-221`; TS projection `src/entities/timetable/model/generation/stage-report.ts`). Row-level `started_at`/`finished_at` give the end-to-end clock. Nothing reads hosted rows; the one sanctioned hosted read is `bench/plan-quality.analyze.ts` via `createLocalSupabase({ allowRemote })`.
- **Production data** — exactly one recorded solve: 14.72 min, 248 placements, 4 workers, `standard-4` (`context/archive/2026-08-15-solver-deploy-lane/change.md:57-112`). The feared 3–5× M4→cloud multiplier measured ≈18 %.
- **Lifecycle** — S-304 archived with Phase 6 unchecked (`context/archive/2026-08-20-job-aware-container-lifecycle/plan.md:756-770`): no deploy-during-solve drill, `sleepAfter` still `"30m"` (`src/solver-container.ts:34`), README's hard no-merge rule in force (`README.md:290-292`), the five production numbers never recorded.
- **Dead clauses** — the interactive Mode A fallback has no code path (every Generate is 202-and-detach; Mode B inert without `warmStart`), and the default-path switch happened in S-301. `prd.md:205-207`, `prd.md:217-220`, `prd.md:680-682`, `roadmap.md:239` still describe them.
- **Hint-free Mode A** — measured in F-302 (OPTIMAL 0.7 s, M4); production already runs hint-free. Tier-1 `wallClockS` on any campaign run is the production re-measure.

## Desired End State

- The container's budgets and targets are Worker-forwarded constants beside `CONTAINER_WORKERS`, each with an env-parsed counterpart in `settings.py` whose absence means "engine default". The startup log line names them, so a container log proves which configuration a run used.
- `pnpm analyze:jobs` prints a per-job, per-tier table from hosted `generation_jobs` rows on request, read-only.
- A deploy during a production solve has been watched to interrupt, checkpoint, deliver the partial board, and self-heal. `sleepAfter` is `"10m"` and a >10-minute production solve has been watched to survive it. README's rule is an advisory.
- A ledger of 12 production runs (job id ↔ cell) with per-tier results lives in `change.md`, and the shipped budgets and worker count are the ones that ledger defends, with the reasoning written down.
- PRD, roadmap, README, `wrangler.jsonc` and `settings.py` prose agree with the code and the measurements: no greedy fallback, no interactive path, a measured ceiling, and `rollout_active_grace_period` derived from it.
- The per-tier `best` values of the shipped configuration are recorded as the pinned quality baseline S-309's executable test will assert.

**Verification:** `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean; `mise run solver:check` and `mise run solver:test` green; the campaign ledger and the production numbers present in `change.md`; the three stale doc sites rewritten.

### Key Discoveries:

- `settings.py` already has the exact parser shapes needed (`_positive_float` for a duration, degrade-never-crash) and a test file (`services/solver/tests/test_settings.py`) with one test per knob to mirror.
- `envVars` is a DO class field evaluated at construction and handed to the container at **start**; a Worker-only deploy does not restart a warm container, so a new constant takes effect only after the container sleeps and cold-starts (S-302 change.md: "a Worker-only diff can leave the image digest identical and the instance untouched").
- The base image is pinned by tag, not digest (README § Known gaps), so even a Worker-only merge *may* roll the container if `python:3.13-slim` moved. Campaign merges therefore happen only while the container is idle.
- The job row does not record which budgets or worker count produced it; `wallClockS` of budget-stopped stages is the only fingerprint. The campaign ledger maps job ids to cells by hand.
- The clean-mode fallback in `_feasibility` (`solve.py:325-329`) can burn a second Mode A budget that the tier-1 transcript does not show; `finished_at - started_at` versus `sum(wallClockS)` is where it appears.
- `vitest.analyze.config.ts` includes `bench/**/*.analyze.ts`, is outside `pnpm test` and CI, loads `.env.test.local`, and uses the verbose reporter so printed tables show — the extraction script drops in with no config work.
- `max_instances: 1`, `SOLVER_MAX_CONCURRENT_JOBS = 1`, and one active job per source plan make the campaign strictly serial.

## What We're NOT Doing

- **No interactive Mode A path and no Mode B.** Struck from the outcome (decision 1). The PRD guardrail "fast solves stay interactive" is rewritten to what shipped: a proposal job whose completeness stage is measured, never a synchronous answer.
- **No target values ship.** The target key is forwarded empty (decision 3); PRD Open Question 2 stays open on values and is annotated as deferred to the first real planning season on the then-current catalog.
- **No wire change.** Budgets and targets stay container configuration; `SolveRequest` and `formatVersion` are untouched.
- **No executable CP-SAT regression test.** The pinned per-tier values are recorded here; the test that asserts them on a fixture is S-309's precondition and lands there, where the fixture pipeline is decided.
- **No policy grid on production.** Canonical and student-first quality is hardware-independent; if a comparison is wanted, it runs through `mise run solver:hosted` locally, outside this slice.
- **No per-stage log line, no CI path filters, no off-Cloudflare hosting, no Docker layer caching.** The row is the record; the extraction script reads it.
- **No change to the solver's claim CAS** (`status=eq.queued`); app-side reclaim stays the recovery path.

## Implementation Approach

Two small code phases first, shipped at today's values so the container's behaviour is unchanged while the plumbing lands. Then the production lifecycle proof S-304 owed, because every campaign run depends on it and each drill run is itself a data point. Then the campaign as a sequence of Worker-only constant merges, one per cell, each applied to an idle container and verified through the startup log line, with results pulled by the extraction script into a ledger. Finally the shipped numbers, the prose they make true, and the recorded verdict.

Budget knobs follow the `SOLVER_WORKERS` pattern exactly: env in `settings.py`, degrade-never-crash, a pinned constant on the Worker side, a widened pin test. The engine's dataclass defaults stay the single source of truth: an unset env var means the runner does not pass the field.

## Critical Implementation Details

**Timing & lifecycle.** A constant change in `solver-container-env.ts` reaches the container only on its next cold start. Between campaign cells: confirm the previous job is terminal, wait for the container to sleep (10 min post-solve after Phase 3), merge the cell, and before dispatching confirm the new values in the container's startup log line (`solver service starting: … stage_budget_s=… mode_a_budget_s=…`). Never merge — cell or otherwise — while a job is `running`; with the base image pinned by tag, any merge may roll the instance.

**State sequencing.** Phase 1 is an image-changing merge (solver code) and rolls the container; Phase 3's drill needs one deliberately image-changing commit (a comment under `services/solver/`). Every Phase 4 cell is Worker-only. `sleepAfter` drops to 10m only after the renewal proof, not with Phase 1.

**Debug & observability.** Production evidence comes from two channels: `wrangler tail` for `[solver-container]` lines (cold start, "sleep declined", stopped), and the Cloudflare `containers` log dataset for the service's own lines (the startup line, `solving with N workers`, `succeeded`). The ledger records both timestamps plus the job id; `pnpm analyze:jobs` supplies the rest from the row.

## Phase 1: Knobs — budgets become configuration, targets reach the container

### Overview

Add the two budget env vars to the service, pass them into the engine, print them at startup, and forward them plus the target key from the Worker as pinned constants. Ships at today's values: `120` / `300` / empty. No behaviour changes; the diff is plumbing plus its docs.

### Changes Required:

#### 1. Service settings

**File**: `services/solver/src/cpsat_service/settings.py`

**Intent**: Add `stage_budget_s` and `mode_a_budget_s` to `Settings`, read from `SOLVER_STAGE_BUDGET_S` and `SOLVER_MODE_A_BUDGET_S`, so a deployment can set the ladder's time allowances the way it already sets workers and targets. Fix the "~21 minutes" comment on `DEFAULT_MAX_CONCURRENT_JOBS` to the true default worst case (23 min; 28 with the clean fallback).

**Contract**: Both fields are `float | None`, default `None`, parsed with `_positive_float`'s rule (malformed or non-positive → default with a stderr complaint). `None` means "the engine's own default" — the dataclass literal in `SolveConfig` remains the single source of truth and `settings.py` never repeats the number.

#### 2. Runner

**File**: `services/solver/src/cpsat_service/runner.py`

**Intent**: Pass the configured budgets into `SolveConfig` when set, alongside `workers` and `targets`, so a wrapper-driven solve honours the deployment's allowances.

**Contract**: When a budget setting is `None`, the corresponding `SolveConfig` field is not passed (or is `dataclasses.replace`d only when present) — an unconfigured container solves exactly as before. `repair_budget_s` is left alone: Mode B is unreachable from the app.

#### 3. Startup log

**File**: `services/solver/src/cpsat_service/app.py`

**Intent**: Extend the `solver service starting:` line with the effective budgets, so a container log proves which allowances a run used — the campaign's only fingerprint besides `wallClockS`.

**Contract**: `stage_budget_s=<value|engine-default> mode_a_budget_s=<value|engine-default>` appended to the existing line; the `<engine-default>` wording when unset, never a repeated literal.

#### 4. Service tests

**File**: `services/solver/tests/test_settings.py`, `services/solver/tests/test_service.py`

**Intent**: Pin the new knobs the way the existing ones are pinned: default is `None`, a value parses, a malformed value degrades with a complaint, a non-positive value degrades; and at the wrapper level, a configured budget reaches `SolveConfig` while an unconfigured one leaves the engine default intact.

**Contract**: One test per rule, mirroring the `SOLVER_STAGE_TARGETS` and heartbeat tests; the wrapper test asserts through whatever seam `test_service.py` already uses to observe the built config (extend it if none exists — do not reach into private state from the test).

#### 5. Worker forwarding

**File**: `src/solver-container-env.ts`, `src/solver-container-env.test.ts`

**Intent**: Forward `SOLVER_STAGE_TARGETS`, `SOLVER_STAGE_BUDGET_S`, `SOLVER_MODE_A_BUDGET_S` as explicit constants beside `CONTAINER_WORKERS`, so production configuration is visible in the repo and a campaign cell is a one-line diff.

**Contract**: `CONTAINER_STAGE_TARGETS = ""`, `CONTAINER_STAGE_BUDGET_S = "120"`, `CONTAINER_MODE_A_BUDGET_S = "300"` — explicit even where they equal the engine default, per the S-302 rule that a silent default is the one outcome that must not happen. The "six documented keys" test becomes nine and its comment names why each new key is safe to forward (tuning values, no privilege). The per-key docblock states that these values take effect on the container's next cold start.

#### 6. Developer-facing docs

**File**: `scripts/solver/dev.sh` (header comment), `README.md` (§ Tier 1 optional variables; the `SOLVER_STAGE_TARGETS` paragraph), `services/solver/README.md` (env table)

**Intent**: Document the two new variables next to the target knob, and update the "no values ship … S-308's job" sentences to say what now ships (the container constants) and where they live.

**Contract**: Prose only; every mention of a default cites the engine (`SolveConfig`) rather than repeating the number in a third place.

### Success Criteria:

#### Automated Verification:

- `mise run solver:check` and `mise run solver:test` green (new settings + wrapper tests included)
- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test` green; the widened pin test lists nine keys
- `pnpm build` clean; `mise run solver:image:build` + `SOLVER_MACHINE_PASSWORD=… mise run solver:image:smoke` pass (the image still resolves `contracts/` and accepts a golden request)

#### Manual Verification:

- `mise run solver:dev` with `SOLVER_STAGE_BUDGET_S=5` logs the value at startup and a local solve's budget-stopped stages report `wallClockS ≈ 5`; without the variable the startup line reads `engine-default` and stages report ≈ 120
- Merged to `main` on an idle container; the deployed container's startup log shows `stage_budget_s=120 mode_a_budget_s=300 stage_targets=<none>`

**Implementation Note**: After this phase and its automated verification, pause for manual confirmation before continuing. Phase blocks use plain bullets; the checkboxes live in `## Progress`.

---

## Phase 2: Extraction — `pnpm analyze:jobs`

### Overview

A read-only bench analyzer that turns hosted `generation_jobs` rows into the campaign's tables, built on the `plan-quality.analyze.ts` precedent so hosted access is the same deliberate override.

### Changes Required:

#### 1. The analyzer

**File**: `bench/generation-jobs.analyze.ts` (new)

**Intent**: Given a source plan id (or explicit job ids), load its `generation_jobs` rows and print, per job: id, `policy.preset`, status, `started_at`, `finished_at`, end-to-end minutes, `sum(wallClockS)` minutes, and a per-tier table of `tier · name · status · best · bound · wallClockS · stoppedBy`; then a per-tier summary across the selected jobs (min/median/max `best`, count OPTIMAL vs budget-stopped). It reports; it never judges.

**Contract**: `ANALYZE_SOURCE_PLAN=<plan-id>` or `ANALYZE_JOBS=<id,id,…>`; `ANALYZE_ALLOW_REMOTE=1` for hosted, through `createLocalSupabase({ allowRemote })`. Rows parsed with `parseStoredStages` from `@/entities/timetable` (never a local re-declaration of the stage shape). Follows the precedent's shape: `it.runIf(!ready)` prints usage; the only assertions are that loading succeeded. A flagged line when `finished_at - started_at` exceeds `sum(wallClockS)` by more than the Mode A budget (the invisible clean-fallback signal).

#### 2. Pure formatting helpers and their test

**File**: `bench/generation-jobs-report.ts` (new), `bench/generation-jobs-report.test.ts` (new)

**Intent**: Keep the table building pure and unit-tested, so the analyzer is a thin loader and the campaign tables are diffable across runs.

**Contract**: Input is rows already parsed (`StoredStageReport[]` plus the row's timestamps); output is strings. Covered by `pnpm test` via the existing `bench/**/*.test.ts` include.

#### 3. Script entry

**File**: `package.json`

**Intent**: `analyze:jobs` beside `analyze:plans`, same config.

**Contract**: `"analyze:jobs": "vitest run --config vitest.analyze.config.ts bench/generation-jobs.analyze.ts"`.

### Success Criteria:

#### Automated Verification:

- `pnpm test` green including the new report test
- `pnpm check`, `pnpm lint`, `pnpm steiger` green (`bench/` is outside the FSD graph; imports go through `@/entities/timetable`'s public API)

#### Manual Verification:

- Against the local stack after `pnpm test:integration src/test/generation-proposal.integration.test.ts`, `ANALYZE_SOURCE_PLAN=<id> pnpm analyze:jobs` prints the per-tier table for that job
- Against hosted with `ANALYZE_ALLOW_REMOTE=1`, the S-302 smoke job (`386b9d35…`) prints and its end-to-end minutes match the 14.72 recorded in S-302's change note

---

## Phase 3: Lifecycle proof — the S-304 Phase 6 this slice inherits

### Overview

Run the production drills S-304 planned and never ran, claim the `sleepAfter: 10m` dividend, record the five production numbers, and soften README's rule. Every run here happens at the Phase 1 defaults (120 s / 300 s / 4 workers) and the completed one doubles as the first 120 s campaign cell.

### Changes Required:

#### 1. Throwaway campaign plan on hosted

**File**: — (operational; recorded in `change.md`)

**Intent**: Clone the author's current real plan through the UI as `Calibration — <name>` so every campaign job and proposal hangs off one disposable source, and so the measured catalog is this year's real one.

**Contract**: One plan; its id recorded in the ledger. All Phase 3 and Phase 4 jobs dispatch from it. Deleted in Phase 5.

#### 2. Deploy-during-solve drill

**File**: — (operational; evidence into `change.md`)

**Intent**: Generate on the campaign plan; mid-solve (after stage 3 or later, so a checkpoint exists) merge a trivial **image-changing** commit (a comment under `services/solver/`); watch the rollout deliver SIGTERM. Verify: the row reaches `interrupted` with `checkpoint_stage_index` set, the next plan visit delivers the partial board with the "kept the board from stage N" label, Generate self-heals with a fresh job.

**Contract**: Run once, on purpose, on the campaign plan only. Evidence: `wrangler tail` excerpts, container log timestamps, SIGTERM→`interrupted` latency, stage reached.

#### 3. Lower `sleepAfter` and prove renewal

**File**: `src/solver-container.ts`

**Intent**: `sleepAfter = "10m"`; rewrite the docblock from the stopgap apology to the renewal invariant (activity expiry is a question the container answers, not a stop). Deploy (Worker-only), run a full solve on the campaign plan, confirm from `wrangler tail` that the "sleep declined … activity renewed" line fires at least once during the solve and the job succeeds; then that the idle container stops roughly 10 minutes after the solve ends.

**Contract**: One-line config change plus docblock. This solve is **campaign cell 120 s / 4 workers, run 1**; its job id goes in the ledger.

#### 4. Record the production numbers

**File**: `context/changes/production-calibration-campaign/change.md`

**Intent**: A dated Notes entry with the numbers S-304 designated as the only ones S-308 may inherit, now measured here: cold-start time (container start → 202), renewal cadence observed, idle sleep boundary after a solve at 10m, SIGTERM→`interrupted` latency, drill solve duration and stage reached.

**Contract**: Production-measured only; never an M-series or tier-3 figure.

#### 5. README rule → advisory; S-304 truing

**File**: `README.md` (§ Deployment warning), `context/foundation/roadmap.md` (S-304 entry, "Inherited from F-302" note), `context/foundation/prd.md` (FR-311 trailing note)

**Intent**: The no-merge rule becomes an advisory citing the drill: a merge mid-solve interrupts the solve, completed stages are kept and delivered, Generate self-heals; avoid it when a long solve's final stages matter. Roadmap and FR-311 notes say the reclaim shipped fail-forward and the claim CAS was deliberately not widened.

**Contract**: Prose only; each edit cites the drill evidence in `change.md` by date.

### Success Criteria:

#### Automated Verification:

- CI green on each merge (all four jobs + deploy)
- `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build` clean on the final tree of the phase

#### Manual Verification:

- Deploy-during-solve drill: row `interrupted` with checkpoint, partial board delivered with the stage label, Generate self-heals — evidence in `change.md`
- Renewal proof at `sleepAfter: 10m`: a >10-minute production solve completes with no mid-solve stop; idle sleep observed ~10 min post-solve
- The five production numbers recorded in `change.md`
- README advisory and roadmap/PRD S-304 truing merged

**Implementation Note**: Pause after this phase. Phase 4 must not start until the renewal proof is recorded.

---

## Phase 4: The campaign — 12 production runs

### Overview

Measure marginal quality per extra minute per tier at three stage budgets on 4 workers, then whether 8 workers on 4 vCPU changes the picture. Each cell is one Worker-only constant merge applied to an idle container; each run is one Generate on the campaign plan; each result is one `pnpm analyze:jobs` extract into the ledger.

### Changes Required:

#### 1. Cell protocol

**File**: `context/changes/production-calibration-campaign/change.md` (ledger)

**Intent**: Make every run attributable. Before a cell: previous job terminal, container asleep (10 min after the last job), merge the constant edit, wait for deploy, dispatch, confirm the startup log line shows the cell's values, record the job id. After each run: extract, paste the per-tier table, note anything the row cannot say (cold start, whether the clean fallback fired).

**Contract**: Ledger columns — cell (stage budget · Mode A budget · workers) · run # · job id · started · finished · end-to-end min · Σ wallClockS · per-tier `best`/`bound`/`status`/`stoppedBy`. Twelve rows minimum.

#### 2. Cells, in order

**File**: `src/solver-container-env.ts` (one constant per merge)

**Intent**: Vary only what the cell names.

**Contract**:
- Cell A — `CONTAINER_STAGE_BUDGET_S = "120"`, 4 workers: runs 1–3 (run 1 is Phase 3's renewal solve).
- Cell B — `"60"`, 4 workers: runs 1–3.
- Cell C — `"240"`, 4 workers: runs 1–3 (worst case ≈ 41 min each; the merge-freeze advisory applies).
- Cell D — the budget chosen from A–C, `CONTAINER_WORKERS = "8"`: runs 1–3.
- Mode A: `CONTAINER_MODE_A_BUDGET_S` stays `"300"` throughout; tier-1 `wallClockS` across all twelve runs is its measurement.

#### 3. Analysis

**File**: `context/changes/production-calibration-campaign/change.md`

**Intent**: Answer, per tier, whether `best` improves from 60 → 120 → 240 s beyond run-to-run variance; which tiers reach OPTIMAL within which budget; whether 8 workers on 4 vCPU improves `best` at the same budget or only changes which board comes back; what Mode A actually needs; whether the clean fallback ever fired. Pick the shipped stage budget where the per-tier curve flattens, the Mode A budget at a comfortable multiple of the observed tier-1 maximum, and the worker count the data supports.

**Contract**: A written verdict with the tables it rests on. A non-conclusion is a valid conclusion (e.g. "60 and 120 are indistinguishable on tiers 3–10 within variance; 120 kept for margin") — what is not valid is a number without the runs behind it.

### Success Criteria:

#### Automated Verification:

- CI green on every cell merge
- `pnpm test` green (the pin test tracks each constant edit)

#### Manual Verification:

- Twelve ledger rows with job ids, each run's startup log confirming the cell's values
- Per-tier analysis written; a shipped stage budget, Mode A budget and worker count chosen with reasoning
- No merge happened while a campaign job was `running` (the ledger notes each merge time against the previous job's `finished_at`)

---

## Phase 5: Ship, true up, record

### Overview

Land the chosen constants, cut the UI's "several minutes" to one measured ceiling constant, re-derive the rollout grace period, rewrite the stale prose, record the verdict and the pinned baseline values, and clean the hosted project.

### Changes Required:

#### 1. Shipped constants

**File**: `src/solver-container-env.ts`, `src/solver-container-env.test.ts`

**Intent**: Set `CONTAINER_STAGE_BUDGET_S`, `CONTAINER_MODE_A_BUDGET_S`, `CONTAINER_WORKERS` to the campaign's choice; the docblock cites the ledger entry by date.

**Contract**: The pin test asserts the shipped literals; `CONTAINER_STAGE_TARGETS` stays `""` with a comment naming the deferral (values per catalog, per season).

#### 2. Engine default comment

**File**: `services/solver/src/cpsat_engine/solve.py:134-136`

**Intent**: The dataclass defaults stay as the CLI/local default; their trailing comment states that production runs the container constants and points at `solver-container-env.ts`.

**Contract**: Comment only; the literals are not retuned from M4 runs.

#### 3. UI ceiling

**File**: `src/entities/timetable/model/generation/tier-labels.ts`; `src/_pages/plan-detail/ui/GenerateButton.tsx:111`, `.../StopAndKeep.tsx:42-44,99`, `.../PendingProposalPage.tsx:71`, `.../GenerationStatusStrip.tsx:75`

**Intent**: Replace the four "several minutes" phrasings with one shared, honest ceiling sourced from a single constant beside `LADDER_TIER_COUNT`, so the author reads "up to about N minutes" where N is the shipped ladder's worst case rounded up.

**Contract**: `LADDER_CEILING_MINUTES` with a docblock deriving it from the shipped `CONTAINER_MODE_A_BUDGET_S + 9 × CONTAINER_STAGE_BUDGET_S` and naming the coupling (a container constant change must revisit it — the entities layer cannot import `src/solver-container-env.ts`). `StopAndKeep`'s docblock updates its "no number is quoted" rationale to "the ceiling, not a latency, is quoted".

#### 4. Rollout grace period

**File**: `wrangler.jsonc`

**Intent**: Set `rollout_active_grace_period` from the shipped ceiling rather than the PRD's assumed 20 minutes, and rewrite its comment: S-304's guards are in, the drill evidence is in `change.md`, the value is belt over braces.

**Contract**: Value = shipped worst-case ladder seconds, rounded up to the minute; comment cites the ledger.

#### 5. Prose truing

**File**: `context/foundation/prd.md` (Guardrails :205-207, Non-functional guardrails :217-223, Tuning discipline :680-682, Open Question 2 :790-794), `context/foundation/roadmap.md` (S-308 entry :237-249; Open Roadmap Question 2; Parked "off-Cloudflare" line), `README.md` (§ Tier 1 optional variables, § hosted campaign timing note, § Deployment ceiling wording), `services/solver/src/cpsat_service/settings.py:35`

**Intent**: The PRD stops describing a greedy fallback and an interactive path; the non-functional guardrail reads "the completeness stage measured at ≤ N s on production; the full ladder ceiling is N minutes, communicated in the UI". The roadmap's S-308 outcome becomes what this plan delivered, with the struck clauses noted and dated. Open Question 2 records the deferral. The off-Cloudflare parking note records whether the 4-vCPU ceiling bound (it did not, on the evidence, unless the ledger says otherwise).

**Contract**: Every number cites the ledger; every struck clause is dated, not silently deleted (the archive convention in this repo).

#### 6. Verdict and baseline

**File**: `context/changes/production-calibration-campaign/change.md`

**Intent**: The FR-314 "calibration passed" record: the shipped configuration, the ledger it rests on, and the per-tier `best` values of the shipped cell's runs as the pinned quality baseline for S-309's executable test (min/median/max per tier, plus the run that produced the delivered board).

**Contract**: One dated Notes entry titled so S-309's plan can cite it.

#### 7. Hosted cleanup

**File**: — (operational)

**Intent**: Delete the campaign plan and every proposal it produced through the UI's delete path (S-306/`generation-deletion-integrity` cascades jobs), so production holds no calibration residue.

**Contract**: Recorded in the ledger's closing line with the count deleted.

### Success Criteria:

#### Automated Verification:

- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean; `mise run solver:check` green
- CI green on the shipping merge

#### Manual Verification:

- Deployed container's startup log shows the shipped constants; one final production Generate succeeds at them and lands within the ceiling the UI now states
- PRD, roadmap, README, `wrangler.jsonc`, `settings.py` prose rewritten; no remaining mention of a greedy fallback gate or an interactive Mode A path (`grep -n "calibration gate\|interactive budget\|Greedy remains" context/foundation/*.md README.md` returns only dated strike-through notes)
- Verdict and baseline entry present in `change.md`; hosted project free of calibration plans and proposals

---

## Testing Strategy

### Unit Tests:

- Python: each new settings knob — default `None`, parses, malformed degrades, non-positive degrades; wrapper-level — configured budgets reach `SolveConfig`, unconfigured leave the engine default (`services/solver/tests/test_settings.py`, `test_service.py`)
- TS: the nine-key forward list and each constant's literal (`src/solver-container-env.test.ts`); the report formatter (`bench/generation-jobs-report.test.ts`) — tier table, summary across jobs, the clean-fallback flag when end-to-end exceeds Σ `wallClockS` by more than the Mode A budget

### Integration Tests:

- Existing `generation-proposal.integration.test.ts` and `solver-transport.integration.test.ts` stay green with the service started under an explicit `SOLVER_STAGE_BUDGET_S` (CI's integration lane may set a small value to keep the fixture fast; the row's `wallClockS` then proves the knob end to end)

### Manual Testing Steps:

1. Phase 1: local `solver:dev` with and without the budget variables; check the startup line and a local job's `wallClockS`
2. Phase 2: `pnpm analyze:jobs` on a local job, then on the hosted S-302 smoke job
3. Phase 3: the drill, the renewal proof, `wrangler tail` open throughout
4. Phase 4: the cell protocol per run; startup line checked before every dispatch
5. Phase 5: one final production Generate at the shipped constants; UI ceiling text read on the pending proposal page

## Performance Considerations

The drag-drop validation path is untouched. The only runtime change is which numbers the ladder runs under; a shorter stage budget shortens every Generate proportionally. The pin-test widening and the analyzer add nothing to the app bundle (`bench/` and `src/solver-container-env.ts` are outside the islands' import graph).

## Migration Notes

No schema change. Phase 1 rolls the container once (image change); the campaign's merges are Worker-only and take effect at the container's next cold start. Roll-forward only, as README § Rollback states — a bad shipped constant is fixed by another Worker-only merge.

## References

- Research: `context/changes/production-calibration-campaign/research.md`
- S-304's unrun Phase 6: `context/archive/2026-08-20-job-aware-container-lifecycle/plan.md:557-640`
- The one production run and cost note: `context/archive/2026-08-15-solver-deploy-lane/change.md:53-112,145-154`
- Target knob precedent: `context/archive/2026-08-19-staged-progress-and-checkpoints/change.md:56-66`
- Hosted-read precedent: `bench/plan-quality.analyze.ts`, `bench/local-supabase.ts`
- Settings pattern: `services/solver/src/cpsat_service/settings.py`, `services/solver/tests/test_settings.py`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Knobs — budgets become configuration, targets reach the container

#### Automated

- [x] 1.1 `mise run solver:check` and `mise run solver:test` green (new settings + wrapper tests included)
- [x] 1.2 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test` green; the widened pin test lists nine keys
- [x] 1.3 `pnpm build` clean; `mise run solver:image:build` + `mise run solver:image:smoke` pass

#### Manual

- [ ] 1.4 `mise run solver:dev` with `SOLVER_STAGE_BUDGET_S=5` logs the value and budget-stopped stages report `wallClockS ≈ 5`; without it, `engine-default` and ≈ 120
- [ ] 1.5 Merged on an idle container; deployed startup log shows `stage_budget_s=120 mode_a_budget_s=300 stage_targets=<none>`

### Phase 2: Extraction — `pnpm analyze:jobs`

#### Automated

- [ ] 2.1 `pnpm test` green including the new report test
- [ ] 2.2 `pnpm check`, `pnpm lint`, `pnpm steiger` green

#### Manual

- [ ] 2.3 Local: `ANALYZE_SOURCE_PLAN=<id> pnpm analyze:jobs` prints the per-tier table for an integration-test job
- [ ] 2.4 Hosted: the S-302 smoke job prints and its end-to-end minutes match the recorded 14.72

### Phase 3: Lifecycle proof — the S-304 Phase 6 this slice inherits

#### Automated

- [ ] 3.1 CI green on each merge (all four jobs + deploy)
- [ ] 3.2 `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build` clean on the phase's final tree

#### Manual

- [ ] 3.3 Deploy-during-solve drill: `interrupted` with checkpoint, partial board delivered with stage label, Generate self-heals — evidence in `change.md`
- [ ] 3.4 Renewal proof at `sleepAfter: 10m`: >10-minute production solve completes; idle sleep ~10 min post-solve
- [ ] 3.5 The five production numbers recorded in `change.md`
- [ ] 3.6 README advisory and roadmap/PRD S-304 truing merged

### Phase 4: The campaign — 12 production runs

#### Automated

- [ ] 4.1 CI green on every cell merge
- [ ] 4.2 `pnpm test` green (pin test tracks each constant edit)

#### Manual

- [ ] 4.3 Twelve ledger rows with job ids, each run's startup log confirming the cell's values
- [ ] 4.4 Per-tier analysis written; shipped stage budget, Mode A budget and worker count chosen with reasoning
- [ ] 4.5 No merge happened while a campaign job was `running`

### Phase 5: Ship, true up, record

#### Automated

- [ ] 5.1 `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` clean; `mise run solver:check` green
- [ ] 5.2 CI green on the shipping merge

#### Manual

- [ ] 5.3 Deployed startup log shows the shipped constants; a final production Generate succeeds within the UI's stated ceiling
- [ ] 5.4 PRD, roadmap, README, `wrangler.jsonc`, `settings.py` prose rewritten; no undated mention of a greedy fallback gate or interactive Mode A path remains
- [ ] 5.5 Verdict and baseline entry present in `change.md`; hosted project free of calibration plans and proposals
