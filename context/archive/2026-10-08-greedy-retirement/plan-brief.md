# Greedy Retirement (S-309) — Plan Brief

> Full plan: `context/changes/greedy-retirement/plan.md`
> Research: `context/changes/greedy-retirement/research.md`

## What & Why

S-309 deletes the TS greedy generation engine. CP-SAT has been the only Generate path since S-301, so greedy's last readers are its own tests and two `bench/` experiments.

FR-314 gates the deletion on three preconditions:

- **Clique extraction:** settled by decision R1b, which retires the cut on both sides because it never ran in production.
- **Regression baseline, pinned and executable:** this plan delivers it.
- **Hint-free Mode A measured:** done in S-308.

## Starting Point

The engine is a leaf: 2,015 lines under `engines/greedy/`, plus three tests beside it, two fixtures, `rng.ts`, and two bench experiments. The coupling that matters is in data:

- `seed-plan-a.json` carries greedy's board, the parity tuple and the clique bounds 48/45;
- the Python cut that reads those bounds fires only on that fixture, never on the HTTP path.

S-308 pinned production tuples, but they come from a deleted instance that cannot be committed, so they cannot be asserted.

## Desired End State

- Greedy, its satellites and its dead code are gone.
- The Python engine has no clique cut.
- A new `services/solver/tests/test_baseline.py` runs in the `solver` lane on every PR:
  - a deterministic proof that CP-SAT reaches the descent catalog's clique-proven optimum of 14 slots;
  - a production-path tripwire on the committed seed catalog, with exact completeness facts and runner-calibrated bounds on `totalSlots` and `teacherHoles`.
- The contracts, goldens and `formatVersion` are unchanged.
- Every doc, tracker and memory that called greedy live now describes the post-greedy world.

## Key Decisions Made

| Decision                           | Choice                                                                                                               | Why (1 sentence)                                                                                                    | Source               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Clique bound                       | R1b: delete the TS derivation and the dormant Python cut; keep `lowerBound` optional on the wire                     | The cut never ran in production, and reviving it (R2, parked-safe) is a separate CP-SAT change                      | Research → change.md |
| What "pinned and executable" means | A (production-path tripwire) + C (descent proof) in the `solver` lane; S-308's ledger stays the documented reference | S-308's numbers can't be reproduced; a committed instance on the real code path can                                 | Plan                 |
| Flake tolerance                    | Bound = worst of ~10 GitHub-runner runs + max(2, 10%)                                                                | Catches structural regressions without going red on unrelated PRs                                                   | Plan                 |
| Test entry point                   | `run_job` + `FakeSupabase`, not an engine-level shortcut                                                             | Production builds its config the same way, which is the "test at the wrapper" rule                                  | Plan                 |
| Exporter                           | Rewrite hint-free and keep the export → CLI → import loop                                                            | Keeps a fixture producer, which R2 will need for a parked-course soundness test                                     | Plan                 |
| TS residue                         | Dead-code sweep: also `SEARCH_TIERS` and the polish gate, `deriveGoldenSets`, `stagnation`, the hooks                | Nothing tool-enforced catches dead exports later; `compareObjectives`, `engine`, `GeneratePlan` and `budgetMs` stay | Plan                 |
| Python orphans                     | R1b plus `_residue`, `_run_ladder`'s `dump` param and `ObjectiveModel.cohort_slots`; the `greedy_*` names stay       | No dead code, still gated by parity, oracle and stage-stop; the rename is cosmetic, so it's a follow-up             | Plan                 |
| Sibling change                     | Proceed in parallel with `automate-production-calibration-campaign`                                                  | S-309 touches only two of its comments; F1 is unrelated                                                             | Plan                 |

## Scope

**In scope:**

- the Python baseline module, the `FakeSupabase` extraction and the `baseline` marker;
- the R1b cut removal and its orphans;
- the hint-free exporter and the deletion of `generation.experiment.ts` and its script;
- the greedy package and its satellites, plus the dead-code sweep;
- the runbook, contract prose, solver README, PRD, roadmap, CLAUDE.md, README/`ci.yml` timing claims, GitHub #106/#108 and the memory note.

**Out of scope:**

- R2, a native, parked-safe bound turned on in production;
- renaming the `greedy_*` dump fields;
- removing `lowerBound` from the wire, or bumping `formatVersion`;
- regenerating goldens or the seed fixture;
- asserting S-308's tuples;
- narrowing `engine`/`provenOptimal`, or deleting `compareObjectives`;
- porting `engine-fuzz`;
- the sibling change's stale ledger paths.

## Architecture / Approach

Guard first, then the CP-SAT edit, then decouple, then delete, then docs:

1. Phase 1 pins the baseline on the production path.
2. Phase 2 removes the cut. The baseline must stay green unchanged, because the cut never fired on that path.
3. Phase 3 frees `bench/` from greedy, so that Phase 4's deletion type-checks on its own.
4. Phase 4 is the deletion, alone in one revertable commit.
5. Phase 5 is the truth-up.

The bounds for baseline A are calibrated only on CI's 4-vCPU `ubuntu-latest`, through a temporary matrix commit (several jobs, so several runner hosts) that is reverted before merge. M-series numbers never set them. If a calibration sample breaks one of A's exact assertions, the work stops for a decision, as it does for C.

## Phases at a Glance

| Phase                    | What it delivers                                                                                 | Key risk                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1. Executable baseline   | `test_baseline.py` (C: OPTIMAL 14; A: bounded tripwire), calibrated on the runner                | C might not _prove_ 14 through the clean ladder: stop and surface it, don't loosen |
| 2. Retire the clique cut | R1b and its orphans removed; parity stays 10/10                                                  | The live `test_stage_stop` seed tests' timing without the cut (watch item)         |
| 3. Re-anchor `bench/`    | Hint-free exporter; greedy benchmark and script gone                                             | The export → CLI → import loop needs a manual run against the local stack          |
| 4. Delete greedy         | One revertable commit: the package, its satellites and the dead-code sweep                       | A missed importer, caught by `pnpm check` covering `bench/`                        |
| 5. Truth-up              | The runbook, contracts, PRD FR-314, roadmap, CLAUDE.md, CI claims, #106/#108 and the memory note | The FR-314 wording needs the author's sign-off                                     |

**Prerequisites:** none blocking. S-305 through S-308 are done. The sibling change proceeds in parallel.

**Estimated effort:** about 2–3 sessions. Phase 1 is the longest, because of the CI calibration round-trip. About 2,600 lines deleted and about 250 added, plus docs.

## Open Risks & Assumptions

- **Unproven in-suite.** Research's scratchpad probe says the descent instance proves tier-3 OPTIMAL = 14 in 0.3–1.3 s, but the suite has never run it. If tier-2 hardening blocks the proof, Phase 1 stops for a decision.
- **Flake risk.** A's runtime and variance on the runner are unknown until calibration. If the variance makes the 10% headroom too loose to mean anything, revisit the stage budget, not the formula.
- **The container rolls on merge.** Phases 1, 2 and 5 change the solver image. Do not merge mid-solve; the rescue path is still unexercised.
- **A reversed decision.** `deriveGoldenSets` deletion reverses July's never-delete list for that one function. This plan records the decision.

## Success Criteria (Summary)

- The greedy engine is gone, and `/verify` plus the four CI lanes are green. Generate, drag-drop validation and board views behave exactly as before.
- FR-314 is met: a baseline anyone can run (`uv run pytest -m baseline`) that guards CP-SAT capability and production-path quality on every PR.
- No reader of the PRD, roadmap, runbook or contracts is told greedy still exists.
