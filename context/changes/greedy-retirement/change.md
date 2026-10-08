---
change_id: greedy-retirement
title: Greedy retirement
status: planned
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
