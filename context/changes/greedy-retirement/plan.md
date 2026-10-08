# Greedy Retirement (S-309) Implementation Plan

## Overview

Delete the greedy generation engine and the dormant Python clique cut it used to feed, and give FR-314 the precondition it still lacks: a CP-SAT regression baseline that is **pinned and executable**. The baseline lands as two pytest tests in the `solver` lane that drive the production code path. Every doc and tracker that still describes greedy as live is brought up to date.

## Current State Analysis

**Greedy has no production caller.**

- Generate has run CP-SAT since S-301, and the Web Worker path was deleted by `clean-up-bench-generation`.
- The engine is a leaf: `src/entities/timetable/model/generation/engines/greedy/`, 10 files and 2,015 lines.
- It is reached only through:
  - the barrel line `src/entities/timetable/index.ts:38-40`;
  - three tests beside the package (`engine-fuzz.test.ts`, `generation-smoke.test.ts`, `quality-bar.test.ts`);
  - two bench experiments (`bench/generation.experiment.ts`, `bench/export-snapshot.experiment.ts`).
- The four page-slice mentions are comments only.

**FR-314 names three preconditions, and only one is met** (research §Summary):

| Precondition                                     | State                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hint-free Mode A measured                        | Done in S-308 (3.18–6.16 s)                                                                                                                                                                                                                                            |
| Clique-bound derivation extracted                | Resolved by decision **R1b** (`change.md`, 2026-10-08). The cut has never run on a production solve: `build_dump` gives the engine empty diagnostics (`services/solver/src/cpsat_service/runner.py:204-223`). S-309 deletes it on both sides instead of extracting it. |
| CP-SAT regression baseline pinned and executable | Pinned in S-308 (`context/archive/2026-09-03-production-calibration-campaign/change.md:217-242`). Not executable: the instance is deleted, the data cannot be committed, each run takes ~28 min, and CP-SAT is nondeterministic.                                       |

**The coupling to greedy sits in data, not imports.** `seed-plan-a.json` holds greedy's board, `SEED_OBJECTIVE` and `lowerBound` 48/45, and `bench/export-snapshot.experiment.ts` is its only producer. Python reads the fixture as frozen data, so nothing turns red when greedy goes; only the ability to regenerate it is lost.

**No current test checks what the cut does.**

- It runs silently in three seed tests: `test_solve.py:149-153`, and the two live tests in `test_stage_stop.py:383-490`.
- Two tests assert that `lowerBound` is _absent_ (`test_solve.py:353-355`, `test_contract.py:264-273`). They stay green.
- `contracts/fixtures/solve-request.json` is never solved in pytest today.

## Desired End State

- `engines/greedy/` and its satellites no longer exist. The satellites are three tests, two `__fixtures__`, `rng.ts`, `generation.experiment.ts`, `deriveGoldenSets`, `SEARCH_TIERS` with the polish gate, `"stagnation"`, and the hooks types.
- `pnpm check`, `lint`, `steiger`, `test` and `build` are green.
- The Python engine has no clique cut and no `lower_bound`, and none of their orphans remain. The parity gate stays at exact 10/10, and the rest of the suite is green.
- `services/solver/tests/test_baseline.py` runs on every CI run in the `solver` lane:
  - **C, descent capability:** a 12-course catalog where tier 3 proves OPTIMAL at exactly 14 slots.
  - **A, production-path tripwire:** the committed `solve-request.json` with `warmStart` removed, run through `run_job` at 4 workers.
    - Exact: complete; `unplacedTotal`, `holes` and `softHits` = 0; clean fallback did not fire.
    - Bounded: `totalSlots` and `teacherHoles`, with bounds calibrated on the GitHub runner and recorded with their evidence.
- `bench/export-snapshot.experiment.ts` is hint-free, so the export → CLI → import loop and fixture production still work.
- No `contracts/` byte changes and no `formatVersion` bump. The schema, the goldens and `lowerBound` (optional) are untouched except for prose.
- The PRD (FR-314, success criterion 6, engine transition), the roadmap (S-309), the runbook, the contract and solver READMEs, the CLAUDE.md solver rules, the README/`ci.yml` timing claims, GitHub #106/#108 and the memory note all describe the post-greedy world.

### Key Discoveries:

- **The production path.** `run_job` (`runner.py:146-201`) runs `build_dump` → `resolve_policy` → `_solve_and_write` → `SolveConfig` + `_with_budgets` → `solve_complete`.
  - Tests drive it synchronously with `FakeSupabase`, an `httpx.MockTransport` (`tests/test_service.py:98-208`, `_run_registered` at `:259-275`).
  - The config and result are captured by patching `cpsat_service.runner.solve_complete` with a delegating recorder (`test_service.py:766-788`).
- **Tier order is fixed** (`objective.py:59-70`): `unplacedTotal, holes, totalSlots, teacherHoles, softHits, studentHoles, doublesDeficit, lateStarts, fridayTail, goldenBandDistance`.
- `evaluate_board(dump, board)` (`solve.py:245-259`) gives the delivered 10-tuple. `SolveResult.stages` carries per-stage `status`/`best`/`bound` (`solve.py:32-55`), and `SolveResult.clean_fallback` (`:62`) is the typed fallback flag.
- **R1b leaves three orphans** that `change.md` doesn't list:
  - `_residue` (`solve.py:775-781`), whose only caller is the cut;
  - `_run_ladder`'s `dump` parameter (`:575`), whose only use is `:611`; its callers are `:270`, `:384` and `:482`;
  - `ObjectiveModel.cohort_slots` (`objective.py:51,71`). `_cohort_slot_vars` stays, because tier 3 is built from it at `objective.py:62`.

  Ruff's `ARG` rule is off, so none of them would be flagged.

- **The descent catalog** (`__fixtures__/descent-catalog.ts:43-54`):
  - dp1 only, 5 days × 6 periods, 12 agnostic courses, 28 h, one teacher each, students `s0`–`s7`, no pins.
  - The 14-hour clique is {c0, c2, c3, c4, c11, c5}.
  - `tests/builders.py` defaults `periods=10` and `hours=4`, so both must be set explicitly.
- **TS residue consumers** (TS audit):
  - `run.test.ts:70` asserts the hooks argument.
  - `SEARCH_TIERS` is used only by `objective.ts:108` and `objective.test.ts:100-108`.
  - `deriveGoldenSets` is used only by `golden-sets.test.ts:23-96`; the `GOLDEN_*` constants stay live, through `objective.ts` and `analysis/slot-census.ts`.
  - `scoreCandidate`'s callers (`campaign-ledger.ts:196` and the exporter) both use the default `tiers`.
- **`pnpm check` type-checks `bench/`** (`tsconfig.json` includes `**/*`), so a stale bench importer turns CI red. The bench edits must land before or with the deletion.
- **`services/solver/Dockerfile:33-34` copies `contracts/` and the solver package**, so Phases 1, 2 and 5 change the image and the merge rolls the container.
- **The repo is public**, so CI's `ubuntu-latest` has 4 vCPUs, the same as production's `CONTAINER_WORKERS=4`. The `solver` job measured 2m01s (pytest 98 s); the `ci.yml:265` and `README.md:383` "44 s" claims are stale.

## What We're NOT Doing

- **R2**: a Python-native, parked-safe clique bound turned on in production. It is a separate CP-SAT follow-up that re-pins this baseline afterwards.
- Renaming `greedy_placements`/`greedy_diagnostics`, or the dump's `greedy` key, to warm-start names. That is bench transport and needs a separate follow-up.
- Removing `lowerBound` from the wire schema or the TS types, which would force a `formatVersion` bump. The result golden stays a recorded artifact carrying 48/45.
- Regenerating any contract golden or `seed-plan-a.json`, both frozen as recorded artifacts.
- Asserting S-308's production tuples. The S-308 ledger stays the documented, non-asserted production reference.
- An exact-tuple golden via `interleave_search` (experimental mode, plateaus, cross-arch unverified), and any production re-check as a CI test.
- Narrowing `engine: string` or `provenOptimal`, or deleting `compareObjectives` (a named S-307 dominance follow-up consumer), `GeneratePlan` or `budgetMs`. S-309 stays out of the page slices.
- Porting `engine-fuzz.test.ts`, `generation-smoke.test.ts` or the synthetic quality-bar case. The integration and e2e lanes run the oracle on real CP-SAT boards, and `verify.test.ts` covers rejections.
- The sibling change `automate-production-calibration-campaign`: its F1 and its stale ledger paths (`.gitignore:76`, `bench/campaign/main.ts:366`, `docs/runbooks/calibration-campaign.md:261`) stay with it. The two changes proceed in parallel.
- Archive bodies, `shape-notes.md`, the post-POC research body, the page-slice epitaph comments, and the PRD's dated baseline sections.

## Implementation Approach

Five phases, each one commit:

1. **The guard goes in first.** Phase 1 pins the executable baseline before any CP-SAT code changes.
2. Phase 2 removes the dormant cut. The baseline runs on the production path, where the cut never fires, so it must pass unchanged across Phase 2. That is the point of the ordering.
3. Phase 3 cuts `bench/` loose from greedy, so that Phase 4's deletion is a single, revertable commit that type-checks on its own.
4. Phase 5 updates the documentation.

Deletion is one-way. Keeping Phase 4 isolated is what makes a revert cheap if something surprising surfaces.

## Critical Implementation Details

**Calibrate on the runner, never on the laptop.** Baseline A's bounds are wall-clock-sensitive. M-series numbers are 3–5× faster and would set bounds a loaded CI runner cannot meet; the PRD and README forbid M-series-derived numbers anywhere they would bind. The bounds come from about 10 runs of A on `ubuntu-latest`, collected by a temporary CI matrix commit that is reverted before merge. The matrix spreads the runs across several jobs, so the samples cover more than one runner host, the way unrelated PRs will. Each bound is `worst observed + max(2, ceil(0.10 × worst observed))`. The test records the date, the CI run id and the observed min/median/max beside the constants.

**A's exact assertions get the same stop rule as C.** `holes == 0`, `softHits == 0` and "clean fallback did not fire" rest only on an M-series scratchpad probe (research §3). Holes is tier 2 under a 10 s wall-clock budget, so it is budget-sensitive on a slower runner, and S-308's proven zeros come from a different instance. If any calibration sample fails an exact assertion, **stop and surface it**: the author decides whether to raise the stage budget or demote that tier to a bounded one. Never loosen an exact assertion silently.

**C must prove the optimum, not merely reach it.** Assert that the tier-3 stage's `status == "OPTIMAL"` and `best == 14`; a FEASIBLE 14 is not a proof. If the ladder cannot prove 14 under the clean preset (for example because tier-2 hardening constrains tier 3), **stop and surface it**. Do not loosen the assertion: the research probe (0.3–1.3 s to prove 14) was scratchpad evidence and has not been reproduced in-suite.

**Watch item, `test_stage_stop` timing without the cut.** The two live seed tests (`test_stage_stop.py:383-490`, 8 workers, 25 s ceiling) were written while the cut was active. After Phase 2, run them 5× locally and confirm CI. If either nears its ceiling, raise it and record why. Never re-add the cut to make a test pass.

**Merge timing.** Phases 1, 2 and 5 change the solver image, so the merge rolls the container. Per the README, do not merge to `main` while a production solve is running; the rescue path is still unexercised.

## Phase 1: Executable baseline (Python, `solver` lane)

### Overview

Add the descent capability test (C) and the production-path tripwire (A) as one new test module, and calibrate A's bounds on the GitHub runner. After this phase, FR-314's "pinned and executable" precondition is met.

### Changes Required:

#### 1. Shared fake transport

**File**: `services/solver/tests/fakes.py` (new), `services/solver/tests/test_service.py`

**Intent**: Move `FakeSupabase` and `RecordedCall`, plus the constants and JWT helper they need, out of `test_service.py` into an importable helper beside `builders.py`. The baseline can then drive `run_job` without importing from another test module.

Move the runner helpers `_run` and `_run_registered` (`test_service.py:252-275`) and `SETTINGS` (`:73-81`) as well:

- The claimed row's `snapshot_hash` defaults to None, and only `_run_registered` fills it from the request. Without it, `_snapshot_mismatch` fails the job.
- The baseline derives its settings from `SETTINGS` with `dataclasses.replace`: workers, budgets.

**Contract**:

- A pure move: `test_service.py` imports from `fakes`, and its 83 tests are unchanged.
- The module is mypy-strict clean.

#### 2. Register the `baseline` marker

**File**: `services/solver/pyproject.toml` (`[tool.pytest.ini_options]`, `:56-58`)

**Intent**: Let a developer run `-m "not baseline"` for a fast local loop, and let the calibration loop select only the baseline. CI runs everything (bare `uv run pytest`).

**Contract**: `markers = ["baseline: production-path regression baseline (S-309) — bounds calibrated on the GitHub runner"]`.

#### 3. The baseline module

**File**: `services/solver/tests/test_baseline.py` (new)

**Intent**: Two `@pytest.mark.baseline` tests, both driven through `run_job` + `FakeSupabase`, which is the production entry point. Both capture the `(dump, SolveResult)` pair with the delegating `solve_complete` recorder.

**Contract**:

- **C, `test_descent_catalog_proves_the_clique_optimum`**
  - Input: the descent catalog rebuilt with `builders` as a `SolveRequest` (`wire_snapshot`, default clean policy, dp2 empty).
  - `Settings`: `workers=4`, with a modest stage budget of 15–20 s, about 10× the research probe's 0.3–1.3 s tier-3 proof. Use a similar Mode A budget.
    - Not "generous": CP-SAT stops early only on OPTIMAL. Any tier from 4 to 10 that fails to prove on this catalog (day symmetry in the hole tiers is plausible) burns its full budget on every CI run.
    - C asserts only tier 3, so the later tiers need not prove.
  - Asserts:
    - the job succeeds;
    - the tier-3 `StageReport` has `status == "OPTIMAL"` and `best == 14`;
    - `evaluate_board(...)[2] == 14`;
    - `unplacedTotal == 0`.
  - The docstring cites the 14-hour clique {c0, c2, c3, c4, c11, c5} as the proof that 14 is the floor.

- **A, `test_production_path_baseline_on_the_seed_catalog`**
  - Input: `contracts/fixtures/solve-request.json` with `warmStart` removed, because the app never sends one. Read the file; do not copy it.
  - `Settings`: `workers=4`, `mode_a_budget_s=60` (production's value), `stage_budget_s` about 10 s (aim for the whole test at ≤ ~90 s on the runner), no stage targets.
  - Asserts:
    - the job succeeds;
    - `SolveResult.clean_fallback is False`;
    - the tuple from `evaluate_board` has `[0] == 0`, `[1] == 0` and `[4] == 0`;
    - `[2] <= TOTAL_SLOTS_BOUND` and `[3] <= TEACHER_HOLES_BOUND`.
  - Always prints one `baseline:` line with the full tuple and the wall clock, which the calibration loop and CI logs read.
  - The bound constants carry a comment block with:
    - the calibration date, runner, CI run id and the ten observed values (min/median/max);
    - the formula;
    - the rule that they are re-calibrated only on the runner;
    - a pointer to S-308's ledger as the production reference.

#### 4. Calibration (temporary, not merged)

**File**: `.github/workflows/ci.yml` (`solver` job), as a temporary commit on the branch only

**Intent**: Collect about ten samples of A on `ubuntu-latest`.

- First land A with the exact assertions and the printed line, but no bounds. The `baseline:` line is printed **before** any assertion, so a failing sample still reports its tuple.
- Then push a temporary commit that adds a calibration matrix to the `solver` job: 5 jobs × 2 runs of `uv run pytest -m baseline -k production_path -s`.
  - Wrap each run in `|| true`. Actions runs `run:` steps under `bash -eo pipefail`, so without it the first red run would end the loop and its remaining samples would be lost.
  - Use `strategy.fail-fast: false`, so one red job does not cancel its siblings.
- Read the ten `baseline:` lines.
  - If any sample fails an exact assertion, stop and surface it (see Critical Implementation Details).
  - Otherwise set the bounds with the formula, and revert the temporary commit.

**Contract**: The squash-merged diff contains no `ci.yml` change from this step. The evidence (run id plus the ten tuples) goes into the test's comment block and into `change.md`.

#### 5. Reword the S-308 baseline formatter

**File**: `bench/campaign-baseline.ts:5-6`, `bench/campaign-baseline.test.ts:6-8`

**Intent**: These comments say "S-309's executable test will assert against this block". Restate them: the block is the documented production reference, and the executable tripwire is `services/solver/tests/test_baseline.py`, on a committed instance.

**Contract**: Comment-only.

### Success Criteria:

#### Automated Verification:

- [ ] Baseline tests pass: `cd services/solver && uv run pytest -m baseline`
- [ ] Full Python suite passes, `test_service.py` unchanged in count: `cd services/solver && uv run pytest`
- [ ] Type gate passes over src + tests: `cd services/solver && uv run mypy`
- [ ] Lint passes: `cd services/solver && uv run ruff check`
- [ ] Bench unit tests pass: `pnpm test bench/campaign-baseline.test.ts`
- [ ] CI `solver` job green on the PR branch after the calibration commit is reverted

#### Manual Verification:

- [ ] Ten calibration samples collected from the GitHub runner across the matrix jobs, every exact assertion holding in every sample, and the bounds set per the formula. Evidence (run id, tuples) recorded in the test and in `change.md`.
- [ ] Baseline A wall clock on the runner ≤ ~90 s, C's wall clock recorded beside it (expected ~1 s; a much larger figure means a later tier is not proving), and the `solver` job still well under the `e2e` critical path.
- [ ] Mutation check: temporarily set `TOTAL_SLOTS_BOUND` below the observed minimum and see A fail; temporarily change the C expectation to 13 and see C fail. Revert both.

**Implementation Note**: After the automated checks pass, pause for the human to confirm the calibration evidence before Phase 2.

---

## Phase 2: Retire the dormant clique cut (R1b + orphans)

### Overview

Delete the Python cut and everything that exists only to feed it. Nothing changes on the production path, which never had a bound. The seed-fixture tests stop injecting `>= 48 / >= 45`.

### Changes Required:

#### 1. Engine

**File**: `services/solver/src/cpsat_engine/solve.py`

**Intent**: Remove the cut, its echo and its orphans.

**Contract**:

- Delete `_add_clique_cuts` (`:690-699`) and its call (`:610-611`).
- Delete `_residue` (`:775-781`). `_residue_from_deficits` stays, because `_neighbourhood` uses it.
- Drop the `dump` parameter from `_run_ladder` (`:572-575`) and from its three callers (`:270`, `:384`, `:482`).
- Delete the `lowerBound` echo in `to_generation_result` (`:520-525`), so cohort diagnostics never carry the key.
- Rewrite the docstrings at `:10-12` and `:504-506` so they no longer describe a cut or a bound.

#### 2. Objective model

**File**: `services/solver/src/cpsat_engine/objective.py`

**Intent**: Drop the field that existed only as the cut's anchor.

**Contract**:

- `ObjectiveModel` keeps only `tiers`; remove `cohort_slots` (`:51`, `:71`).
- `_cohort_slot_vars` and its use at `:62` stay.
- Update the docstrings at `:48`, `:54-56` and `:141-143`.
- The order of `build_objective`'s tuple is untouched, because the parity gate keys on it.

#### 3. Dump

**File**: `services/solver/src/cpsat_engine/schema.py`

**Intent**: Remove the bound accessor.

**Contract**:

- Delete `Dump.lower_bound` (`:111-114`).
- `greedy_placements`, `greedy_diagnostics` and `load_dump`'s required `greedy` key stay (`test_schema.py:72-79` reads `greedy_diagnostics`).

#### 4. Runner docstring and test comments

**File**: `services/solver/src/cpsat_service/runner.py:207-211`, `services/solver/tests/test_solve.py:353-354`, `services/solver/tests/test_contract.py:265-266`

**Intent**: These comments explain the absence of `lowerBound` by the empty diagnostics. Restate them: no engine produces a bound (S-309), and the key stays optional on the wire.

**Contract**: Prose only. The assertions are unchanged and stay green.

### Success Criteria:

#### Automated Verification:

- [ ] Objective parity stays exact 10/10: `cd services/solver && uv run pytest tests/test_objective.py`
- [ ] Baseline unchanged and green: `cd services/solver && uv run pytest -m baseline`
- [ ] Full Python suite passes: `cd services/solver && uv run pytest`
- [ ] No reference to the removed symbols remains: `grep -rn "lower_bound\|_add_clique_cuts\|cohort_slots\b\|_residue(" services/solver/src services/solver/tests` lists only the local `cohort_slots = _cohort_slot_vars(...)` and its tier-3 use in `objective.py` (`:58`, `:62` today)
- [ ] Type and lint gates pass: `cd services/solver && uv run mypy && uv run ruff check`
- [ ] Shell/check task passes: `mise run solver:check`
- [ ] Contract gate on the TS side still green: `pnpm test bench/contract-parity.test.ts`

#### Manual Verification:

- [ ] Watch item: `uv run pytest tests/test_stage_stop.py -k seed` run 5× locally. Every run well inside its 25 s ceiling, with timings noted in `change.md`, and CI confirms.
- [ ] A CLI run on the seed dump (`services/solver/README.md` recipe) completes and its result has no `lowerBound` keys.

**Implementation Note**: After the automated checks pass, pause for the human to confirm the timing watch item before Phase 3.

---

## Phase 3: Re-anchor `bench/`

### Overview

Remove every `bench/` dependency on greedy so Phase 4 is a pure deletion. The exporter becomes hint-free; the greedy measurement loop and its script go.

### Changes Required:

#### 1. Hint-free exporter

**File**: `bench/export-snapshot.experiment.ts`

**Intent**: Stop running greedy. The exported dump then matches what production sends (no hint), and a CLI run on it matches production (no hint, no cut).

**Contract**:

- Check the pins with `verifyGeneration(snapshot, [])` instead of `runVerifiedGeneration(generatePlanGreedy, …)`, and keep the "pinned board already violates the oracle" refusal.
- Emit `greedy: { placements: [], diagnostics: {} }` and `objective = scoreCandidate(snapshot, [], remaining).objective`, which keeps `parity()` meaningful on any new dump.
  - Build `remaining` from `deriveGenerationDeficits(pins, courses, parkedCourseIds)` (`deficits.ts:15`, barrel-exported), called per cohort over `COHORT_VALUES`.
  - Fold the resulting `{ courseId, missing }` entries into a `Map<courseId, missing>`, the shape `scoreCandidate` reads tier 1 from. `bench/campaign-preflight.ts:74-76` is the precedent for walking the cohorts.
  - Delete `remainingOf` (`:146`): it reads the greedy `GenerationResult` this rewrite removes.
- Drop the "greedy board FAILED verification" branch, the greedy summary log, `BUDGET_MS` and the greedy wording in the header (`:33-42`, `:62`, `:112`, `:128`, `:135`).
- The `ExportDump` shape is unchanged, because `load_dump` still requires the keys.

#### 2. Delete the greedy measurement loop

**File**: `bench/generation.experiment.ts` (delete), `package.json:21`

**Intent**: The file is greedy's own benchmark, with its own private harness copies. Delete it, and delete the `experiment:generation` script, which has no file filter and would otherwise silently become "run every experiment". Each remaining experiment keeps its own script (`experiment:export`, `experiment:import`, `experiment:goldens`).

**Contract**:

- The `package.json` `scripts` lose one entry.
- After §3's comment edits, grep confirms `experiment:generation` is referenced nowhere else (README, docs, configs, `bench/`).

#### 3. Config and harness docblocks

**File**: `vitest.experiment.config.ts:4-12`, `vitest.analyze.config.ts:9-11`, `bench/experiment-harness.ts:9-14`, `bench/generate-contract-goldens.experiment.ts:24-27,37-38,46`, `bench/plan-report.ts:13`, `bench/plan-quality.analyze.ts:12`

**Intent**: Remove the descriptions of a greedy loop and of `experiment:generation`.

- `plan-report.ts:13` says the renderer is "shared by `pnpm analyze:plans` and `pnpm experiment:generation`". It now serves `analyze:plans` only.
- `plan-quality.analyze.ts:12` names the script too.

- In `generate-contract-goldens`, note that the recorded result golden's `lowerBound` values come from the greedy era and that no engine emits the key now.
- Fix its stale `.gitignore:84-94` citation; the services/solver block is now at `:90-100`.

**Contract**: Comment-only.

#### 4. Solver README recipe and dump docstring

**File**: `services/solver/README.md:148-216`, `services/solver/src/cpsat_engine/schema.py:1-9`

**Intent**: The export recipe still promises a "greedy baseline + per-cohort lowerBound", and Mode B's prose speaks of "the greedy unplaced courses". Describe the hint-free dump: an empty warm start, the pins-only objective, and the frozen `seed-plan-a.json` as a recorded greedy-era artifact.

**Contract**: Prose only. The `schema.py` docstring keeps naming `export-snapshot` as the producer, which stays true.

### Success Criteria:

#### Automated Verification:

- [ ] Type gate passes (covers `bench/`): `pnpm check`
- [ ] Lint passes: `pnpm lint`
- [ ] Unit suite passes: `pnpm test`
- [ ] No bench file imports greedy: `grep -rn "generatePlanGreedy\|createGreedyEngine" bench/` is empty
- [ ] `pnpm experiment:goldens` with no `RESULT` prints its usage line and exits green
- [ ] Python gates unaffected: `cd services/solver && uv run pytest tests/test_schema.py tests/test_cli.py`

#### Manual Verification:

- [ ] Against the local stack: `SOURCE_PLAN_ID=<seed plan> OUT=<scratch>/dump.json pnpm experiment:export` writes a dump with an empty `greedy` block; the CLI solves it to a complete board; `pnpm experiment:import` verifies and persists it into the clone. Then delete the clone.

**Implementation Note**: After the automated checks pass, pause for the human to confirm the export → CLI → import loop before Phase 4.

---

## Phase 4: Delete the greedy engine (one revertable commit)

### Overview

The one-way step, alone in its commit: the package, its satellites and the dead code it leaves behind.

### Changes Required:

#### 1. The package and its satellites

**File**: `src/entities/timetable/model/generation/engines/greedy/**`, `engine-fuzz.test.ts`, `generation-smoke.test.ts`, `quality-bar.test.ts`, `__fixtures__/descent-catalog.ts`, `__fixtures__/synthetic-catalog.ts`, `rng.ts` (all under `src/entities/timetable/model/generation/`)

**Intent**: `git rm` them all. The descent case now lives in `test_baseline.py` (Phase 1). The `engines/` folder disappears; steiger has no rule about it.

**Contract**: The barrel `src/entities/timetable/index.ts:38-40` loses its greedy export line and comment.

#### 2. Type and runner residue

**File**: `types.ts`, `run.ts`, `run.test.ts` (under `model/generation/`)

**Intent**: Remove the vocabulary only greedy produced or consumed.

**Contract**:

- Remove `"stagnation"` from `stopReason` (`types.ts:104`), and delete `GenerationProgress` and `GenerationHooks` (`:114-125`).
- `GeneratePlan` becomes `(snapshot, config) => Promise<GenerationResult>`.
- `runVerifiedGeneration` loses its `hooks` parameter, and `run.test.ts:70` asserts `(snapshot, CONFIG)`.
- Rewrite the greedy doc comments at `types.ts:15-19`, `:82-85`, `:89-91` and `:96-103`. In particular, the `lowerBound` doc becomes "optional on the wire; no engine currently emits it".
- `engine: string`, `provenOptimal`, `GeneratePlan` and `budgetMs` stay. `generation-delivery.ts:319` compiles unchanged.

#### 3. Objective residue

**File**: `objective.ts`, `objective.test.ts`

**Intent**: Remove the LNS search-prefix machinery.

**Contract**:

- Delete `SEARCH_TIERS` (`objective.ts:55-69`).
- Remove `scoreCandidate`'s `tiers` parameter and polish gate (`:105-108`, `:128-132`, `:148`), so shape tiers are always computed.
- Rewrite the greedy/LNS comments at `:11-14`, `:40-46`, `:65` and `:92-96`, plus the `deriveGoldenSets` mention at `:319`.
- `compareObjectives`, including its `tiers` parameter, stays. The `SEARCH_TIERS` cases in `objective.test.ts:100-108` are rewritten with a literal prefix length or dropped, and `objective.test.ts:330`'s comment is updated.
- `campaign-ledger.ts:196` and the Phase 3 exporter compile unchanged, because both already used the default.

#### 4. `deriveGoldenSets`

**File**: `golden-sets.ts`, `golden-sets.test.ts`

**Intent**: Its only caller was `problem.ts`. This reverses July's never-delete listing for this function only, and the decision is recorded in `change.md`.

**Contract**:

- Delete `deriveGoldenSets` and its private helpers (`growFrom`, `canShareCell`, `dedupe`, and their types), plus the `describe("deriveGoldenSets")` block (`golden-sets.test.ts:23-104`).
- The deletion orphans the test file's `course` helper, the `NONE` constant, the `GroupingCourse` type import and the `GOLDEN_COVERAGE` import (used only at `:64`, inside the deleted block). Remove all four, or `no-unused-vars` turns `pnpm lint` red.
- `GOLDEN_BAND`, `GOLDEN_MISS_SHARE` and `GOLDEN_COVERAGE` stay. `GOLDEN_BAND`'s test stays. `GOLDEN_COVERAGE` loses its only test use with the block, so add a one-line pin test for it, in the shape of `GOLDEN_BAND`'s.
- The header (`:7-13`, `:36`) is reworded to describe the constants only.

#### 5. Stray comments

**File**: `wire.ts:35`, `auto-park.ts:20`

**Intent**: Remove "still consumed by the greedy engine until S-309" and "greedy and CP-SAT alike".

**Contract**: Comment-only. The page-slice epitaphs (`use-generation-job.ts:9,90`, `use-cohort-board-state.ts:121`, `PlannerBoard.tsx:320`) stay as written, because they remain accurate history.

### Success Criteria:

#### Automated Verification:

- [ ] Type gate passes: `pnpm check`
- [ ] Lint passes: `pnpm lint`
- [ ] FSD structure passes: `pnpm steiger`
- [ ] Unit suite passes: `pnpm test`
- [ ] Production build passes: `pnpm build`
- [ ] No code reference remains: `grep -rni "greedy" src/ bench/ --include='*.ts' --include='*.tsx'` lists only this allowlist:
  - the four page-slice epitaph comments (`use-generation-job.ts:9,90`, `use-cohort-board-state.ts:121`, `PlannerBoard.tsx:320`);
  - the exporter's `greedy` dump key and its `ExportDump` field (`bench/export-snapshot.experiment.ts`), kept because `load_dump` requires it;
  - the greedy-era `lowerBound` note in `bench/generate-contract-goldens.experiment.ts` (Phase 3 §3).
- [ ] No `stagnation`, `SEARCH_TIERS`, `GenerationHooks` or `deriveGoldenSets` outside negative-test fixtures: `grep -rn "SEARCH_TIERS\|GenerationHooks\|GenerationProgress\|deriveGoldenSets" src bench` is empty
- [ ] The full local CI gate is green: `/verify`
- [ ] CI `integration` and `e2e` lanes green on the PR (Generate → verified board unaffected)

#### Manual Verification:

- [ ] `pnpm build && pnpm preview` with the native solver: Generate on a local plan delivers a verified proposal, and drag-drop validation and board views behave as before.
- [ ] The deletion is a single commit, so `git revert <sha>` would restore it cleanly; check with `git show --stat`.

**Implementation Note**: After the automated checks pass, pause for the human's manual check before Phase 5.

---

## Phase 5: Truth-up — docs, trackers, memory

### Overview

Every artifact that describes greedy as live, or cites a mechanism S-309 removed, is brought up to date. This is part of the definition of done, per the lesson "A convention that cites a code mechanism is coupled to it".

### Changes Required:

#### 1. Author runbook

**File**: `docs/runbooks/plan-generation.md:55-98`

**Intent**: Rewrite the Generate section for CP-SAT. It currently describes greedy without ever naming it ("20 s budget", "5–8 h residue", "~3× the expert's gaps", the LNS "search operator"). The new text covers the background job, 240 s stages with an "up to about 38 minutes" ceiling, a complete board, the proposal plan, and Stop & keep. The weaknesses section uses S-308's measured shape. Tier-generic passages (soft hits, golden band) stay.

**Contract**: Prose only. The numbers come from S-308's archived record and `src/solver-container-env.ts`; none are invented.

#### 2. Contract prose

**File**: `contracts/README.md:55-56,64-67,70`, `contracts/generation-wire.schema.json` (description strings at `:143-147`, `:151`, `:159`, `:164`)

**Intent**: Greedy is gone, so stop calling it "slated for removal (S-309)". The `lowerBound` description says it is optional and that no engine currently emits it.

**Contract**:

- Description strings only. The schema is parsed, never hashed, so no golden bytes change and `formatVersion` stays `1`.
- This changes the solver image (`Dockerfile:33`).

#### 3. PRD

**File**: `context/foundation/prd.md`

**Intent**: Record FR-314 as met.

- The clique precondition is restated as resolved. The gist (exact wording drafted at implementation time, as `change.md` decides): _"the clique-bound cut was found inactive on the production path since F-302, so no production dependency on greedy remained; S-309 retired it on both sides, and reviving it is a separate CP-SAT change gated by a parked-safe bound and a production comparison."_
- The baseline precondition is met by `services/solver/tests/test_baseline.py`, described plainly as a regression tripwire on a committed instance, not a reproduction of S-308's production numbers.
- Update success criterion 6 (`:180-184`) and the engine-transition paragraph (`:675-681`) to say the engine is deleted. Leave the dated baseline sections alone.

**Contract**: Dated amendment notes in the PRD's existing `> YYYY-MM-DD (S-309):` style.

#### 4. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**:

- Update the S-309 body (`:259`, the preconditions) and the backlog row title (`:299`, still "CP-SAT default Generate, delete Web Worker path").
- Fix the stale `types.ts:104` / `run.ts:16` citations at `:71`.
- The status itself is advanced by `/10x-implement` and `/10x-archive`.

**Contract**: Edit in place, with dated notes where the roadmap already uses them.

#### 5. Repo rules and CI claims

**File**: `CLAUDE.md` (Solver package section), `README.md:383`, `.github/workflows/ci.yml:265-267,360`

**Intent**:

- CLAUDE.md's "CP-SAT changes are gated by tests" rule gains the baseline: `tests/test_baseline.py` stays green, and its bounds are re-calibrated only on the GitHub runner, never on M-series.
- Replace the "44 s" solver-job figure in the README and the `ci.yml` comment with the measured post-S-309 figure, and confirm the claim they support: the solver lane is still off the critical path, so path filters still save zero wall clock.
- The claim is a comparison, so update its other side as well. The `e2e` critical-path figure is stale and disagrees across files: `ci.yml:265` and `:360` say 426 s, `README.md:383` says ~444 s, and research measured 7m58s. Take both figures from the same PR CI run.

**Contract**: Prose and comments only. The figures are measured from this PR's CI run.

#### 6. GitHub trackers (outward-facing: confirm with the author before posting)

**File**: GitHub #106, #108

**Intent**:

- Retitle #106 as "Retire the greedy engine; pin the CP-SAT regression baseline". Rewrite its body (it still says "greedy remains the working Generate affordance") and close it with the PR.
- Correct #108's open question 2: it was deferred, not "resolved by #105".

**Contract**: Use `GH_TOKEN=$(gh auth token --user dobrek) gh issue edit …`.

#### 7. Memory note

**File**: `~/.claude/projects/-Users-dobrek-Projects-10xdev3/memory/greedy-engine-slated-for-removal.md`, `MEMORY.md`

**Intent**: The note's premise is now history. Replace it with a short "greedy removed in S-309; `greedy_*` Python names and the frozen seed fixture are recorded greedy-era artifacts" note, or delete it, and keep the index line in sync.

**Contract**: One memory file, one index line.

### Success Criteria:

#### Automated Verification:

- [ ] Contract gates green on both sides: `pnpm test bench/contract-parity.test.ts` and `cd services/solver && uv run pytest tests/test_contract.py`
- [ ] Prettier and lint clean: `pnpm lint`
- [ ] No doc still calls greedy live: `grep -rni "greedy" docs/ contracts/README.md services/solver/README.md CLAUDE.md README.md` shows only past-tense or artifact mentions
- [ ] The full local CI gate is green: `/verify`

#### Manual Verification:

- [ ] Author signs off on the FR-314 wording in the PRD.
- [ ] The runbook reads correctly to an author who has never seen greedy.
- [ ] #106 and #108 updated after the author confirms the text.
- [ ] Merge only when no production solve is running (README rule).

---

## Testing Strategy

### Unit Tests:

- **Python, new:** `test_baseline.py`.
  - C is a deterministic proof: tier 3 OPTIMAL = 14.
  - A is a bounded production-path tripwire.
- **Python, existing:** parity (10/10), oracle-equivalent hard rules (`test_model.py`), stage-stop (watch item), contract (lowerBound-absent cases stay green).
- **TS:** `run.test.ts` (new signature), `objective.test.ts` (no `SEARCH_TIERS`), `golden-sets.test.ts` (constants only), `contract-parity.test.ts` (unchanged goldens), `campaign-ledger.test.ts` (`scoreCandidate` without `tiers`).

### Integration Tests:

- CI's `integration` lane: the S-301 Generate → solve → server-side oracle → proposal chain on real CP-SAT boards. Accepted as the replacement for `engine-fuzz`'s "no false rejection" coverage.
- CI's `e2e` lane: `generation.spec.ts` drives Generate to a delivered board.

### Manual Testing Steps:

1. Calibrate A from ten runs on the GitHub runner. Set the bounds, then break each test once on purpose and confirm it goes red.
2. After Phase 2, run the live `test_stage_stop` seed tests 5× and note their timings.
3. After Phase 3, do one export → CLI → import loop against the local stack.
4. After Phase 4, run Generate on a local plan through `pnpm build && pnpm preview` with the native solver.

## Performance Considerations

- The solver lane grows by roughly A's runtime (target ≤ ~90 s) plus ~1 s for C. Measured today, the lane is 2m01s against e2e's ~8 min, so CI wall clock does not change.
- Local `uv run pytest` grows by the same amount. `-m "not baseline"` is the opt-out.
- No production runtime change: the cut never fired on the HTTP path.

## Migration Notes

- No database migration, and no contract or `formatVersion` change.
- The merge rolls the solver container. Do not merge mid-solve.
- Rollback:
  - Phase 4 is a single revertable commit.
  - Phase 2 is revertable on its own; the cut was fixture-only.
  - Restoring greedy later means reverting both, an accepted cost (`post-poc …/research.md:385`).

## References

- Research: `context/changes/greedy-retirement/research.md`
- Clique decision (R1b): `context/changes/greedy-retirement/change.md`
- S-308 pinned production reference: `context/archive/2026-09-03-production-calibration-campaign/change.md:217-242`
- Wrapper-level test pattern: `services/solver/tests/test_service.py:259-275`, `:766-788`
- Precedent for a recorded artifact: `bench/generate-contract-goldens.experiment.ts:22-35`
- D1/D4/D6 precedents: `context/archive/2026-08-14-clean-up-bench-generation/change.md:37-104`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Executable baseline (Python, `solver` lane)

#### Automated

- [x] 1.1 Baseline tests pass: `uv run pytest -m baseline` — 0b4a5a2
- [x] 1.2 Full Python suite passes, `test_service.py` unchanged in count — 0b4a5a2
- [x] 1.3 Type gate passes over src + tests: `uv run mypy` — 0b4a5a2
- [x] 1.4 Lint passes: `uv run ruff check` — 0b4a5a2
- [x] 1.5 Bench unit tests pass: `pnpm test bench/campaign-baseline.test.ts` — 0b4a5a2
- [x] 1.6 CI `solver` job green on the PR branch after the calibration commit is reverted — 0b4a5a2

#### Manual

- [x] 1.7 Ten calibration samples from the GitHub runner matrix; exact asserts hold in all; bounds set per formula; evidence recorded in the test and `change.md` — 0b4a5a2
- [x] 1.8 Baseline A wall clock on the runner ≤ ~90 s, C's recorded beside it; solver job still under the e2e critical path — 0b4a5a2
- [x] 1.9 Mutation check: lowered bound fails A, expectation 13 fails C; both reverted — 0b4a5a2

### Phase 2: Retire the dormant clique cut (R1b + orphans)

#### Automated

- [x] 2.1 Objective parity stays exact 10/10 — f0aa806
- [x] 2.2 Baseline unchanged and green — f0aa806
- [x] 2.3 Full Python suite passes — f0aa806
- [x] 2.4 No reference to the removed symbols remains beyond `objective.py`'s local `cohort_slots` (grep) — f0aa806
- [x] 2.5 Type and lint gates pass — f0aa806
- [x] 2.6 Shell/check task passes: `mise run solver:check` — f0aa806
- [x] 2.7 Contract gate on the TS side still green — f0aa806

#### Manual

- [x] 2.8 Watch item: live `test_stage_stop` seed tests 5× locally within ceiling; timings in `change.md`; CI confirms — f0aa806
- [x] 2.9 CLI run on the seed dump completes with no `lowerBound` keys — f0aa806

### Phase 3: Re-anchor `bench/`

#### Automated

- [x] 3.1 Type gate passes (covers `bench/`): `pnpm check` — 80eb45c
- [x] 3.2 Lint passes: `pnpm lint` — 80eb45c
- [x] 3.3 Unit suite passes: `pnpm test` — 80eb45c
- [x] 3.4 No bench file imports greedy (grep) — 80eb45c
- [x] 3.5 `pnpm experiment:goldens` without `RESULT` prints usage and exits green — 80eb45c
- [x] 3.6 Python schema/CLI tests unaffected — 80eb45c

#### Manual

- [x] 3.7 Export → CLI → import loop works against the local stack with a hint-free dump — 80eb45c

### Phase 4: Delete the greedy engine (one revertable commit)

#### Automated

- [x] 4.1 Type gate passes: `pnpm check` — f10bf39
- [x] 4.2 Lint passes: `pnpm lint` — f10bf39
- [x] 4.3 FSD structure passes: `pnpm steiger` — f10bf39
- [x] 4.4 Unit suite passes: `pnpm test` — f10bf39
- [x] 4.5 Production build passes: `pnpm build` — f10bf39
- [x] 4.6 No code reference remains beyond the allowlist: four epitaphs, the exporter's `greedy` dump key, the goldens note (grep) — f10bf39
- [x] 4.7 No `SEARCH_TIERS` / hooks / `deriveGoldenSets` remain (grep) — f10bf39
- [x] 4.8 Full local CI gate green: `/verify` — f10bf39
- [x] 4.9 CI `integration` and `e2e` lanes green on the PR — f10bf39

#### Manual

- [x] 4.10 Generate on a local plan via build + preview delivers a verified proposal; editing unchanged — f10bf39
- [x] 4.11 Deletion is a single revertable commit — f10bf39

### Phase 5: Truth-up — docs, trackers, memory

#### Automated

- [x] 5.1 Contract gates green on both sides
- [x] 5.2 Prettier and lint clean
- [x] 5.3 No doc still calls greedy live (grep)
- [x] 5.4 Full local CI gate green: `/verify`

#### Manual

- [x] 5.5 Author signs off on the FR-314 wording
- [x] 5.6 Runbook reads correctly to an author who has never seen greedy
- [x] 5.7 #106 and #108 updated after author confirms the text
- [ ] 5.8 Merge only when no production solve is running
