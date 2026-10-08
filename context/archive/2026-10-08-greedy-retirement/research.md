---
date: 2026-10-08T08:21:31+02:00
researcher: Claude (Opus 5.5)
git_commit: b9d70b1d34b90fbc183705bc4d33ccd5c91b2506
branch: main
repository: ib-timetable-planner
topic: "S-309 greedy-retirement — feasibility, challenges and potential solutions"
tags: [research, codebase, greedy-retirement, generation, cp-sat, clique-bound, regression-baseline, bench, contracts, S-309]
status: complete
last_updated: 2026-10-08
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Added follow-up research on the clique bound (mechanism, production status, soundness gap, value, options); R1b recorded as the decision"
---

# Research: S-309 greedy-retirement — feasibility, challenges and potential solutions

**Date**: 2026-10-08T08:21:31+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: [`b9d70b1`](https://github.com/dobrek/ib-timetable-planner/commit/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506)
**Branch**: main
**Repository**: ib-timetable-planner

> Permalinks below are pinned to `b9d70b1`. Bare `path:line` references point at the same commit.

## Research Question

Is it feasible to implement the greedy-engine retirement as S-309 from the roadmap (`context/foundation/roadmap.md:257-267`)? Name the challenges and the potential solutions.

## Summary

**Feasible now, and low-risk for production.** No production code path reaches greedy:

- Generate has run CP-SAT since S-301.
- The Web Worker path is already deleted.
- The four page-slice mentions of greedy are comments only.
- All four prerequisite slices (S-305 to S-308) are `done` and archived.

The deletion itself is mechanical, about **2,600–2,770 lines** removed. It sits entirely in the entity layer plus `bench/`.

**The real work is in the preconditions, not the deletion.** FR-314 names three preconditions; only one is met:

| FR-314 precondition | State | What S-309 actually faces |
| --- | --- | --- |
| Hint-free Mode A measured | **Done** (S-308: 3.18–6.16 s over 14 production runs) | Nothing. |
| Clique-bound derivation extracted from `engines/greedy/` | **Not done** | **The premise is stale.** The clique cut has *never run on a production solve*. It is a decision about the cut's future, not a code move. |
| CP-SAT regression baseline pinned and executable | **Pinned, not executable** | **S-308's numbers cannot be executed** as they stand. The campaign plan is deleted, production data cannot be committed, each run takes ~28 min, and CP-SAT is nondeterministic. A different executable form is needed. |

**The roadmap undercounts the blast radius in three places:**

1. Three entity tests, two fixtures and `rng.ts` outside the package depend on greedy.
2. `bench/export-snapshot.experiment.ts` uses greedy to produce the Python solver's dump fixture and the 10/10 parity target. Deleting greedy removes the only way to regenerate them.
3. `lowerBound` is a frozen wire field, so it is not removable residue.

None of this blocks the slice. Each item has a cheap, contained solution (see [Challenges and potential solutions](#challenges-and-potential-solutions)).

**The recommended shape keeps S-309 a TS/bench deletion plus one new Python test file.** It leaves the CP-SAT model, the wire contract, the goldens and `formatVersion` untouched.

## Detailed Findings

### 1. The greedy package and its consumers

**The package** is `src/entities/timetable/model/generation/engines/greedy/`, 10 files and 2,015 lines (1,254 implementation, 761 tests):

| File | LOC | Role |
| --- | --- | --- |
| `search.ts` | 445 | GRASP/LNS driver; `toResult` sets `engine: "greedy"`, `lowerBound`, `stopReason` (`search.ts:320-346`) |
| `stages.ts` | 386 | Construction/repair operators |
| `board.ts` | 242 | Mutable board + `fitsAt`, a fast mirror of the hard rules (`board.ts:185`) |
| `problem.ts` | 176 | `buildProblem`, `backboneCliques`, **`maxWeightCliqueWeight`** (the only engine-agnostic algorithm) |
| `index.ts` | 5 | Barrel |
| tests (5 files) | 761 | Package-internal |

**Importers outside the package:**

- **Barrel:** [`src/entities/timetable/index.ts:38-40`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/index.ts#L38-L40).
  - Consumed only by `bench/generation.experiment.ts:8,80` and `bench/export-snapshot.experiment.ts:8,104`.
  - `createGreedyEngine` and `GreedyTuning` have no consumer through the barrel.
- **Relative imports from inside the entity:** `engine-fuzz.test.ts:5`, `generation-smoke.test.ts:3`, `quality-bar.test.ts:4`.
- **Nothing found in:** `src/_pages`, `src/widgets`, `src/pages`, `src/actions`, `e2e/`, `scripts/`, `.github/`, `mise.toml`, `lefthook.yml`, or any vitest/tsconfig/eslint config.
- **Page-slice mentions are epitaphs (comments only):**
  - `use-generation-job.ts:9,90`
  - `use-cohort-board-state.ts:121`
  - `PlannerBoard.tsx:320`
  - They stay accurate after the deletion.

**FR-312 is safe.**

- `fitsAt` is a greedy-only mirror. The hard-rule helpers it imports (`hasDaySplit`, `exceedsTeacherDayShape`) stay live in `verify.ts:10-11,164,224`, with their own tests.
- Drag-drop validation lives in `collision/` and does not touch generation.

**Files orphaned by the deletion:**

- `rng.ts` (29 lines): used only by greedy and `engine-fuzz.test.ts`.
- `__fixtures__/descent-catalog.ts` (67) and `__fixtures__/synthetic-catalog.ts` (50): used only by greedy tests and the three outside tests.
- `deriveGoldenSets` (`golden-sets.ts:47`): its only caller is `problem.ts:74-75`. It stays exported through the barrel.

**Not orphaned:** `occupied-slots.ts`, `deficits.ts`, `auto-park.ts`, `golden-sets.ts`'s `GOLDEN_*` constants.

**`objective.ts` has live consumers after greedy:**

- **`scoreCandidate` stays.** It computes S-308's delivered tuples in [`bench/campaign-ledger.ts:194-197`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/bench/campaign-ledger.ts#L194-L197). This overrides S-307's research note (`context/archive/2026-09-02-solve-policy-choice/research.md:463-467`) that S-309 could delete it.
- **Greedy-LNS-only residue** (optional removal): `SEARCH_TIERS` (`objective.ts:69`) and the `tiers`/polish gate.
- **`compareObjectives`** (`objective.ts:81`) becomes test-only. It has a *named future consumer*: S-307's "true objective tuple on the wire" dominance follow-up (`roadmap.md:233`).

### 2. The clique bound — the cut has never run in production

**Where it is computed:** only in TS, by `maxWeightCliqueWeight`.

- Defined at [`problem.ts:136-156`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/model/generation/engines/greedy/problem.ts#L136-L156), over `conflictGraph` (`:165-176`).
- Emitted as greedy's `diagnostics.cohorts[c].lowerBound` (`search.ts:336,342`).

**How it reaches Python:** only through the bench dump.

- `export-snapshot.experiment.ts:128` writes `greedy: { placements, diagnostics }`.
- Python looks it up with `Dump.lower_bound()` ([`schema.py:111-114`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/services/solver/src/cpsat_engine/schema.py#L111-L114)).
- `_add_clique_cuts` adds `cohort_slots[c] >= bound` before tier 3, for completed cohorts only ([`solve.py:610-611`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/services/solver/src/cpsat_engine/solve.py#L610-L611), [`:690-699`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/services/solver/src/cpsat_engine/solve.py#L690-L699)).

**The production path supplies no bound.** The app dispatches `{ formatVersion, snapshot, policy }` with no `warmStart`. `build_dump` then sets `greedy_diagnostics={}` ([`runner.py:204-223`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/services/solver/src/cpsat_service/runner.py#L204-L223)). So `lower_bound()` returns `None` and the cut is skipped. The runner's own docstring says a wrapper-driven solve "runs hint-free and without the clique cut" (`runner.py:208-211`).

**Consequences:**

- **S-308 calibrated without the cut.** Production's proven tier-3 bound was 21–49 against delivered 92–96 (`context/archive/2026-09-03-production-calibration-campaign/change.md:199-200`).
  - The POC's seed run *with* the cut proved 87 = 46 + 41 (`context/archive/2026-07-15-poc-cp-sat-backend-service/results.md:81-94`).
  - The cut's effect on delivered quality or time-to-stop in production is **unmeasured**.
- **No TS consumer reads `lowerBound` outside greedy.** The only touches are `types.ts:73-78` (type) and `wire.ts:192-204` (pass-through).
  - July's claim that the bound feeds "diagnostics/analyzer context" (`context/changes/post-poc-cp-sat-refactoring-plan/research.md:347`) is false today.
- **`lowerBound` is still a wire field.** It is optional in the schema ([`generation-wire.schema.json:143-147`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/contracts/generation-wire.schema.json#L143-L147)).
  - The result golden carries greedy-derived values (48/45), byte-checked at [`contract-parity.test.ts:89-90`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/bench/contract-parity.test.ts#L89-L90).
  - Removing it from the schema is a "removed property", which forces a `formatVersion` bump (`contracts/README.md:142-149`). Keeping it optional costs nothing.
- **Soundness gap if the cut is ever revived as-is.** `conflictGraph` drops flagged, biweekly and zero-hour courses but **not parked ones** ([`problem.ts:165-176`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/model/generation/engines/greedy/problem.ts#L165-L176)).
  - Meanwhile the cut's "completed cohort" guard uses deficits net of parked hours (`solve.py:775-781`).
  - Production snapshots carry auto-parked and user-parked courses (`plan-snapshot.ts:40-41`).
  - So a parked course inside the maximum clique overstates the bound. The cut then stops being redundant and either forces a worse tier 3 or makes the stage infeasible. Neither fixture has parked entries, so this has never run.
- **Python port cost is tiny.** One agent's scratchpad port reproduced 48/45 (seed) and 46/41 (golden) in ~1–3 ms per cohort, with 277–415 node expansions. Python already has the edge test `_conflicts` (`solve.py:749-751`).

### 3. The regression baseline — pinned, but not executable as written

**What S-308 pinned:** per-tier min/median/max and four delivered tuples from the shipped cell `w4-s240-a300` ([`change.md:217-242`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/context/archive/2026-09-03-production-calibration-campaign/change.md#L217-L242)). `bench/campaign-baseline.ts:5-6` calls these "the numbers S-309's executable test will assert against". S-308 deferred the test itself: "executable test lands in S-309, where the fixture pipeline is decided" (`plan.md:45`).

**Why those numbers cannot be asserted as they stand:**

- **The instance is gone.** The campaign plan `cdde43fa…` was deleted, which cascaded all 14 `generation_jobs` rows. `ledger.json` (ids and numbers only, no PII) is the only record, and it has no snapshot.
- **The data cannot be committed.** It was real production data (`.gitignore:79-95`; the no-prod-data rule).
- **It is slow and nondeterministic.** Each run takes ~28 min. Within the shipped cell, teacher holes ranged 73–102 and student holes 667–842. An exact tuple at production budgets is impossible.

**What exists today is not a quality baseline either:**

- The **10/10 objective-parity gate** ([`test_objective.py:23-24,44-47`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/services/solver/tests/test_objective.py#L23-L47)) replays a *fixed greedy board* from `seed-plan-a.json` and compares the CP-SAT encoding against the TS tuple. It checks encoding parity and never searches.
- `test_solve.py:149-153` checks only completeness on the seed.
- The `bench/` campaign tools "report, never judge" by design.

**Committed, PII-free fixtures at production scale exist:**

- `services/solver/tests/fixtures/seed-plan-a.json`: 81 courses, 238 h to place, 61 students, 18 teachers.
- `contracts/fixtures/solve-request.json`: same catalog.
- The campaign placed 246 h, so these are close in scale, but they are a different instance. Production tuples won't reproduce on them: hint-free CP-SAT reached 99–100 slots at 10 s stages in a probe.

**A determinism probe** (scratchpad only, M-series, evidence not pins):

- Free-running at 4 workers, the seed gives different tuples run to run.
- `interleave_search=True` plus `max_deterministic_time` gave an identical tuple across 5 runs, at 2 and 4 workers. But:
  - that mode is marked *experimental* in `sat_parameters.proto`;
  - production doesn't use it;
  - quality is worse;
  - the result plateaus, so budget changes go unnoticed;
  - arm64 vs x86_64 equality is unverified.

**CI capacity** (measured on `main` run 37631767649, 2026-10-07; README figures are stale):

| Lane | Measured | README says |
| --- | --- | --- |
| `solver` | 2m01s (pytest 98 s) | 44 s |
| `e2e` (critical path) | 7m58s | ~444 s |

So the solver lane can absorb ~1–2 min of baseline test at zero wall-clock cost.

### 4. The bench exporter is the producer of Python's input fixtures

[`bench/export-snapshot.experiment.ts:104`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/bench/export-snapshot.experiment.ts#L104) runs `generatePlanGreedy` to fill the dump's `greedy` block and `objective`. It is the **only producer** of `seed-plan-a.json`, and that fixture carries:

- the parity gate's board and `SEED_OBJECTIVE = (0,0,97,223,0,1048,316,4,38,14)`;
- the `lowerBound` 48/45 that feeds the cut in `test_solve.py:150` and the live `test_stage_stop.py` tests.

**After the deletion nothing turns red.** The fixture is committed, and Python reads it as data. What is lost is the ability to *regenerate* it.

**The dump format requires a `greedy` key.** `load_dump` reads `raw["greedy"]["placements"]` and `["diagnostics"]` ([`schema.py:126-130`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/services/solver/src/cpsat_engine/schema.py#L126-L130)). So any rewritten exporter must still emit one, even if empty, unless the Python schema changes too. The dump is bench transport, explicitly out of contract (`contracts/README.md:55,64-73`).

**Other bench files:**

- **Unaffected:** `generate-contract-goldens.experiment.ts` reads only the dump's `snapshot`, so `pnpm experiment:goldens` keeps reproducing byte-identical goldens from the committed fixture.
- **Loses its input if the exporter is deleted:** `import-generated.experiment.ts` (`experiment:import`). Its dump must reference a clone the exporter created (`:27,34-37`).
- **Misleadingly named:** `package.json:21` `experiment:generation` has no file filter and runs *every* `bench/**/*.experiment.ts`.

### 5. Type residue and the `GeneratePlan` port

| Item | Recommendation | Why |
| --- | --- | --- |
| `stopReason` member `"stagnation"` (`types.ts:104`) | Remove | Greedy is its only producer; the schema enum already excludes it |
| `GenerationHooks` / `GenerationProgress` (`types.ts:114-125`) | Remove (edits `run.ts`) | Only greedy consumes them; delivery passes no hooks |
| `partial`'s `signal.aborted` meaning (`types.ts:88-92`) | Comment-only fix | — |
| `engine: string`, `provenOptimal?` | Optional narrowing | Breaks the `"fake"` engine in `run.test.ts:40` and fixtures in `campaign-ledger.test.ts` |
| `lowerBound?` | **Keep** | Frozen wire field + byte-gated golden |
| `GeneratorConfig.budgetMs`, the `GeneratePlan` port | **Keep as-is in S-309** | Production calls `runVerifiedGeneration(() => Promise.resolve(result), snapshot, { budgetMs: 0 })` at [`generation-delivery.ts:319`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/_pages/plan-detail/api/generation-delivery.ts#L319). Narrowing either one makes S-309 touch a page slice. |

There is no CP-SAT `GeneratePlan`: `solver-transport.ts:18-22` is "Deliberately NOT a `GeneratePlan`". So the port survives only as that one-line wrapper.

**FSD / steiger:**

- No rule cares about the emptied `engines/` folder; `git rm -r` it.
- There is no unused-export tool (no knip or ts-prune), so orphaned exports won't fail CI.
- `pnpm check` covers `bench/` (`tsconfig.json` includes `**/*`). A leftover bench importer therefore turns CI red, which is a useful tripwire: the bench edits must land with the deletion.

### 6. Docs and trackers coupled to greedy

Per the lesson "A convention that cites a code mechanism is coupled to it", these edits are part of S-309's definition of done.

- **`docs/runbooks/plan-generation.md:57-71,92-95`.** Still describes greedy as the live Generate: "give it its budget (20 s)", "5–8 hours" residue, teacher gaps "~3× the expert's". It has been stale since S-301; S-308 flagged it (`research.md:121`) and it was never fixed. A keyword sweep misses it because it never says "greedy".
- **`contracts/README.md:55-56,64-67,70`** and **`contracts/generation-wire.schema.json:151,159,164`** (description strings only).
  - Byte-safe: the schema file is parsed into validators, never hashed.
  - **But** `services/solver/Dockerfile:33` does `COPY contracts`, so the edit changes the solver image.
- **`services/solver/README.md:151-166,213-216`** (the export recipe) and **`schema.py:7-8`** (the "produced by `export-snapshot`" docstring). The docstring dangles if the exporter is deleted.
- **In-code comments:**
  - `types.ts:82-104`, `wire.ts:35`, `auto-park.ts:20`
  - `bench/experiment-harness.ts:10-14`, `bench/generate-contract-goldens.experiment.ts:38`
  - `vitest.experiment.config.ts:4-8`, `vitest.analyze.config.ts:9-11`
- **PRD:** `prd.md:183-184,204-212,608-618,675-681`. **Roadmap:** `roadmap.md:42,259-267,299`; `:71` cites `types.ts:104` for the port, which is actually `:128`.
- **GitHub:**
  - **#106 is open and stale on four counts:** the title still says "CP-SAT default Generate, delete Web Worker path"; it uses the pre-D4 bench wording; it says "greedy remains the working Generate affordance"; and its status is still "proposed".
  - **#108's** open question 2 still says "resolved by #105", but it was deferred.
- **Leave as-is:** archives, `shape-notes.md`, the post-POC research body, the page-slice epitaphs, and the PRD's dated baseline sections.

## Challenges and potential solutions

### C1 — The clique-bound precondition rests on a stale premise

**Challenge.** FR-314 and the roadmap require "clique-bound derivation extracted out of the greedy package". The precondition was written (`post-poc …/research.md:347,392`) on the belief that the bound is "the one genuine dependency" feeding CP-SAT's tier-3 cut. In fact:

- the cut has never run on a production solve;
- S-308 calibrated without it;
- no TS code outside greedy reads the bound.

A literal TS extraction would create an engine-agnostic module with no production caller.

**Options:**

| Option | What | Cost / risk |
| --- | --- | --- |
| **R1 — Retire the TS derivation; amend the precondition** *(recommended for S-309)* | Delete `maxWeightCliqueWeight`/`backboneCliques` with greedy. Leave Python's `_add_clique_cuts` and `Dump.lower_bound` untouched as bench-only paths fed by the frozen seed fixture. Record in FR-314 that the precondition was resolved by finding the cut is not live in production. | Zero production change; no contract or Python change. Needs the author to sign off on the PRD wording, which per D4 of `clean-up-bench-generation` is the author's call. |
| **R2 — Port the bound to Python and turn the cut on in production** *(recommended as a separate follow-up slice, not inside S-309)* | Compute the bound natively in `cpsat_engine` from the snapshot. **Weight each course by its on-board hours (pins + deficit), not full `hours`**, to close the parked-course gap. | A CP-SAT behaviour change. It moves tier 3, so S-309's baseline has to be re-pinned. Gated by parity, the oracle and a with/without production comparison. Potential upside: a much stronger tier-3 proven bound (≈87 vs 21–49), which could let tier 3 prove OPTIMAL and stop early. That upside is unmeasured. |
| R3 — Literal TS extraction | Move the B&B to `model/generation/clique-bound.ts` | Either dead code, or fed to Python via a new `SolveRequest` field. That field is a client-supplied hard constraint outside the `snapshot_hash` binding; README:26-28 calls the snapshot the solve's complete input. **Not recommended.** |

> **Decided 2026-10-08: R1b**, a stronger R1. A later follow-up found that the Python cut is reachable only from the frozen seed fixture once greedy is gone, so S-309 deletes the dormant Python cut, `Dump.lower_bound` and the `lowerBound` echo as well. `lowerBound` stays optional on the wire, and R2 stays a separate follow-up. See `change.md` and the follow-up sections at the end of this document.

Folding R2 into S-309 would break the "deletion is revertable on its own" property (D1 precedent). It would also mix a quality change into a pure removal.

### C2 — "Pinned and executable" can't mean "assert S-308's production numbers"

**Challenge.** The pinned tuples come from a deleted, uncommittable production instance, through a 28-minute nondeterministic solve.

**Solution (recommended): A + C in the Python `solver` lane, with S-308's ledger kept as the documented production reference.**

- **A — bounds baseline on the production code path** (~60–100 s).
  - Run through the wrapper: `build_dump` and the policy path, per CLAUDE.md's "test at the wrapper level".
  - Input: `contracts/fixtures/solve-request.json` with `warmStart` removed. Clean preset, 4 workers, seed 1, short stages.
  - Assert **exactly:** complete, `clean_fallback` false, tier1 = 0, tier2 = 0, softHits = 0.
  - Assert **loose upper bounds** on totalSlots and teacherHoles.
  - Calibrate the bounds from repeated runs **on the GitHub runner, never on the M-series laptop**.
- **C — port the descent capability guard** (~1 s, deterministic by proof).
  - Today `quality-bar.test.ts:25-36` asserts that greedy reaches the clique-proven optimum of 14 slots.
  - CP-SAT proves tier 3 OPTIMAL = 14 on that instance in 0.3–1.3 s. That is a fact about the instance, so it ports cleanly.
  - **The descent catalog must be converted to a Python fixture before the TS file is deleted.**
- **Pin A before any CP-SAT change**, including R2. A revived cut moves tier 3.
- **Rejected:**
  - **B — exact-tuple golden via `interleave_search`:** experimental mode, not production's search, plateaus, cross-arch unverified.
  - **D — production re-check as a CI test:** expensive and writes production rows. It can be documented as an optional manual `mise run solver:campaign -- run-one` procedure plus a small comparator.

PRD and roadmap wording should say plainly that the executable baseline is a regression tripwire on a committed instance, not a reproduction of the production numbers.

### C3 — Deleting greedy kills the regeneration path for Python's fixture

**Challenge.** `export-snapshot.experiment.ts` is the only producer of `seed-plan-a.json`, which holds the parity board, `SEED_OBJECTIVE` and the clique bounds.

**Options:**

- **Recommended:**
  - **Keep `seed-plan-a.json` frozen** as a recorded artifact. That precedent already exists: the result golden is "a RECORDED artifact, not a reproducible one" (`generate-contract-goldens.experiment.ts:24-27`).
  - **Rewrite the exporter hint-free.** Emit an empty `greedy` block (`placements: []`, `diagnostics: {}`) plus `scoreCandidate`'s tuple of that board. CLI runs then match production (no hint, no cut), and the export → CLI → import loop keeps working.
  - Update `services/solver/README.md`'s recipe and `schema.py:7-8` to say so.
- **Alternative:** delete the exporter, `import-generated.experiment.ts`, the `experiment:export`/`experiment:import` scripts, and the now-orphaned `experiment-harness.ts` helpers (`clonePlanCatalogOnly`, `toSnapshot`, `identitiesOf`). The native-solver dev loop has largely superseded the file-transport loop. This needs the author's confirmation that nobody still uses it.
- **Out of scope:** renaming Python's `greedy_placements`/`greedy_diagnostics` and the dump's `greedy` key to a neutral warm-start name. It is bench transport and touches CP-SAT code gated by tests; record it as a follow-up.

### C4 — Test coverage that leaves with greedy

| Lost test | What it guarded | Solution |
| --- | --- | --- |
| `quality-bar.test.ts` descent case | Tier-3 capability on a clique-proven instance | **Port to pytest** (C2-C) |
| `quality-bar.test.ts` synthetic case (≤ 8 slots) | Greedy's own empirical envelope | Let it go |
| `generation-smoke.test.ts` | Greedy pipeline smoke | Let it go |
| `engine-fuzz.test.ts` | `verify` does not *falsely reject* valid boards on random catalogs (it only ever asserts `ok=true`, [`engine-fuzz.test.ts:22-36`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/model/generation/engine-fuzz.test.ts#L22-L36)) | Accept the loss. The oracle runs on real CP-SAT boards in the integration lane (the S-301 Generate→verified-board chain) and in e2e (`generation.spec.ts`), and `verify.test.ts` covers rejections. A follow-up could add a property test on hand-built valid boards if wanted. |

### C5 — Residue that must *not* be swept up with the engine

- **Keep:**
  - `lowerBound` (wire contract).
  - `scoreCandidate` (`campaign-ledger.ts`).
  - `compareObjectives` (S-307 dominance follow-up).
  - `verify.ts`, `objective.ts`, `assemble-snapshot.ts`, deficits, golden-sets, the analyzer (the standing never-delete list, `post-poc …/research.md:359,390`).
  - The `GeneratePlan` port and `budgetMs`, so S-309 stays out of the page slice.
- **Remove:**
  - `"stagnation"`, `GenerationHooks`/`GenerationProgress`.
  - `rng.ts` and the two orphaned fixtures (after C2-C converts descent).
  - `bench/generation.experiment.ts`.
  - The `experiment:generation` script; rename it, since it currently runs all experiments.
- **Author's call:**
  - `deriveGoldenSets`: dead after deletion, but on the July never-delete list.
  - `SEARCH_TIERS` and the polish gate: greedy-LNS-only.

### C6 — Docs and trackers are part of done, and one is already stale

Apply the doc checklist in §6. The **runbook** is the one most likely to be missed, and it is the one authors actually read. Also:

- update GitHub **#106** (title, body, status) and **#108**;
- delete or update the memory note `greedy-engine-slated-for-removal`.

### C7 — Operational: the merge rolls the solver image

The recommended shape touches `services/solver/tests/`, and possibly `contracts/` descriptions; `services/solver/Dockerfile:33-34` copies both into the image. So the merge changes the image and the container rolls. The README rule applies: **do not merge while a production solve is running**, because the rescue path is still unexercised (S-308 follow-up).

Keeping the contract-description edits in the same commit as the test does not add risk: one roll either way.

### C8 — Sequencing and overlap

- **Archive `automate-production-calibration-campaign` first** (`status: impl_reviewed`, one open follow-up F1).
  - It built `bench/campaign-baseline.ts` and `campaign-ledger.ts`, which S-309 will reference or extend.
  - Adjacent stale paths it owns: `bench/campaign/main.ts:366` and `.gitignore:76` still point at `context/changes/production-calibration-campaign/ledger.json`.
- **Keep the deletion a single, revertable commit**, separate from the baseline, bench rewrite and docs. "Deletion is one-way": a later restore ≈ a rewrite, an accepted cost (`post-poc …/research.md:385`).

### Suggested phasing (for `/10x-plan`)

1. **Baseline first** (Python, `solver` lane):
   - convert the descent catalog to a Python fixture;
   - add the C2-A bounds test and the C2-C capability test;
   - calibrate A's bounds on the CI runner.
2. **Bench re-anchor:**
   - rewrite `export-snapshot` hint-free (or delete the export/import pair);
   - delete `generation.experiment.ts`;
   - fix the `package.json` scripts and the vitest config docblocks.
3. **Deletion** (one commit):
   - `engines/greedy/**`;
   - the three outside tests, the two fixtures and `rng.ts`;
   - the barrel export;
   - the type residue (`stagnation`, hooks) and the `run.ts` signature.
   - Gate: `pnpm check`, `lint`, `steiger`, `test`, `build`.
4. **Truth-up:**
   - the runbook, `contracts/` descriptions, `services/solver/README.md`, `schema.py` docstring;
   - PRD FR-314 / success criterion 6 / guardrail strike note;
   - roadmap S-309;
   - GitHub #106/#108; the memory note.

**Rough size:**

- ~2,600–2,770 lines deleted: 2,015 package + 335 tests/fixtures/rng + 248 (`generation.experiment.ts`), plus 171 more if `export-snapshot` is deleted rather than rewritten.
- ~200–300 lines added: pytest baseline, descent fixture, exporter edit.
- Docs on top.

## Code References

- [`src/entities/timetable/index.ts:38-40`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/index.ts#L38-L40) — the greedy barrel export (the only public surface)
- [`src/entities/timetable/model/generation/engines/greedy/problem.ts:136-176`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/model/generation/engines/greedy/problem.ts#L136-L176) — `maxWeightCliqueWeight` + `conflictGraph` (no parked filter)
- [`src/entities/timetable/model/generation/types.ts:73-125`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/model/generation/types.ts#L73-L125) — `lowerBound`, the wider-than-wire fields, hooks, the port
- [`src/entities/timetable/model/generation/objective.ts:69-98`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/model/generation/objective.ts#L69-L98) — `SEARCH_TIERS`, `compareObjectives`, `scoreCandidate`
- [`src/entities/timetable/model/generation/quality-bar.test.ts:25-50`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/model/generation/quality-bar.test.ts#L25-L50) — descent capability guard (port) and synthetic envelope (drop)
- [`src/entities/timetable/model/generation/engine-fuzz.test.ts:22-36`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/model/generation/engine-fuzz.test.ts#L22-L36) — oracle fuzz over greedy boards
- [`src/entities/timetable/api/solver-transport.ts:18-22`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/entities/timetable/api/solver-transport.ts#L18-L22) — CP-SAT is deliberately not a `GeneratePlan`
- [`src/_pages/plan-detail/api/generation-delivery.ts:319`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/src/_pages/plan-detail/api/generation-delivery.ts#L319) — the port's only production use (trivial wrapper)
- [`bench/export-snapshot.experiment.ts:104-128`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/bench/export-snapshot.experiment.ts#L104-L128) — greedy as the dump producer
- [`bench/campaign-ledger.ts:194-197`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/bench/campaign-ledger.ts#L194-L197) — live `scoreCandidate` consumer
- [`bench/contract-parity.test.ts:89-90`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/bench/contract-parity.test.ts#L89-L90) — result golden byte gate (carries `lowerBound`)
- [`package.json:21-24`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/package.json#L21-L24) — the `experiment:*` scripts
- [`services/solver/src/cpsat_service/runner.py:204-223`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/services/solver/src/cpsat_service/runner.py#L204-L223) — `build_dump`: empty diagnostics, "without the clique cut"
- [`services/solver/src/cpsat_engine/solve.py:690-699`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/services/solver/src/cpsat_engine/solve.py#L690-L699) — `_add_clique_cuts`
- [`services/solver/src/cpsat_engine/schema.py:111-130`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/services/solver/src/cpsat_engine/schema.py#L111-L130) — `Dump.lower_bound`, the required `greedy` key
- [`services/solver/tests/test_objective.py:23-47`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/services/solver/tests/test_objective.py#L23-L47) — the 10/10 parity gate on the frozen greedy board
- [`contracts/generation-wire.schema.json:143-147`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/contracts/generation-wire.schema.json#L143-L147) — optional `lowerBound` on the wire
- [`docs/runbooks/plan-generation.md:55-71`](https://github.com/dobrek/ib-timetable-planner/blob/b9d70b1d34b90fbc183705bc4d33ccd5c91b2506/docs/runbooks/plan-generation.md#L55-L71) — stale author runbook (describes greedy)

## Architecture Insights

- **The engine-agnostic seams did their job.** Greedy is a leaf: the oracle (`verify.ts`), the objective, snapshot assembly, the analyzer and the job pipeline never depended on it. That is why the deletion has no production blast radius. The one exception is portability invariant 3 ("shared derivations live outside `engines/greedy/`", `context/archive/2026-07-12-generation-quality-tuning/plan.md:161-172`), which the clique bound violated. It turns out not to matter, because the derivation is not shared by anything live.
- **Coupling hides in data, not imports.** The real cross-ecosystem dependency is greedy's *output frozen into fixtures*: the seed dump, the parity tuple and the golden `lowerBound`. No import graph shows it. The frozen-recorded-artifact pattern (already used for the result golden) is the established way to live with that.
- **Wire narrow, in-app wide.** The contract was deliberately kept narrower than the TS types (`engine: const "cp-sat"`, no `stagnation`) so that greedy's retirement would be "a PRD non-event". That design pays off here: S-309 needs no `formatVersion` bump.
- **"Report, never judge"** is a deliberate stance across `bench/` campaign tooling. An executable baseline introduces the first judge, and it belongs in the CP-SAT test lane (where CP-SAT changes are already gated), not in the reporting tools.

## Historical Context (from prior changes)

- **`context/changes/post-poc-cp-sat-refactoring-plan/research.md`:**
  - `:337-365`: the 14:05 verdict was "freeze, retire behind a five-condition gate".
  - `:369-399`: the 14:20 challenge moved deletion into the migration, with three technical preconditions: clique extraction, a re-anchored baseline, hint-free Mode A.
  - `:347` calls the clique bound "the one genuine dependency". That premise did not survive: the HTTP wrapper never carried it.
- **`context/archive/2026-08-14-clean-up-bench-generation/change.md`:**
  - D1 (`:37-49`) deleted the CI bench job and the Web Worker path, and left the engine and its bench experiments for S-309.
  - D4 (`:70-83`): restate the precondition rather than drop it; PRD wording is the author's call.
  - D6 (`:96-104`): deleting `generation.experiment.ts` alone is pointless while `export-snapshot` keeps `bench/` coupled to greedy.
  - The guardrails (`:146-159`) say to reason about `bench/` per file.
  - Its `research.md:242-252` first flagged the exporter as the seed fixture's only producer.
- **`context/archive/2026-07-12-generation-quality-tuning/plan.md:161-172`:** the three portability invariants, including "shared derivations live outside `engines/greedy/`".
- **`context/archive/2026-09-03-production-calibration-campaign/`:**
  - `change.md:157-243`: calibration passed, hint-free Mode A measured, the pinned baseline.
  - `research.md:132-142`: precondition table, with clique extraction "a pure code move plus a decision about the field's future".
  - `plan.md:45`: the executable test is deferred to S-309.
  - The deploy-during-solve rescue path is still unexercised (`change.md:108-122`).
- **`context/archive/2026-09-02-solve-policy-choice/research.md`:**
  - `:146`: the clique cut is keyed to tier identity, so it is policy-order safe.
  - `:463-467`: suggested deleting `scoreCandidate`/`compareObjectives` at S-309. This is overtaken for `scoreCandidate` by `campaign-ledger.ts`.
- **`context/archive/2026-09-01-stop-and-keep/plan-brief.md:8-12`:** S-305 was a retirement precondition because greedy's cancel affordance needed a replacement. It now has one.

## Related Research

- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — the greedy keep/freeze/delete follow-ups
- `context/archive/2026-08-14-clean-up-bench-generation/research.md` — what was swept vs left for S-309
- `context/archive/2026-09-03-production-calibration-campaign/research.md` — the precondition audit and the baseline intent
- `context/archive/2026-09-02-solve-policy-choice/research.md` — clique-cut ordering, `scoreCandidate`/`compareObjectives` fate
- `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md` — the cut's measured tier-3 bound in the POC

## Open Questions

Decisions for the author before `/10x-plan`:

1. ~~**Clique bound.** Accept R1 (retire the TS derivation; amend FR-314's precondition), with R2 (Python-native cut, parked-safe weighting) as a separate follow-up? Or require R2 inside S-309?~~ **Decided 2026-10-08: R1b.** S-309 retires the TS derivation *and* the dormant Python cut, keeps `lowerBound` optional on the wire, and treats R2 as a separate follow-up. See `change.md` § "Decision: clique bound → R1b".
2. **Baseline.** Is A + C in the `solver` lane an acceptable reading of "pinned and executable", with S-308's ledger kept as the documented, non-asserted production reference?
3. **Exporter.** Rewrite it hint-free and keep the export → CLI → import loop, or delete the export/import pair and the orphaned harness helpers?
4. **Residue depth.** Delete or keep: `deriveGoldenSets` (on the July never-delete list), `SEARCH_TIERS` and the polish gate? Narrow `engine`/`provenOptimal`? (The recommendation keeps the port and `budgetMs` to stay out of the page slice.)
5. **Python naming.** Confirm the `greedy_*` dump and field rename is out of scope (recommended).

Unverified facts the plan should check:

- **GitHub runner vCPU count** for the `solver` job, which affects A's 4-worker setting and the bound calibration.
- **Whether CP-SAT gives the same tuple on arm64 and x86_64** under deterministic mode. This only matters if B is ever reconsidered.
- **Whether the greedy barrel export currently reaches a client bundle.** It is likely tree-shaken; no build was run.
- **Whether a merge that leaves the image content unchanged still rolls the container.** It is moot for the recommended shape, which changes the image anyway.
- **README CI timings are stale** (solver 44 s → 2m01s; e2e ~444 s → ~8 min). This is an adjacent docs fix, not S-309's.

## Follow-up Research 2026-10-08T08:48+02:00 — the clique bound in depth

**Question (author):** elaborate on the clique bound.

### What it is

- **The conflict graph.** For each cohort, every course is a node. Two courses share an edge when they share a teacher or a student, so they can never sit in the same `(day, period)` cell (`problem.ts:165-176`).
- **A clique** is a set of courses that pairwise conflict. Every hour of every course in a clique therefore needs its own cell. So the clique's total hours is a **provable lower bound** on the cohort's occupied cells, which is tier 3 (`totalSlots`), in a fully placed cohort.
- **The computation.** `maxWeightCliqueWeight` (`problem.ts:136-156`) finds the heaviest such clique (weight = hours) by branch-and-bound, capped at 100k expansions. On the real catalog (~35–40 nodes per cohort) a Python port takes ~1–3 ms per cohort.
- **Excluded nodes.** These exclusions are deliberate, and each one only *weakens* the bound, so it stays valid:
  - early-finish (flagged) courses, which live under the day-edge rule;
  - biweekly courses, two of which can share a cell in alternating weeks;
  - zero-hour courses.
- **Measured values:** golden catalog 46/41, seed 48/45 (`context/archive/2026-07-15-poc-cp-sat-backend-service/research.md:430-467`).

### What it was for

- **A redundant cut.** Before tier 3, `_add_clique_cuts` adds `cohort_slots[c] >= bound` for each cohort the incumbent already completes (`solve.py:610-611,690-699`).
  - If the bound is sound, the cut changes no answer. It only helps CP-SAT *prove* how good a slot count is, and prune.
- **Why the POC adopted it:** "free strength the solver demonstrably does not find alone". On seed dp1, CP-SAT proved 46 on its own against a clique floor of 48 (`poc …/research.md:465-467`).
- **What the POC measured with the cut** (`poc …/results.md:81-94`, 30 s stages):
  - tier 3 ended FEASIBLE at 95 with bound **87 = 46 + 41**, i.e. the proven bound *was* the clique bound;
  - it did not reach OPTIMAL; an 8-slot gap remained.

### Where it runs today: bench only, never production

- **Production:** `build_dump` gives the engine empty diagnostics (`runner.py:204-223`). `Dump.lower_bound()` returns `None` and the cut is skipped; the runner's docstring says so (`:208-211`).
  - S-308's 14 production runs all solved without it: proven tier-3 bound **21–49**, delivered **92–96**.
  - Tier 3 stopped on the 240 s budget in every run (`production-calibration-campaign/change.md:199-200`).
- **CI:** the cut still runs through the frozen `seed-plan-a.json` (bounds 48/45) in `test_solve.py:150` and the live `test_stage_stop.py` tests. No test asserts what it does.

### Why the precondition is stale

FR-314's "clique-bound derivation extracted" came from July's reading that the bound was "the one genuine dependency" of CP-SAT on greedy (`post-poc …/research.md:347`).

- That held for the POC's file transport, where greedy's diagnostics rode in the dump.
- It stopped holding when F-302's HTTP wrapper shipped without the bound.
- No production code has depended on it since.

### Soundness gap: unsafe to revive as written

- **Parking is per hour.** A parked bundle member is one off-board hour of its course, and generation deficits are net of it (`deficits.ts:6-27`).
- **The bound counts full `course.hours`** and never subtracts parked hours (`problem.ts:138-139,169`).
- **The cut's "cohort complete" guard** uses those parked-net deficits (`solve.py:775-781`).
- **Production snapshots carry parking:** auto-parked phantom courses and user-parked bundles (`plan-snapshot.ts:40-41`).

So when a parked course sits in the heaviest clique, the bound **overstates** the true floor, and the cut becomes a real constraint. Two outcomes:

1. **Overstated but reachable.** CP-SAT must spread courses across at least `bound` cells. Tier 3 is forced above its true optimum, and the delivered board is quietly worse.
2. **Unreachable.** Tier 3 returns INFEASIBLE, and the incumbent stays the tier-2 board.
   - The cut is never removed, so every later stage fails too (`solve.py:631-646` hardens only on a solve).
   - The delivered board is still complete and oracle-clean, so nothing alarms. But tiers 3–10 are unpolished.

**This has never run.** Neither fixture has parked entries.

**The fix:** weight each node by its on-board hours, `max(0, hours − parked hours)`, which is the hours a complete cohort must actually seat. Equivalently, build the clique over the generation deficits plus pinned hours.

### What it could be worth (unmeasured)

1. **An honest optimality gap.** S-308 could not say how far 92–93 slots is from optimal, because the solver's own bound (21–49) is too weak. With the cut, the gap becomes a few slots, not ~50. That is reportable value (e.g. `lowerBound` on the result) even if the board doesn't change.
2. **An earlier OPTIMAL stop**, only when the clique is tight for a catalog. That saves up to 240 s on tier 3. The POC's 8-slot gap suggests this is rare.
3. **Search guidance.** It could help or hurt. Any extra constraint changes CP-SAT's trajectory, and the direction is unknown until measured.
4. **Idea, not researched:** a catalog-adaptive tier-3 stage target such as "stop at `bound + k`". This touches Open Roadmap Question 2, whose blocker is that a target belongs to one catalog and one season. A computed floor travels with the catalog. It needs expert input on `k`.

### Options, refined

| | R1 — retire the TS derivation, amend FR-314 (**recommended for S-309**) | R2 — native Python bound, cut on in production (**separate follow-up slice**) | R3 — literal TS extraction (not recommended) |
| --- | --- | --- | --- |
| Code | Delete `maxWeightCliqueWeight`/`backboneCliques` with greedy. Leave Python's cut code untouched (bench-only, fed by the frozen fixture) | New `cpsat_engine` module computing the bound from the snapshot with parked-safe weights. Optionally emit `lowerBound` on results | Move the TS B&B to `model/generation/clique-bound.ts` |
| Production behaviour | Unchanged | **Changes:** tier 3 moves, so S-309's baseline must be re-pinned | Unchanged unless sent via a new `SolveRequest` field (client-supplied hard constraint outside `snapshot_hash`) |
| Contract | None | None (`lowerBound` already optional on the wire) | None, or an additive request field plus golden regeneration |
| Tests | None new | Port `problem.test.ts` cases; add a parked-course soundness test; regression values 48/45 and 46/41; flip `test_solve.py:353-355` and `test_contract.py:264-271` from "absent" to "present"; parity 10/10 unaffected (`parity()` never enters the ladder) | Port of the TS tests |
| Evidence needed | None | With/without comparison on production: a toggle (env or `CALIBRATION_*`-style override), a few runs each at ~28 min / ~$0.21; compare delivered tier 3, tier-3 stop reason and wall time | — |

**Why R2 should not ride inside S-309:**

- S-309 is a removal whose own guard (the new baseline) must be pinned *before* any CP-SAT behaviour change.
- R2 is exactly such a change.
- Bundling them would break the one-way deletion's "revertable on its own" property (D1 precedent).

**Suggested FR-314 wording under R1.** Replace the extraction precondition with something like:

> The clique-bound cut was found inactive on the production path since F-302 (`runner.py` builds the dump without diagnostics), so no production dependency on greedy remained. Reviving it is a separate CP-SAT change, gated by a parked-safe bound and a production comparison.

### Follow-up 2026-10-08 — does CP-SAT use the value at all?

**No, not on any production solve.** An exhaustive grep of `services/solver/src` finds one source and two uses.

- **Source:** `Dump.lower_bound()` (`schema.py:111-114`). It reads the value from greedy's diagnostics in the dump. On the HTTP path those diagnostics are always `{}` (`runner.py:221`), so it always returns `None`.
- **Use 1, the cut:** `_add_clique_cuts` (`solve.py:611,690-699`) skips a cohort when the bound is `None`.
- **Use 2, the echo:** the bound is copied into the result's `diagnostics.cohorts[c].lowerBound`, and the key is omitted when `None` (`solve.py:520-525`). Production results therefore never carry it, and no TS code reads it.

**Where it is live:**

- **The bench/CLI path**, when a dump made by `export-snapshot` (greedy) is fed to the CLI.
- **CI**, through the frozen `seed-plan-a.json` (48/45): `test_solve.py:150` and the live `test_stage_stop.py` tests. Nothing asserts its effect.
- **The recorded result golden** carries the echoed 48/45.

After greedy is deleted, nothing can produce a new bound, so the cut becomes **test-fixture-only code**. That supports a stronger variant of R1.

**R1b — also delete the dormant Python cut.** *(Adopted as the decision on 2026-10-08; see `change.md`.)* Remove:

- `_add_clique_cuts` and its call;
- `Dump.lower_bound`;
- the echo;
- the docstrings at `solve.py:10-12` and `objective.py:56,143`.

Keep:

- `cohort_slots`, because tier 3 is built from it;
- `lowerBound` as an optional field in the schema and TS types (removing it is a `formatVersion` bump);
- the result golden as a recorded artifact; it stays schema-valid.

Effects:

- CI then exercises the same code path production runs.
- The diff is small and gated by the existing CP-SAT tests. Parity 10/10 is unaffected because `parity()` never enters the ladder.
- **Watch item:** the live `test_stage_stop` tier-3 tests would run without the cut, so check that their timing stays stable.
- It costs no extra container roll, because S-309's new pytest baseline changes the image anyway.
- R2 would re-add a parked-safe bound from the snapshot anyway, so nothing reusable is lost.
