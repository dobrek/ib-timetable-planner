---
change_id: generation-engine-refactor
title: Generation engine refactor — CI quality bar, decomposition, runner seam
status: implementing
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

## Implementation Notes

### Phase 1 (2026-07-12)

**Descent fixture — constructive-vs-optimum (criterion 1.8).** The synthetic and small
random instances are solved to the clique optimum by construction alone (this engine's
stage 2 packing + stage 3 ejection chains are strong), so a small crown/bipartite graph
does NOT force descent. The descent-required fixture (`__fixtures__/descent-catalog.ts`)
was found by searching dense random catalogs for one where the full engine reaches the
max-weight clique lower bound while construction-only overshoots it, then frozen as
explicit literals: a 12-course / 28-hour / 5×6 instance whose clique floor (and proven
optimum) is **14** slots. Measured: **construction alone lands at 15 slots; descent reaches
14** (20/20 runs each at the fast test tuning). Because 14 is the clique floor, the
`=== 14` assertion is machine-speed independent (the engine can never go below it and
reliably reaches it). Mutation check (criterion 1.5): temporarily disabling stage 6 + LNS
turns the bar red at 15; reverted.

**Suite wall time (criterion 1.4).** Generation suite dropped from ~24 s to ~7 s by giving
the solve-quality tests a fast-tuned engine (`createGreedyEngine({ stagnationMs: 150 })`);
the cancel/progress/timing tests keep the default engine to assert real-time behaviour.

**Bench dp2 = 46 pin (criterion 1.7).** `bench/generation.bench.ts` now builds
`createGreedyEngine({ stagnationMs: 10_000 })` with `BUDGET_MS = 60_000`, `CEILING_MS =
90_000`, `SLOT_BARS = { dp1: 50, dp2: 46 }`. Local validation: 5 consecutive
`pnpm bench:generation` runs all landed **dp1 = 49, dp2 = 46** (each ran the full 60 s
budget — stagnation does not fire on the real catalog). No fallback needed.

**Bench CI job probation (criterion 1.9).** A non-blocking `bench` job was added to
`ci.yml` (mirrors the integration job: checkout → setup → supabase-stack →
`pnpm bench:generation`) plus `workflow_dispatch:` on the workflow. It is intentionally NOT
in `deploy.needs` (confirmed unchanged: `[verify, integration, e2e]`). Promotion protocol
recorded as a comment on the job: ~5 `workflow_dispatch` runs landing dp2 = 46 → promote to
a required gate in a follow-up; if runners land 47 → hold CI bar at ≤ 47, keep local strict.

### Phase 3 (2026-07-12) — two deviations from "mechanical moves only"

`greedy.ts` split into `engines/greedy/{index,search,problem,board,stages}.ts`. The
decomposition is behavior-preserving: instrumenting the pre-split engine and the new folder
proved attempt-2 construction is byte-identical, rng-at-descent-entry is identical (284), and
the descent place/evict op sequence is identical (73 = 73). Two intentional edits beyond
pure moves, both recorded here:

1. **`Board` is a `type`, not an `interface`.** The plan called for `interface Board` (the
   one legitimate behavioral contract), but the flat ESLint config enforces
   `@typescript-eslint/consistent-type-definitions: "type"`, and `pnpm lint` is a CI gate.
   Expressed as a `type` with method members — same contract, lint-clean.

2. **Validity gate on descended acceptance (`search.ts`).** The board abstraction adds a
   little per-op overhead, which shifts how many iterations descent's wall-clock time-spin
   (`while (emptied || Date.now() < descentUntil)`) runs — a source of nondeterminism that
   exists in the shipped engine too. A different iteration count surfaced a *pre-existing
   latent bug*: descent's ejection-chain rollback (`board.place(member, …)`) is not
   re-validated, so a chain that fails after relocating a slice can leave a flagged course
   boxed. The old engine avoided it for the fuzz seeds by timing luck (0/80 invalid across
   varied budgets); the new engine hit it deterministically for fuzz seed 13. Fix:
   `runAttempt` now accepts the descended board only if it beats construction AND
   `verifyGeneration` passes, falling back to the always-valid constructed board otherwise.
   A no-op on any valid descended board (so default-tuned output is unchanged and the bench
   envelope holds), it upholds the engine's hard invariant — never emit a board the oracle
   rejects. Confirmed: fuzz green 3/3 consecutive runs.
