---
change_id: greedy-retirement
title: Greedy retirement
status: implementing
created: 2026-10-08
updated: 2026-10-08
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### 2026-10-08 — Decision: clique bound → R1b (retire it on both sides)

Taken with the author after `/10x-research`. Evidence is in `research.md` § "Follow-up Research … the clique bound in depth" and § "does CP-SAT use the value at all?".

**Why.** The clique-bound cut has never run on a production solve. The HTTP path builds the dump with empty diagnostics (`services/solver/src/cpsat_service/runner.py:204-223`), so `Dump.lower_bound()` always returns `None`. Once greedy is deleted, nothing can produce a bound, and the cut would only be reachable through the frozen `seed-plan-a.json` fixture.

**What S-309 does:**

- **TS:** deletes `maxWeightCliqueWeight` and `backboneCliques` with the greedy package. They are not extracted to a new module.
- **Python:** deletes the dormant cut:
  - `_add_clique_cuts` and its call (`solve.py:611,690-699`);
  - `Dump.lower_bound` (`schema.py:111-114`);
  - the `lowerBound` echo into result diagnostics (`solve.py:520-525`);
  - the docstrings that describe them (`solve.py:10-12`, `objective.py:56,143`).
- **Keeps:**
  - `cohort_slots`, because tier 3 is built from it;
  - `lowerBound` as an optional field in `contracts/generation-wire.schema.json` and the TS types, so there is no `formatVersion` bump;
  - the result golden as a recorded artifact; it stays schema-valid.
- **PRD FR-314:** the precondition "clique-bound derivation extracted" is restated as resolved. The cut was found inactive on the production path since F-302, so no production dependency on greedy remained. The exact wording is drafted at implementation time.

**Gates:**

- CP-SAT changes are test-gated. The objective-parity suite must stay at exact 10/10; `parity()` never enters the ladder, so it is unaffected by construction. The oracle must still pass on the goldens.
- **Watch item:** the live tier-3 tests in `test_stage_stop.py` will run without the cut. Confirm their timing stays stable.

**Not in S-309 (R2).** Reviving the cut is a separate CP-SAT follow-up:

- compute the bound natively from the snapshot;
- weight each course by its on-board hours, `max(0, hours − parked hours)`, because full `hours` overstates the bound when a parked course sits in the clique;
- switch it on behind a toggle;
- compare with and without on production;
- re-pin S-309's baseline afterwards.

**Rejected:**

- **R1** (retire the TS side only, leave the Python cut): it leaves fixture-only code that the production path never runs.
- **R3** (literal TS extraction): either dead code, or a client-supplied hard constraint outside the `snapshot_hash` binding.

### 2026-10-08 — Planning decisions (`/10x-plan`)

Taken with the author; the full table is in `plan-brief.md`.

- **Baseline:** A + C in the `solver` lane (`services/solver/tests/test_baseline.py`), both through `run_job`. A's bounds are the worst of about 10 GitHub-runner runs plus max(2, 10%). S-308's ledger stays the documented, non-asserted production reference.
- **Exporter:** rewritten hint-free; the export → CLI → import loop stays.
- **TS residue:** dead-code sweep. **`deriveGoldenSets` is deleted**, which reverses July's never-delete listing for that one function (its only caller was greedy's `problem.ts`). The `GOLDEN_*` constants stay.
- **Python:** R1b plus its orphans: `_residue`, `_run_ladder`'s `dump` parameter, and `ObjectiveModel.cohort_slots`. The `greedy_*` names stay.
- **Sequencing:** in parallel with `automate-production-calibration-campaign`, which keeps its F1 and its stale ledger paths.

### 2026-10-08 — Phase 1: baseline calibration evidence

**Run:** CI run [37755541849](https://github.com/dobrek/ib-timetable-planner/actions/runs/37755541849), on a throwaway branch (`greedy-retirement-calibration`, deleted afterwards). It used `workflow_dispatch`, with 5 matrix jobs × 2 runs of `uv run pytest -m baseline -s` on `ubuntu-latest`.

- Every runner had 4 vCPU.
- The hosts were AMD EPYC 7763 (×3), AMD EPYC 9V74 and Intel Xeon 8370C, so the samples span more than one CPU model.

**Exact assertions:** all ten samples passed. Every sample was complete with `holes` 0 and `softHits` 0, and `clean_fallback` was False.

**Bounded tiers, the ten A samples in run order:**

| Shard / run            | totalSlots     | teacherHoles      | wall clock (s)     |
| ---------------------- | -------------- | ----------------- | ------------------ |
| 4/1                    | 97             | 172               | 68.0               |
| 4/2                    | 99             | 185               | 67.6               |
| 1/1                    | 99             | 222               | 71.4               |
| 1/2                    | 97             | 222               | 71.8               |
| 5/1                    | 97             | 211               | 73.5               |
| 5/2                    | 96             | 205               | 73.3               |
| 3/1                    | 97             | 191               | 76.5               |
| 3/2                    | 99             | 206               | 69.3               |
| 2/1                    | 99             | 239               | 76.6               |
| 2/2                    | 98             | 234               | 76.8               |
| **min / median / max** | 96 / 97.5 / 99 | 172 / 208.5 / 239 | 67.6 / 72.6 / 76.8 |

**Bounds, from `worst + max(2, ceil(0.10 × worst))`:** `TOTAL_SLOTS_BOUND = 109` and `TEACHER_HOLES_BOUND = 263`.

- On M-series the same test gave `teacherHoles` 105–119, far below every runner sample. This is why the bounds come only from the runner.

**Wall clock:**

- A takes 67.6–76.8 s, within the ≤ ~90 s target.
- C takes 2.4–3.3 s on the runner and 1.3 s on M-series.

**Adaptation: C's tier 10 gets a stage target.**

- On the descent catalog, tier 10 (golden-band distance) finds 1 against a bound of 0 and never proves it. It burned its full 15 s budget on every run, so C took 16.5 s instead of ~1 s.
- C now sets `stage_targets={10: 10**9}`, through the same `Settings.stage_targets` path production carries, so tier 10 stops at its first solution.
- Tier 3, which C asserts, has no target and keeps the full 15 s budget as proof headroom. It proved OPTIMAL = 14 in ~0.45 s on M-series and well inside 3.3 s on the runner.

**Mutation check:** `TOTAL_SLOTS_BOUND = 90` turned A red (`98 <= 90`), and `DESCENT_OPTIMAL_SLOTS = 13` turned C red (`('OPTIMAL', 14) == ('OPTIMAL', 13)`). Both were reverted.

### 2026-10-08 — Phase 2: the clique cut is gone; the watch-item timings

**Watch item:** the two live seed tests in `test_stage_stop.py` (`-k live`, 8 workers, `LIVE_CEILING_S = 25`). Timed on M-series, so this shows stability only; these figures are not budgets.

| | stop from another thread | board kept after a stop |
| --- | --- | --- |
| Without the cut, 5 runs | 2.68, 2.26, 2.25, 2.27, 2.28 s | 2.60, 2.27, 2.35, 2.24, 2.30 s |
| With the cut (`0b4a5a2`), 2 runs | 2.34, 2.31 s | 2.29, 2.32 s |

The timing is unchanged, because the stop lands 0.5 s into tier 3 whether or not the cut is there. Both tests run at about a tenth of their ceiling. CI confirms with the Phase 2 push.

**CLI on the seed dump:** `uv run cpsat --mode complete --stage-budget 5 --mode-a-budget 30 --workers 4` completed with 238 placements and `stopReason: budget`. No `lowerBound` key appears anywhere in the result. `--mode parity` still reports 10/10.

### 2026-10-08 — Phase 3: the hint-free export → CLI → import loop, against the local stack

1. **Export.** Ran `SOURCE_PLAN_ID=<Seed Plan A> OUT=<scratch>/seed-dump.json pnpm experiment:export`.
   - The dump has `greedy: { placements: [], diagnostics: {} }` and a pins-only objective of `[250, 0, 0, 0, 0, 0, 0, 0, 0, 0]`.
   - Nothing was auto-parked.
2. **CLI.**
   - `--mode parity` on the new dump reports 10/10: the pins-only board, all generated vars fixed to 0.
   - `--mode complete --policy clean --stage-budget 5 --mode-a-budget 60 --workers 4` reports `outcome=complete` with 250 rows.
3. **Import.** Ran `IN=… DUMP=… pnpm experiment:import`. The result is `verify: OK · soft warns 0` and was persisted into the clone.
4. **Cleanup.** Both clones were deleted afterwards through a local-only guarded script.

**Not caused by S-309: `PIN_SKELETON=1` refused** on the local Seed Plan A. The message was "Fixture skeleton incomplete in the source plan: dp1 EE (2), dp1 CAS (1) … carry no placements".

- That guard is in `copyFixtureSkeleton`, which this change does not touch.
- The local seed plan's board no longer carries the fixture rows the skeleton expects. That is local data state, not this change.
- The refused attempt had already cloned the plan; that clone was deleted with the other.

### 2026-10-08 — Phase 5: truth-up, a scope adaptation, and one observation

**Adaptation, approved by the author: about 20 more comments were rewritten.** Phase 4's grep looked only for the word "greedy", so it missed comments that cite greedy mechanisms by name:

- `board.fitsAt` / `board.ts`, cited as the in-engine twin the oracle's delta semantics "must stay" aligned with. These were in `verify.ts`, `verify.test.ts` and `collision/constraints/*`.
- The engine fuzz and the "20-second solve", in `early-finish-edge.*`.
- The LNS, in `student-lens.ts` and `objective.test.ts`.
- `problem.ts`, in `solve.py`.

Each rationale was re-derived against today's code. Where a twin still exists, the comment now cites CP-SAT's `model.py`, which encodes every day-scoped rule per lane. Elsewhere the history is stated plainly. All of it is comment-only.

**Observation, predating S-309 and not fixed here:** the solver's pins precondition is STRICTER than the app's.

- `model.py`'s `_assert_pins_precondition` calls itself the mirror of `verifyGeneration(snapshot, [])`. But it raises `PreconditionError` on pins that already stack a course, split a course, or over-shape a teacher day.
- `verifyGeneration` permits all three as pin-only warns (delta semantics), and the UI allows them as warns.
- So an author who hand-places, for example, an over-long teacher day passes the app's precondition, enqueues a job, and gets back `failed: precondition: pins over-shape teacher day …`.
- The `verify.ts` docblock now states the asymmetry. Whether to align the two is an open product question (a candidate follow-up), outside S-309's scope.

**CI timing figures** were taken from one PR #135 run (37771005774, on `f10bf39`, the final code state): `solver` took ~194 s and `e2e` ~393 s. Across the four PR runs, e2e ranged 393–461 s and solver 165–208 s, so the solver lane stays well off the critical path.

**Trackers (outward-facing, with the author's approval):**

- #106 was retitled "S-309: Retire the greedy engine; pin the CP-SAT regression baseline", and its body was rewritten.
- #108's open question 2 now reads "deferred, not resolved" and points at PRD Open Question 2.
- PR #135 carries `Closes #106`.

**Memory:** `greedy-engine-slated-for-removal` was replaced by `greedy-engine-removed`.
