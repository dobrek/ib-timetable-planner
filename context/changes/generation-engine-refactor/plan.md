# Generation Engine Refactor Implementation Plan

## Overview

Behavior-preserving hardening and refactor of the shipped GRASP/LNS generation engine: CI gains a real quality guard (today it is quality-blind), the generation test suite drops from ~24 s to a few seconds, `greedy.ts` (926 lines, ~430-line `runAttempt`) decomposes into convention-compliant modules, and the fail-fast precondition moves from the worker into a shared runner seam beside the engine.

Seeded by the in-session critical review recorded in `change.md` (2026-07-12). The conversation's "Phase 0–3" maps to this plan's Phase 1–4.

## Current State Analysis

- **Engine**: `src/entities/timetable/model/generation/engines/greedy.ts` — one file holding the search driver, problem projection, mutable board indexes, feasibility, seven construction/repair stages, objective scoring, and PRNG utils. `runAttempt` (`greedy.ts:308-736`) is a single closure over six mutable structures; `migrateHolesToEdges` is called at `greedy.ts:660` and declared (hoisted `function`) at `greedy.ts:663`.
- **Validity guard**: strong — verify-as-oracle fuzz (`engine-fuzz.test.ts`, 8 seeds × empty + pinned re-solve), hard-rule matrix, boxing regression repros, cancel/progress/partial semantics. All black-box against the `GeneratePlan` port.
- **Quality guard**: none in CI. Deleting stage 6/7 and the LNS phase keeps `pnpm test` green; only the off-CI, Supabase-dependent `bench/generation.bench.ts` (bars dp1 ≤ 50 / dp2 ≤ 48; measured 50/46) would catch it.
- **Suite cost**: ~24 s wall. `STAGNATION_MS = 2_500` (`greedy.ts:36`) exceeds the 2 s test budgets, so ~9 tests burn their full real-time budget; timing assertions (< 2 s post-abort, < 200 ms first tick) are flake-prone under load.
- **Objective**: `Objective`, `compareObjectives`, `scoreCandidate`, `countStudentHoles` are greedy-private though engine-agnostic. `countStudentHoles` has zero tests. Three test helpers reimplement engine logic (`interiorHoles` in `greedy.test.ts:18-26`, `countHoles` in `bench/generation.bench.ts:87-95`, `mulberry32` in `engine-fuzz.test.ts:113-121`).
- **Precondition**: `generate.worker.ts:40-44` verifies pins-only cleanliness before invoking the engine; the engine's index integrity silently assumes it. Any future runner must remember to re-implement it.
- **Public surface**: `src/entities/timetable/index.ts` does `export * from "./model/generation/engines/greedy"`, exposing test-only internals (`maxWeightCliqueWeight`, `compareObjectives`, `Objective`) app-wide. Bench and worker import `generatePlanGreedy` through this barrel.

## Desired End State

- CI fails if the engine loses its slot-minimization capability (crafted descent-required instance + synthetic-catalog slot bars).
- Generation suite ≤ ~8 s wall with exactly one real-budget smoke retained.
- `engines/greedy/` folder of concept files (`search`, `problem`, `board`, `stages`), engine-agnostic `objective.ts` and `rng.ts` at `generation/` level, no test-helper reimplementations, entity barrel exports only the intended surface.
- `runVerifiedGeneration` owns precondition → engine → verdict; the worker is a thin transport.
- Bench pins dp2 = 46 under extended windows; `pnpm bench:generation` confirms dp1 ≤ 50 / dp2 = 46 at the end.
- The real-catalog bench also runs on every push/PR as a **non-blocking parallel CI job** (not in `deploy.needs`); promoting it to a deploy gate is a recorded follow-up decision after probation.

Verify: `/verify` green per phase; one bench run at the end; behavior unchanged (same oracle suite passes, modulo import paths and tuned budgets).

### Key Discoveries:

- `scoreCandidate` (`greedy.ts:738-768`) reads only `problem.snapshot` from `Problem` — it can be re-signatured over `GeneratorSnapshot` and moved to an engine-agnostic module without touching greedy internals.
- Stagnation, not budget, ends real-catalog runs (measured: final board at ~6.7 s, stagnation stop at 9.2 s vs 20 s budget). A dp2 = 46 bench pin is therefore de-flaked by scaling `stagnationMs`, not `budgetMs` alone.
- The engine keeps time with `Date.now()` throughout — fake timers cannot speed tests up; shrinking the tuned windows is the only lever (hence the factory).
- The synthetic catalog is easy enough that construction alone may reach its slot optimum — a synthetic-only bar would not guard descent/LNS. The crafted instance is the actual capability guard.
- Lesson (`lessons.md`): type-gate success criteria must cite `pnpm check`, never build/lint. Lesson: prefer declarative pipelines in pure helpers — but the board mutation hot path is legitimately imperative; don't force it.

## What We're NOT Doing

- No HTTP `RunGeneration` adapter, no CP-SAT sidecar or second engine (deferred to checkpoint 2.8 evidence — spike says the prize is ~1–2 dp1 slots).
- No `studentHoles`-targeting move operator; no week-aware hole/slot metrics.
- No change to search behavior, objective tiers, hard-rule semantics, worker protocol, or UI. Default-tuned output must be search-equivalent to today's engine.
- No tightening of the dp1 parity bar (stays ≤ 50); dp2's 46 pin is a regression envelope, not a parity decision.
- No new Supabase schema, actions, or routes.

## Implementation Approach

Safety net first, then extractions smallest-risk-first, then the mechanical decomposition, then the runner seam. Every phase leaves the tree green and shippable (`/verify`). Phases 2–4 are behavior-preserving refactors executed under the Phase 1 guard: the oracle suite carries validity, the new quality bar carries capability.

## Critical Implementation Details

- **Descent-required fixture protocol**: the CI assertion is black-box (final total slots equals the pinned optimum, verify-clean), but the fixture's "construction alone exceeds the optimum" property must be *demonstrated during implementation* — measure the deterministic constructive checkpoint's slot count (temporary instrumentation or reasoning over stage 1–5 output) and record both numbers in the fixture's doc comment (e.g. "construction lands at 8 slots; descent reaches the 6-slot optimum"). The guard is capability-level: it fails if slot minimization stops working, regardless of which stage regressed.
- **Bench pin mechanics**: stagnation is wall-clock (`Date.now() - lastImproveAt`), so machine speed changes rounds-per-window. The bench must construct `createGreedyEngine({ stagnationMs: 10_000 })` with `budgetMs: 60_000` and a raised elapsed ceiling (90 s); pinning dp2 = 46 without that tuning would be flaky. Validate with ~5 consecutive local runs before committing the pin; if any run lands on 47, ship `≤ 47` instead and record the observation in `change.md`.
- **Barrel path stability across Phase 3**: `bench/generation.bench.ts` and `generate.worker.ts` import `generatePlanGreedy` via `@/entities/timetable`. The entity barrel's named export must resolve at every commit while `engines/greedy.ts` becomes `engines/greedy/` — switch the barrel path in the same commit as the folder move.
- **Tuning semantics, not fake time**: tuned tests shrink `stagnationMs`/`diversifyAttempts` and budgets; they must not stub `Date.now`. Timing assertions keep their current generous ceilings; only the solve windows shrink.
- **Bench CI job is non-blocking by design**: the dp2 = 46 pin is validated on the dev machine; GitHub runners are slower and the pin's stability there is unproven. The `bench` job must NOT be added to `deploy.needs` in this change. Probation protocol: let it run for ~a week (or ~5 `workflow_dispatch` runs); if all land dp2 = 46, promote to a required gate in a follow-up; if runners land 47, hold the CI-side bar at ≤ 47 while the local bench keeps the strict 46. Record the protocol as a comment on the job. `workflow_dispatch` must be added to the workflow's `on:` block for the probation runs.

## Phase 1: CI Quality Bar + Tunable Engine

### Overview

Give CI a capability guard for slot minimization and make the engine's search windows injectable so tests (and the bench) stop paying real-time costs.

### Changes Required:

#### 1. Tuning factory

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`

**Intent**: Make the two wall-clock search constants injectable without touching the engine-agnostic port. `generatePlanGreedy` remains the default-tuned instance so no consumer changes.

**Contract**: other phases and the bench depend on this signature:

```ts
export type GreedyTuning = {
  /** Stop window once complete + hole-free (default 2_500 ms). */
  stagnationMs?: number;
  /** Constructive attempts in Phase A (default 3). */
  diversifyAttempts?: number;
};
export const createGreedyEngine = (tuning?: GreedyTuning): GeneratePlan => /* … */;
export const generatePlanGreedy: GeneratePlan = createGreedyEngine();
```

`STAGNATION_MS` / `DIVERSIFY_ATTEMPTS` become the defaults inside the factory. Default-tuned behavior is bit-identical to today.

#### 2. Descent-required fixture

**File**: `src/entities/timetable/model/generation/__fixtures__/descent-catalog.ts` (new)

**Intent**: A small deterministic instance whose constructive stages provably land above the known optimal slot count, so only working descent/LNS reaches the optimum. Export the snapshot factory plus the pinned `DESCENT_OPTIMAL_SLOTS` constant.

**Contract**: doc comment records the measured constructive slot count vs the optimum (see Critical Implementation Details). Instance must solve to the optimum in ≲ 1 s with fast tuning.

#### 3. Quality-bar test

**File**: `src/entities/timetable/model/generation/quality-bar.test.ts` (new)

**Intent**: The CI quality guard. (a) Crafted instance: tuned engine reaches `DESCENT_OPTIMAL_SLOTS`, verify-clean. (b) Synthetic catalog: per-cohort `occupiedSlotsAfter` within empirical bars pinned from ~20 local runs (record the runs' spread in a comment).

**Contract**: black-box through `createGreedyEngine` + `verifyGeneration` only.

#### 4. Retune the existing suite

**File**: `src/entities/timetable/model/generation/engines/greedy.test.ts`

**Intent**: Every solve switches to a tuned instance (small `stagnationMs`, ~1 s budgets) so easy instances stop via stagnation in ≲ 300 ms; assertion *meanings* are unchanged (the stagnation-stopReason test now uses tuned windows instead of an 8 s budget). `engine-fuzz.test.ts` stays as-is (already 150 ms budgets); `generation-smoke.test.ts` keeps its real 1.5 s budget as the one realism sanity.

**Contract**: generation suite wall time ≤ ~8 s; no assertion weakened.

#### 5. Bench pin

**File**: `bench/generation.bench.ts`

**Intent**: Pin dp2 = 46 as a regression envelope under machine-speed-independent windows; dp1 parity bar unchanged.

**Contract**: `createGreedyEngine({ stagnationMs: 10_000 })`, `BUDGET_MS = 60_000`, `CEILING_MS = 90_000`, `SLOT_BARS = { dp1: 50, dp2: 46 }`; comment distinguishes regression envelope (dp2) from deferred parity bars (checkpoint 2.8). Fallback protocol per Critical Implementation Details.

#### 6. Non-blocking bench CI job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the real-catalog bench on every push/PR as a parallel job so quality regressions on the real catalog surface in CI instead of waiting for a manual bench run. Non-blocking during probation (see Critical Implementation Details).

**Contract**: new `bench` job mirroring the integration job's shape — checkout → `./.github/actions/setup` → `./.github/actions/supabase-stack` → `pnpm bench:generation` (the bench reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from env, which the composite action exports). NOT listed in `deploy.needs`. Add `workflow_dispatch:` to `on:`. Job comment records the promotion protocol.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Lint + FSD structure pass: `pnpm lint && pnpm steiger`
- Full unit suite green: `pnpm test`
- Generation suite wall time ≤ 8 s: `pnpm vitest run src/entities/timetable/model/generation src/_pages/plan-detail/model/generation`
- Quality-bar test fails when descent is disabled (one-off mutation check: temporarily no-op stage 6 + LNS locally, confirm red, revert)
- The `bench` CI job runs green on this change's own PR/push run

#### Manual Verification:

- ~5 consecutive `pnpm bench:generation` runs all land dp2 = 46 (or fallback applied and recorded in `change.md`)
- Constructive-vs-optimum measurement recorded in the fixture doc comment
- Bench-job probation/promotion protocol recorded (job comment + `change.md`); `deploy.needs` confirmed unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation of the bench validation before proceeding.

---

## Phase 2: Extract Engine-Agnostic Pieces

### Overview

Move the definition of board quality and the PRNG out of the engine, kill the three test-helper reimplementations, and trim the entity barrel.

### Changes Required:

#### 1. Objective module

**File**: `src/entities/timetable/model/generation/objective.ts` (new)

**Intent**: Own `Objective`, `compareObjectives`, `scoreCandidate`, `countStudentHoles`, plus a newly-exported `countInteriorHoles(rows, days)` (the per-day hole scan currently inlined in `scoreCandidate`). This is the shared quality definition any future engine and the bench must score against.

**Contract**: `scoreCandidate` re-signatured over `GeneratorSnapshot` (it only reads `problem.snapshot` today — verified). The `Candidate` shape moves with it. Greedy imports from here; no behavior change.

#### 2. RNG module

**File**: `src/entities/timetable/model/generation/rng.ts` (new)

**Intent**: `mulberry32`, `shuffled`, `pickFrom` move out of the engine; `engine-fuzz.test.ts` deletes its private copy and imports the real one.

**Contract**: identical implementations — fuzz seeds must reproduce the same instances.

#### 3. Objective unit tests

**File**: `src/entities/timetable/model/generation/objective.test.ts` (new)

**Intent**: First-ever tests for `countStudentHoles` (week `"both"` expands to both lanes; per-lane span − occupancy math; multi-student rows) and for `countInteriorHoles`; the existing `compareObjectives` describe block moves here from `greedy.test.ts`.

**Contract**: covers tier 2 and tier 4 of the objective directly.

#### 4. Kill helper duplicates

**File**: `src/entities/timetable/model/generation/engines/greedy.test.ts`, `bench/generation.bench.ts`

**Intent**: Replace `interiorHoles` / `countHoles` with the exported `countInteriorHoles`.

**Contract**: `grep` finds no local reimplementation of hole counting or mulberry32 outside `rng.ts`/`objective.ts`.

#### 5. Barrel trim

**File**: `src/entities/timetable/index.ts`

**Intent**: Replace `export * from "./model/generation/engines/greedy"` with named exports of the intended surface only: `generatePlanGreedy`, `createGreedyEngine`, `GreedyTuning`, plus the objective module. `maxWeightCliqueWeight` stops being app-public (tests import it relatively).

**Contract**: bench and worker imports still resolve; `pnpm check` proves no other consumer existed.

### Success Criteria:

#### Automated Verification:

- `pnpm check && pnpm lint && pnpm steiger && pnpm test`
- New `objective.test.ts` covers `countStudentHoles` week expansion and lane math

#### Manual Verification:

- None (pure refactor + new tests)

---

## Phase 3: Decompose the Greedy Engine

### Overview

Split `greedy.ts` into an `engines/greedy/` folder of concept files. No behavior change — the Phase 1 guard plus the oracle suite is the regression gate.

### Changes Required:

#### 1. Folder split

**File**: `src/entities/timetable/model/generation/engines/greedy/` (new folder, replaces `greedy.ts`)

**Intent**: One concept per file, newspaper order within each:

- `index.ts` — pure barrel: `createGreedyEngine`, `generatePlanGreedy`, `GreedyTuning`.
- `search.ts` — the GRASP/LNS driver (current `generatePlanGreedy` body), `destroyTargets`, `descentDeadline`, `isConverged`, the yielder, `toResult`.
- `problem.ts` — `Problem`, `buildProblem`, `cohortDeficits`, `interiorFirstCellOrder`, `conflictGraph`, `backboneCliques`, `maxWeightCliqueWeight`, `CLIQUE_NODE_CAP`.
- `board.ts` — the six mutable indexes behind a `Board` behavioral contract (`interface Board` per convention — the one legitimate interface here) with a `createBoard` factory: `place`, `evict`, `fitsAt` (subsuming `feasibleWeek` + `flaggedEdgeOk`), `usedCells`, `rowsAt`, plus `remaining` access. `removeWhere` lives here. Collapses the four place-push-index and four unindex-remove call sites.
- `stages.ts` — the seven stage functions, `chainFit`, `migrateHolesToEdges`, each `(board, problem, ctx)`.

**Contract**: entity barrel switches to the folder path in the same commit (see Critical Implementation Details). Engine behavior at default tuning is unchanged — the full black-box suite passes without assertion edits.

#### 2. Convention fixes riding the split

**File**: `engines/greedy/stages.ts`, `engines/greedy/search.ts`

**Intent**: Fix the `migrateHolesToEdges` call-before-declaration; name the unnamed magic numbers (`EJECTION_DEPTH_REPAIR = 2`, `EJECTION_DEPTH_DESCENT = 3`, the `guard < 30` cap, the `0.67` reservation rate, the `100`/`400` rank weights, the 15-cell descent cap, the `max - 2` near-clique window); document `chainFit`'s reshuffle-on-failure contract in its docstring. Apply the declarative-pipelines lesson to pure helpers only — the board mutation path stays imperative.

**Contract**: comment/constant changes only; no logic edits.

#### 3. Seam unit tests

**File**: `src/entities/timetable/model/generation/engines/greedy/problem.test.ts` (new)

**Intent**: Tests for the newly-public seams: `backboneCliques` (dedup, near-max window, biweekly/flagged exclusion), `interiorFirstCellOrder` (centre-out ordering; `periods` = 1 and 2 edge cases). The existing `maxWeightCliqueWeight` describe block moves here; `greedy.test.ts` stays the engine-level black-box suite (moved into the folder).

**Contract**: tests import relatively within the slice.

### Success Criteria:

#### Automated Verification:

- `pnpm check && pnpm lint && pnpm steiger && pnpm test`
- Quality-bar and fuzz tests pass unmodified (import paths aside)
- `wc -l` — no file in `engines/greedy/` exceeds ~300 lines

#### Manual Verification:

- Spot-check a diff of moved code blocks: mechanical moves, no logic edits outside the named-constant/doc changes

---

## Phase 4: Runner Seam

### Overview

Move the fail-fast precondition beside the engine so every present and future runner gets precondition → engine → verdict for free.

### Changes Required:

#### 1. Verified runner

**File**: `src/entities/timetable/model/generation/run.ts` (new)

**Intent**: One function owning the full trust-but-verify pipeline, engine-injected. This is the seam a future HTTP runner calls.

**Contract**: the worker depends on this shape:

```ts
export type VerifiedGenerationOutcome =
  | { ok: false; reason: "precondition"; verdict: GenerationVerdict }
  | { ok: true; result: GenerationResult; verdict: GenerationVerdict };
export const runVerifiedGeneration = async (
  engine: GeneratePlan,
  snapshot: GeneratorSnapshot,
  config: GeneratorConfig,
  hooks?: GenerationHooks,
): Promise<VerifiedGenerationOutcome> => /* precondition → engine → verdict */;
```

Exported through the entity barrel.

#### 2. Thin worker

**File**: `src/_pages/plan-detail/model/generation/generate.worker.ts`

**Intent**: Replace the inline precondition + engine + verdict sequence with one `runVerifiedGeneration(generatePlanGreedy, …)` call; map the outcome to the existing protocol messages (precondition failure keeps the exact current error string). Progress throttling stays in the worker (transport concern).

**Contract**: `worker-protocol.ts` unchanged; hook behavior unchanged.

#### 3. Runner unit tests

**File**: `src/entities/timetable/model/generation/run.test.ts` (new)

**Intent**: Precondition-rejection path (dirty-pins snapshot → `ok: false`, injected fake engine never invoked) and happy path (fake engine output → verdict from the real `verifyGeneration`).

**Contract**: no worker involved — pure function tests.

### Success Criteria:

#### Automated Verification:

- `pnpm check && pnpm lint && pnpm steiger && pnpm test`
- Full local CI gate green: `/verify`

#### Manual Verification:

- One `pnpm bench:generation` run confirms the envelope: dp1 ≤ 50, dp2 = 46
- In the running app: Generate on a clean board applies; Generate on a board with a blocking violation shows the precondition error without burning the budget

**Implementation Note**: Final phase — after automated checks, do the bench + app smoke before closing the change.

---

## Testing Strategy

### Unit Tests:

- New: `quality-bar.test.ts` (capability guard), `objective.test.ts` (tiers 2 + 4 direct), `problem.test.ts` (clique/cell-order seams), `run.test.ts` (runner pipeline).
- Existing black-box suite is the refactor gate: fuzz oracle, hard-rule matrix, boxing repros, cancel/progress — must pass with no assertion changes across Phases 2–4.

### Integration Tests:

- None added — `apply-generated.integration.test.ts` already covers persistence and is untouched.

### Manual Testing Steps:

1. Phase 1: run `pnpm bench:generation` ~5×; confirm dp2 = 46 each time (or apply the documented fallback).
2. Phase 4: in the dev app, Generate on a clean plan (applies, summary shows) and on a plan with a deliberate blocking collision (immediate precondition error).

## Performance Considerations

No runtime behavior change intended; the only performance deliverables are test-suite wall time (≤ 8 s for the generation suites) and a longer (deliberate) bench run. The `Board` extraction must not add per-call allocation in the hot path — methods close over the same Maps the closures use today.

## Migration Notes

None — no schema, API, or persisted-data changes. Import-path moves are internal to the repo and covered by `pnpm check`.

## References

- Review findings + agreed recommendation: `context/changes/generation-engine-refactor/change.md`
- Prior changes: `context/archive/2026-07-11-plan-generation/`, `context/archive/2026-07-12-generation-engine-hardening/`
- Engine: `src/entities/timetable/model/generation/engines/greedy.ts`
- Worker precondition: `src/_pages/plan-detail/model/generation/generate.worker.ts:40-44`
- Bench: `bench/generation.bench.ts`
- CI workflow (job pattern to mirror): `.github/workflows/ci.yml:31-46`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: CI Quality Bar + Tunable Engine

#### Automated

- [x] 1.1 `pnpm check` passes — 432ab06
- [x] 1.2 `pnpm lint && pnpm steiger` pass — 432ab06
- [x] 1.3 `pnpm test` green — 432ab06
- [x] 1.4 Generation suite wall time ≤ 8 s — 432ab06
- [x] 1.5 Quality-bar test proven red under disabled descent (mutation check, reverted) — 432ab06
- [x] 1.6 `bench` CI job green on this change's own run — 432ab06

#### Manual

- [x] 1.7 ~5 bench runs validate dp2 = 46 (or fallback recorded in change.md) — 432ab06
- [x] 1.8 Constructive-vs-optimum measurement recorded in fixture comment — 432ab06
- [x] 1.9 Probation/promotion protocol recorded; deploy.needs unchanged — 432ab06

### Phase 2: Extract Engine-Agnostic Pieces

#### Automated

- [x] 2.1 `pnpm check && pnpm lint && pnpm steiger && pnpm test` green
- [x] 2.2 `objective.test.ts` covers countStudentHoles week expansion + lane math

### Phase 3: Decompose the Greedy Engine

#### Automated

- [ ] 3.1 `pnpm check && pnpm lint && pnpm steiger && pnpm test` green
- [ ] 3.2 Quality-bar + fuzz tests pass unmodified (import paths aside)
- [ ] 3.3 No file in `engines/greedy/` exceeds ~300 lines

#### Manual

- [ ] 3.4 Diff spot-check: mechanical moves only

### Phase 4: Runner Seam

#### Automated

- [ ] 4.1 `pnpm check && pnpm lint && pnpm steiger && pnpm test` green
- [ ] 4.2 `/verify` full gate green

#### Manual

- [ ] 4.3 Final bench run: dp1 ≤ 50, dp2 = 46
- [ ] 4.4 App smoke: clean-board Generate applies; dirty-board Generate shows precondition error
