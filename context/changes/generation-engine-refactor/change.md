---
change_id: generation-engine-refactor
title: Generation engine refactor — CI quality bar, decomposition, runner seam
status: planned
created: 2026-07-12
updated: 2026-07-12
archived_at: null
---

## Notes

Follow-up to `plan-generation` and `generation-engine-hardening` (both archived
2026-07-12). Seeded by an in-session critical review of the shipped engine
(`src/entities/timetable/model/generation/engines/greedy.ts`, 2026-07-12) covering
algorithm correctness, test-coverage sufficiency for refactoring, clean-code fit, and
openness to a second engine (server-side CP-SAT). No correctness bugs found; the
findings are structural:

1. **CI is quality-blind.** No CI test asserts slot count — deleting stage 6/7 and the
   whole LNS phase keeps `pnpm test` green; only the off-CI, Supabase-dependent
   `bench/generation.bench.ts` bars (dp1 ≤ 50, dp2 ≤ 48) would catch it. The verify-as-
   oracle fuzz harness protects *validity* strongly (black-box, survives refactors);
   *quality* has no CI guard.
2. **The suite burns ~24 s of every `pnpm test` run.** Search tunables are hard
   constants; with `budgetMs: 2_000` the 2.5 s stagnation window can never fire, so ~9
   tests each burn their full real-time budget. Timing assertions (< 2 s post-abort,
   < 200 ms first tick) are flake-prone under CI load.
3. **`runAttempt` is a ~430-line closure** (six mutable indexes, feasibility, seven
   stages, `chainFit`, `migrateHolesToEdges` — called before its hoisted declaration)
   in a 926-line file. Violates one-concept-per-file / single-responsibility
   conventions. Unnamed magic numbers (ejection depths 2/3, guard 30, 0.67 reservation
   rate, rank weights 100/400, 15-cell descent cap, near-clique window 2).
4. **The objective is greedy-private** (`Objective`, `compareObjectives`,
   `scoreCandidate`, `countStudentHoles`) though it is the engine-agnostic definition
   of board quality — a second engine and the benchmark must share it.
   `countStudentHoles` (tier 4) has zero tests; test helpers reimplement the hole
   metric twice (`greedy.test.ts` `interiorHoles`, bench `countHoles`) and the fuzz
   test carries a private `mulberry32` copy.
5. **The fail-fast precondition lives in the worker** (`generate.worker.ts`), not
   beside the engine — engine index integrity assumes conflict-free pins, so any
   future runner (HTTP, CLI) must remember to re-implement the check.
6. Entity barrel `export *` from `engines/greedy` exposes test-only internals
   (`maxWeightCliqueWeight`, `compareObjectives`, `Objective`) app-wide.

Agreed recommendation — four phases, safety net first, each leaving the tree green:

- **Phase 0 — CI quality bar + fast deterministic suite.** Synthetic-catalog slot-count
  bar (pin empirically, ~20 local runs) plus optionally a crafted descent-required
  instance; `GeneratorConfig.tuning?: { stagnationMs?, diversifyAttempts? }` with
  current constants as defaults → suite drops to a few seconds, timing tests de-flake.
- **Phase 1 — extract engine-agnostic pieces.** `generation/objective.ts` (+ unit
  tests, esp. `countStudentHoles` week handling), shared `rng.ts`; delete the three
  test-helper reimplementations; trim the entity barrel to port + engine + objective.
- **Phase 2 — decompose `greedy.ts`** into `engines/greedy/`: `board.ts` (mutable
  indexes behind a `Board` behavioral contract — place/evict/fitsAt/usedCells),
  `problem.ts`, `stages.ts`, `search.ts`. No behavior change; oracle suite + Phase 0
  bar are the regression gate. Unit tests for `backboneCliques`,
  `interiorFirstCellOrder` (periods ≤ 2) as they become seams; fix the
  `migrateHolesToEdges` hoisting; name the magic numbers; document `chainFit`'s
  reshuffle-on-failure contract.
- **Phase 3 — runner seam.** `runVerifiedGeneration(engine, snapshot, config, hooks)`
  = precondition → engine → verdict; the worker becomes a thin transport. Closes the
  precondition-ownership fragility and is the seam a future HTTP runner calls.

Explicitly deferred: HTTP `RunGeneration` adapter / CP-SAT sidecar (wait for
checkpoint 2.8 real manual per-cohort counts — spike says the prize is ~1–2 dp1
slots); `studentHoles`-targeting move operator; week-aware hole metrics.

Verification: `/verify` per phase; one `pnpm bench:generation` at the end to confirm
the 50/46 envelope is unchanged.
