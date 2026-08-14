# Retire the CI generation benchmark and the orphaned client generation path — Implementation Plan

## Overview

Delete the non-blocking CI `bench` job, which has failed 26 of its 44 conclusive runs and asserts a
wall-clock-noisy property of an engine no longer used in production. Then delete the client-side
generation path that S-301 orphaned when it moved Generate onto CP-SAT, and truth-up the docs that
name either mechanism.

Nothing in scope has a production consumer. This change cannot alter application behaviour.

## Current State Analysis

**The bench job.** `ci.yml:208-224` runs `pnpm bench:generation` on every push, booting a full
Supabase stack (~3 min) to run one test: `bench/generation.bench.ts`, which drives the greedy engine
over the real seed catalog and asserts `unplaced === []` plus per-cohort slot bars. It is absent from
`deploy.needs`, so it gates nothing — it only paints runs red. Failure rate is 59% lifetime and 71%
since 2026-08-09; across the 15 most recent runs it is the *only* job that has ever failed.

The cause is structural, and `bench/generation.bench.ts:23-28` documents it: the search is
`Date.now()`-driven, so round count moves with machine load. The 2026-07-14 tuning review already
declared the bench *"not a guard"* and specified the fix (a deterministic round-count mode); it was
never built.

**The orphaned path.** S-301 (`first-verified-proposal`, merged at `1524e0c`) switched Generate from
a client-side greedy Web Worker to a server-side CP-SAT job. `use-cohort-board-state.ts:175` now calls
`useGenerationJob`; the old `useGeneratePlan` hook, its worker, and the client-side apply verb it drove
are all unreachable. The S-301 plan said so explicitly and deferred the cleanup
(`context/archive/2026-08-12-first-verified-proposal/plan.md:377-380`): *"the swap may leave
`GenerationSummaryPanel` (and anything else fed by the old `GeneratePlanControls` shape) as
unreachable UI … swept up by the separate greedy-removal cleanup change, not this slice."*

This is that change.

**Docs.** Four live foundation-doc locations still assert that greedy *"remains the working Generate
affordance"* — already false before this change — and name the bench as a greedy-retirement
precondition.

## Desired End State

- CI runs four jobs (`verify`, `integration`, `e2e`, `solver`) plus `deploy`. A red run means something
  is actually broken.
- `src/_pages/plan-detail/**` contains no generation code that is unreachable from the Generate button,
  and no import edge into `engines/greedy`.
- Every comment that cites a deleted mechanism has been re-anchored to a mechanism that still exists,
  or removed.
- `prd.md` and `roadmap.md` describe the engine situation as it actually is; `shape-notes.md` and the
  post-poc research doc carry dated annotations rather than rewritten history.

**Verification**: `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` all green, and
a CI run on the branch showing four jobs.

### Key Discoveries

- **`bench/` is three unrelated things under one name.** `bench/contract-parity.test.ts` runs in the
  *blocking* `verify` job (collected by `vitest.config.ts:27`'s `bench/**/*.test.ts` glob) and
  byte-gates the frozen wire contract. Reason per-file, never per-directory.
- **`applyGenerated` is dead code inside a live file.** `use-cohort-board-state.ts:120` defines it and
  `:181` returns it, but its only call site — `PlannerBoard.tsx:83` — destructures
  `{ dp1, dp2, history, generation }` and never takes it.
- **`GenerationSummaryPanel` is orphaned, and the codebase says so.** `PlannerBoard.tsx:320-323`:
  *"`GenerationSummaryPanel` stays in the tree unreferenced, to be removed with the rest of the greedy
  path."*
- **The cascade stops at the client wrapper.** `applyGeneratedPlacements` exists twice: the client
  wrapper (`api/placement-client.ts:52`) dies; the domain function (`api/placements.ts:112`) is live —
  `generation-delivery.ts:216` is how CP-SAT lands the board, and `apply-generated.integration.test.ts`
  covers it.
- **Two comments anchor a live build constraint to a file being deleted** —
  `src/entities/timetable/index.ts:74-82` and `src/entities/timetable/api/solver-config.ts:15-17`.
- **Zero E2E coupling.** No spec under `e2e/` drives the Generate button; all "worker" hits refer to
  Cloudflare workerd. Deleting the client path breaks no E2E test.
- **`useCollisionInspection`** (`board-inspection.ts:23-34`) is orphaned for reasons predating S-301 —
  `PlannerBoard.tsx:105` manages inspection state with its own `useState`.

## What We're NOT Doing

- **Not deleting the greedy engine** (`src/entities/timetable/model/generation/engines/greedy/**`,
  ~2,270 lines with its tests and fixtures).
  That is roadmap **S-309**, explicitly one-way and gated on S-305–S-308. Its barrel exports at
  `src/entities/timetable/index.ts:33` and its unit tests stay.
- **Not touching the greedy-driven `bench/` experiments** (`generation.experiment.ts`,
  `export-snapshot.experiment.ts`). The latter is the sole producer of
  `services/solver/tests/fixtures/seed-plan-a.json`, whose objective tuple is pinned as
  `SEED_OBJECTIVE` in `test_objective.py:24` — the 10/10 parity gate. Re-anchoring that baseline is
  S-308's job.
- **Not removing the `applyGeneratedPlacements` Astro Action** (`placement-actions.ts:19`). It loses
  its last client caller, but removing a registered action is an API-surface change, and S-306
  (*"changed source yields a new plan reviewed on the comparison page"*) plausibly wants a client-side
  apply path again. Flagged, not deleted.
- **Not re-scoping S-309's status or prerequisites.** Correcting stale claims is in scope; re-deciding
  a gated roadmap slice is not.
- **Not adding replacement test coverage.** The bench asserted noise, so there is no coverage to
  preserve. E2E has no Generate coverage today and this change does not add it — recorded as a finding.
- **Not rewriting archived docs** under `context/archive/**`. Historical record.

## Implementation Approach

Four phases, ordered so the highest-value/lowest-risk work lands first and each phase is
independently revertable.

Phase 1 is pure CI/tooling deletion — it stops CI lying immediately, so if anything later stalls, the
actual problem is already solved. Phase 2 is the code deletion, shipped **together with** the comment
re-anchoring it falsifies, so the tree is never in a state where a comment asserts something untrue.
Phase 3 isolates the one deletion whose cause is unrelated, keeping its revert independent. Phase 4 is
docs only.

Every phase is verified by the same gate: `pnpm check` is the type authority (per `lessons.md`,
build/test/lint passing is *no evidence* of type safety), `pnpm lint`'s unused-import rules catch
incomplete excisions, and `pnpm build` catches the barrel trap described below.

## Critical Implementation Details

**The barrel client-safety trap.** `src/entities/timetable/index.ts:74-82` explains that
`api/solver-config.ts` is deliberately *not* re-exported because the barrel "is pulled into the Web
Worker bundle by `generate.worker.ts`", and `astro:env/server` throws `[ServerOnlyModule]` at load
time in a client build. Deleting the worker makes that *reason* false — **the rule still holds**,
because `PlannerBoard.tsx` is a `client:load` island (`PlanDetailPage.astro:37`) and ~20 client
components import that barrel. Re-anchor both comments (here and `solver-config.ts:15-17`) to the
islands. A reader who concludes "the worker is gone, so the barrel can be server-safe now" breaks
`pnpm build` outright.

**Two similarly-named symbols, one live.** `applyGeneratedPlacements` is both a dead client wrapper
(`placement-client.ts:52`) and a live domain function (`placements.ts:112`). Separately,
`applyGeneratedRegion` (`reconcile-exec.ts:30,86`, `rpcs.ts`, `use-reconcile-executor.ts:117`) is a
*different*, live symbol on the history/reconcile path. Deleting by name match will break the CP-SAT
delivery path or undo/redo.

**Excision order inside `use-cohort-board-state.ts`.** Remove the `applyGenerated` function
(`:113-150`, including its `const bases` line and the docblock above it) and its return at `:181`
first, then prune per this verified forecast (all uses checked at plan-review time):

- **Fully unused after the excision** — delete the imports: `applyGeneratedPlacements` (`:14`), the
  three `apply-generated` builders (`:15`), `ApplyGeneratedResult` (`:16`), `GeneratedPlacement` (`:7`),
  `assembleGeneratorSnapshot` (`:3`), `verifyGeneration` (from `:11`).
- **The `:11` import line survives** — it also carries `deriveGenerationDeficits` (used `:158,:163`)
  and `CellCollisions` (used `:195`); remove only `verifyGeneration` from it.
- **`toSnapshotInput` is a local helper, not an import** (`:203-210`). It becomes dead too — delete it,
  which cascades three more imports: `CohortSnapshotInput` (`:5`), `GroupingCourse` (`:12`),
  `LocalParkedBundle` (`:13`). `LocalPlacement` (`:8`) **stays** — used by `indexFromPlacements`
  (`:244`).

`pnpm lint` is the gate confirming the forecast.

---

## Phase 1: Retire the CI generation benchmark

### Overview

Delete the `bench` job and everything that exists only to serve it, plus the comments elsewhere that
justify their own existence by citing it.

### Changes Required:

#### 1. The CI workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Remove the `bench` job entirely, and the comment block that scopes `workflow_dispatch` to
bench probation. Keep the bare `workflow_dispatch:` trigger — manual re-run is independently useful.

**Contract**: Delete lines `208-224` (the `bench:` job) and the comment at `8-10`. Line 11
(`workflow_dispatch:`) survives without a comment. `deploy.needs` is unchanged — `bench` was never in
it.

#### 2. The script and its vitest config

**File**: `package.json`, `vitest.bench.config.ts`

**Intent**: Remove the `bench:generation` script and the config that exists solely for it.

**Contract**: Delete `package.json:19`. Delete `vitest.bench.config.ts` whole — its
`include: ["bench/**/*.bench.ts"]` matches only the file removed below, and no other config
references it. The sibling configs (`vitest.config.ts`, `.integration.`, `.analyze.`, `.experiment.`)
are untouched.

#### 3. The benchmark itself

**File**: `bench/generation.bench.ts`

**Intent**: Delete. It is the repo's only `*.bench.ts`, imported by nothing.

**Contract**: Whole-file deletion. Confirm no sibling under `bench/` imports it (repo-wide grep for
`../bench`/`@/bench` returns zero). **Do not touch** `contract-parity.test.ts`, `read-json.ts`,
`fixture-courses*`, or `generate-contract-goldens.experiment.ts`.

#### 4. Seed-determinism comments that cite the bench

**File**: `scripts/lib/seed-id.mjs`, `scripts/lib/catalog-transcode.mjs`, `scripts/lib/catalog-transcode.d.mts`

**Intent**: These justify content-addressed seed ids by "so `bench:generation`'s by-id lookup resolves
in CI" (`seed-id.mjs:8`, `catalog-transcode.mjs:372`, `catalog-transcode.d.mts:97`). The *requirement*
survives — `src/test/seed-transcode-identity.test.ts` pins regeneration identity independently — but
the cited consumer is gone. Re-anchor the rationale to that test.

**Contract**: Comment-only edits. No behaviour change.

#### 5. Stale comment sweep — remaining citations of the deleted bench

**File**: `src/entities/timetable/model/generation/generation-smoke.test.ts`, `src/entities/timetable/model/generation/engines/greedy/search.test.ts`, `vitest.experiment.config.ts`, `vitest.analyze.config.ts`

**Intent**: Four comments cite the deleted mechanism and would either fail criterion 1.2 or survive as
false statements: `generation-smoke.test.ts:9` ("the on-demand benchmark (`pnpm bench:generation`), not
here") and `search.test.ts:11` ("`pnpm bench:generation` is the only other guard, it is not in CI…")
name the deleted script; `vitest.experiment.config.ts:10` and `vitest.analyze.config.ts:9` say
"mirroring `vitest.bench.config.ts`". Reword each to stand without the deleted mechanism. Editing the
two greedy test files' comments does not violate D6 — their code and assertions are untouched.

**Contract**: Comment-only edits. No behaviour change.

### Success Criteria:

#### Automated Verification:

- [x] No `bench` job in the workflow: `grep -c "bench" .github/workflows/ci.yml` returns 0
- [x] No live reference to the script: `grep -rn "bench:generation" --exclude-dir=node_modules --exclude-dir=context .` returns nothing
- [x] `vitest.bench.config.ts` and `bench/generation.bench.ts` no longer exist
- [x] Unit suite passes (proves the surviving `bench/**/*.test.ts` files were not caught): `pnpm test`
- [x] Type check passes: `pnpm check`
- [x] Lint passes: `pnpm lint`
- [x] Build passes: `pnpm build`

#### Manual Verification:

- [ ] A CI run on the branch shows four jobs (`verify`, `integration`, `e2e`, `solver`) and no benchmark

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Delete the orphaned client generation path

### Overview

Remove everything S-301 left unreachable, and re-anchor every comment that names a deleted mechanism —
in the same phase, so the tree is never internally inconsistent.

### Changes Required:

#### 1. The Web Worker path

**File**: `src/_pages/plan-detail/model/generation/use-generate-plan.ts`, `use-generate-plan.test.tsx`, `generate.worker.ts`, `worker-protocol.ts`, `worker-protocol.test.ts`

**Intent**: Delete all five. `useGeneratePlan` has no production consumer; `generate.worker.ts` is
loaded only by it; `worker-protocol.ts` serves only those two.

**Contract**: Whole-file deletions (502 lines). `ApplyGeneratedResult` (`use-generate-plan.ts:30`) and
`GenerationSummary` are deleted, not rehomed — their only consumers are removed in this same phase.
No build config references the worker (`astro.config.mjs` and `vitest.config.ts` are clean).

#### 2. The orphaned review panel

**File**: `src/_pages/plan-detail/ui/chrome/GenerationSummaryPanel.tsx`, `GenerationSummaryPanel.test.tsx`, `chrome/index.ts`, `ui/PlannerBoard.tsx`

**Intent**: Delete the panel and its test, drop the barrel export, and remove the placeholder comment
that explains why it was being kept.

**Contract**: Delete `chrome/index.ts:11`. Remove the comment block at `PlannerBoard.tsx:320-323`
(the `GenerationStatusStrip` render at `:324` stays). The panel's `GenerationSummary` type import
(`GenerationSummaryPanel.tsx:5`) is why deleting it and `use-generate-plan.ts` must happen together.

#### 3. The dead apply verb

**File**: `src/_pages/plan-detail/model/use-cohort-board-state.ts`

**Intent**: Excise the `applyGenerated` function — unreachable since `PlannerBoard.tsx:83` stopped
destructuring it — and prune the imports it alone kept alive.

**Contract**: Remove the docblock + `const bases` + function at `:113-150` and the `applyGenerated,`
entry in the returned object at `:181`. Then prune imports per the ordering note in Critical
Implementation Details. `useGenerationJob` (`:17,175`) and `deriveGenerationDeficits` stay — the
latter feeds `disabledReason`.

#### 4. The apply builders and the client wrapper

**File**: `src/_pages/plan-detail/model/generation/apply-generated.ts`, `apply-generated.test.ts`, `src/_pages/plan-detail/api/placement-client.ts`

**Intent**: Delete the builders whose only caller was the excised verb, and the client action wrapper
whose only caller was those builders' caller.

**Contract**: Whole-file deletion for the two `apply-generated.*` files. In `placement-client.ts`,
remove **only** the `applyGeneratedPlacements` function (`:52-65`) — the file's other exports are live.
**Do not** touch `api/placements.ts:112` (live domain function, used by `generation-delivery.ts:216`),
`placement-actions.ts:19` (out of scope, see What We're NOT Doing), or anything named
`applyGeneratedRegion`.

#### 5. Comments that name deleted mechanisms

**File**: `src/entities/timetable/index.ts`, `src/entities/timetable/api/solver-config.ts`, `src/entities/timetable/model/generation/run.ts`, `src/entities/timetable/model/generation/types.ts`, `src/_pages/plan-detail/model/generation/use-generation-job.ts`, `bench/generation.experiment.ts`

**Intent**: Re-anchor each comment to a mechanism that still exists. The rules they encode all survive;
only their cited causes die.

**Contract**:
- `index.ts:74-82` and `solver-config.ts:15-17` — re-anchor the client-safety rule from "pulled into
  the Web Worker bundle by `generate.worker.ts`" to the `client:load` islands that import the barrel
  (`PlannerBoard.tsx` via `PlanDetailPage.astro:37`). **The rule must not weaken** — see Critical
  Implementation Details.
- `run.ts:5-6` — "the Web Worker today" is now false; the only caller is
  `generation-delivery.ts:132`. `run.ts` itself stays live.
- `types.ts:7-12` — the structured-clone rationale for "a snapshot crosses a Web Worker boundary" now
  applies to a JSON/HTTP boundary (`dispatchSolveJob`). Keep the shape constraint, restate the reason.
- `use-generation-job.ts:10` — the live CP-SAT hook's docblock names "`useGeneratePlan` behind the
  Generate button" as what it replaced. Reword so it doesn't cite the deleted hook — criterion 2.1's
  grep must come up empty.
- `bench/generation.experiment.ts:39` — points at `worker-protocol.ts` by path for
  `GENERATION_BUDGET_MS`. The file stays (tier 4, out of scope); its comment must stop citing a
  deleted path.

### Success Criteria:

#### Automated Verification:

- [ ] Zero references to the deleted symbols: `grep -rn "useGeneratePlan\|generate\.worker\|worker-protocol\|GenerationSummaryPanel\|ApplyGeneratedResult" src/` returns nothing
- [ ] Zero `src/_pages/**` import edges into greedy: `grep -rn "engines/greedy\|generatePlanGreedy\|createGreedyEngine" src/_pages/` returns nothing
- [ ] Type check passes — the authority on the excision: `pnpm check`
- [ ] Lint passes, proving no orphaned imports survive: `pnpm lint`
- [ ] FSD boundaries hold: `pnpm steiger`
- [ ] Unit + DOM suites pass: `pnpm test`
- [ ] Build passes — the gate on the barrel client-safety trap: `pnpm build`

#### Manual Verification:

- [ ] The plan-detail board page renders and the Generate button is present (app + Supabase only; no solver needed)

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 3: Sweep the unrelated `useCollisionInspection` orphan

### Overview

Isolated in its own phase because its cause predates S-301 — if it turns out to be intentionally-kept
API, this reverts without touching the generation cleanup.

### Changes Required:

#### 1. The orphaned hook

**File**: `src/_pages/plan-detail/ui/chrome/board-inspection.ts`, `chrome/index.ts`

**Intent**: Remove `useCollisionInspection`, which has no call site — `PlannerBoard.tsx:105` owns
inspection state with its own `useState`. Keep the two pure selectors, which are live in both
`PlannerBoard.tsx:393,397` and `TeacherPlanPage.tsx:170`.

**Contract**: Delete `board-inspection.ts:16-34` (the explanatory comment plus the function) and drop
`useCollisionInspection` from the export list at `chrome/index.ts:28`, keeping `inspectedViolations`
and `inspectedWeeks`. The `useState` import (`:1`) becomes unused; `cellKey` and
`CollisionInspectionTarget` stay (used by the selectors). Update the file docblock at `:10-15`, which
describes the file as "state and its two pure selectors" — only the selectors remain.

### Success Criteria:

#### Automated Verification:

- [ ] Symbol is gone: `grep -rn "useCollisionInspection" src/` returns nothing
- [ ] Type check passes: `pnpm check`
- [ ] Lint passes (catches the now-unused `useState` import): `pnpm lint`
- [ ] FSD boundaries hold: `pnpm steiger`
- [ ] Tests pass: `pnpm test`
- [ ] Build passes: `pnpm build`

#### Manual Verification:

- [ ] The collision-details dialog still opens from a colliding cell and closes correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 4: Truth-up the documentation

### Overview

Apply one rule: **normative docs get corrected; dated artifacts get annotated.**

### Changes Required:

#### 1. The PRD

**File**: `context/foundation/prd.md`

**Intent**: FR-314 (`:384`) asserts greedy *"remains the working Generate affordance, untouched, until
the calibration gate passes and the proposal flow ships"* — false since S-301 — and names a bench that
no longer exists. The Engine-transition-compatibility note (`:427`) repeats both. Correct both to
describe reality: CP-SAT is the default Generate path as of S-301, the Web Worker path is deleted, and
the retirement precondition is a CP-SAT regression baseline rather than a re-anchored bench.

**Contract**: Prose edits to the FR-314 bullet and the Engine-transition-compatibility bullet. Preserve
the `[modified]` marker, the `Priority: must-have` line, and the `> Socrates:` annotations. **Do not**
change S-309's gate or prerequisites. **Do not** touch `:247`, which refers to the bench *import*
experiment — a file that survives.

#### 2. The roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Drop `bench` from the CI-shape inventory (`:66`), correct S-309's outcome (`:226`),
half of which has already shipped — Generate defaults to CP-SAT, and this change deletes the Web Worker
path — leaving S-309 as the greedy-engine deletion, and correct the stale clause in S-309's Risk line
(`:233`): *"until this slice, greedy remains the working Generate affordance untouched"* has been false
since S-301.

**Contract**: Prose edits to those three lines. In `:233`, correct only the stale clause — the rest of
the Risk rationale (one-way deletion, double gate, slipping-retirement risk) stands. The slice table row
at `:42` keeps its `proposed` status and its `S-305, S-306, S-307, S-308` prerequisites.

#### 3. Dated artifacts

**File**: `context/foundation/shape-notes.md`, `context/changes/post-poc-cp-sat-refactoring-plan/research.md`

**Intent**: Both carry the same now-false claims (`shape-notes.md:387,549`; `research.md:337,382`), but
both are dated inputs — shape-notes is what produced the PRD, and the research doc is a timestamped
snapshot for a different, still-live change. Annotate rather than rewrite, so the record of what was
shaped and found stays intact while the next reader is warned.

**Contract**: A single dated note near the top of each, pointing at this change and at the corrected
PRD/roadmap. Bodies unchanged. **Do not** touch `shape-notes.md:455` (bench *import* experiment).

#### 4. Record the E2E gap

**File**: `context/changes/clean-up-bench-generation/change.md`

**Intent**: The sweep found no E2E coverage of the Generate button at all. This change deliberately
does not add it; record it so it is a known gap rather than an accidental one.

**Contract**: A note under `## Notes`.

### Success Criteria:

#### Automated Verification:

- [ ] Corrected docs no longer claim greedy is the working affordance: `grep -n "remains the working Generate affordance" context/foundation/prd.md context/foundation/roadmap.md` returns nothing (`shape-notes.md` keeps the phrase by design, behind its dated annotation)
- [ ] Corrected docs no longer name the deleted bench as a precondition: `grep -n "bench re-anchored" context/foundation/prd.md context/foundation/roadmap.md` returns nothing (same `shape-notes.md` carve-out)
- [ ] Archived docs untouched: `git diff --name-only` shows no path under `context/archive/`

#### Manual Verification:

- [ ] FR-314 reads as an accurate statement of the current engine situation
- [ ] S-309's remaining scope (delete the greedy engine) is unambiguous to whoever plans it

---

## Testing Strategy

### Unit Tests:

No new tests. Every test deleted (`use-generate-plan.test.tsx`, `worker-protocol.test.ts`,
`GenerationSummaryPanel.test.tsx`, `apply-generated.test.ts`) covers code being deleted in the same
phase. The surviving suite is the regression guard: if `pnpm test` goes red, something still-live was
caught in the sweep.

The three `bench/**/*.test.ts` files collected into `pnpm test` by `vitest.config.ts:27` —
`contract-parity.test.ts`, `auto-park.test.ts`, `fixture-courses.test.ts` — are the specific canaries
for Phase 1.

### Integration Tests:

None added or changed. `apply-generated.integration.test.ts` must stay green — it covers the *domain*
`applyGeneratedPlacements`, which is live on the CP-SAT delivery path and is deliberately not touched.

### Manual Testing Steps:

1. After Phase 1: push the branch, confirm the CI run shows four jobs and no benchmark.
2. After Phase 2: open a plan-detail page, confirm the board renders and the Generate button is present.
3. After Phase 3: open the collision-details dialog from a colliding cell; confirm it opens and closes.

## Performance Considerations

Removes ~3 minutes of runner time and one Supabase stack boot per push. No runtime performance
implications — nothing deleted executes in production. The `<200ms` drag-drop validation budget is
untouched (`entities/timetable`'s constraint core is not modified).

## Migration Notes

None. No schema changes, no data migration, no deploy-order constraint. Every phase is a plain revert
if needed, and Phase 3 was isolated specifically to keep its revert independent.

## References

- Research: `context/changes/clean-up-bench-generation/research.md`
- Decisions D1–D6: `context/changes/clean-up-bench-generation/change.md`
- S-301's deferral of this cleanup: `context/archive/2026-08-12-first-verified-proposal/plan.md:377-380`
- The bench's own noise docblock: `bench/generation.bench.ts:23-28`
- The bench declared "not a guard": `context/archive/2026-07-12-generation-quality-tuning/change.md:154-156`
- Applicable lesson: `context/foundation/lessons.md` — *"A convention that cites a code mechanism is coupled to it"* and *"Green build/test/lint ≠ type-safe"*

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Retire the CI generation benchmark

#### Automated

- [x] 1.1 No `bench` job in the workflow — 58b5b0c
- [x] 1.2 No live reference to `bench:generation` — 58b5b0c
- [x] 1.3 `vitest.bench.config.ts` and `bench/generation.bench.ts` no longer exist — 58b5b0c
- [x] 1.4 Unit suite passes: `pnpm test` — 58b5b0c
- [x] 1.5 Type check passes: `pnpm check` — 58b5b0c
- [x] 1.6 Lint passes: `pnpm lint` — 58b5b0c
- [x] 1.7 Build passes: `pnpm build` — 58b5b0c

#### Manual

- [ ] 1.8 CI run on the branch shows four jobs and no benchmark

### Phase 2: Delete the orphaned client generation path

#### Automated

- [ ] 2.1 Zero references to the deleted symbols
- [ ] 2.2 Zero `src/_pages/**` import edges into greedy
- [ ] 2.3 Type check passes: `pnpm check`
- [ ] 2.4 Lint passes (no orphaned imports): `pnpm lint`
- [ ] 2.5 FSD boundaries hold: `pnpm steiger`
- [ ] 2.6 Unit + DOM suites pass: `pnpm test`
- [ ] 2.7 Build passes (barrel client-safety gate): `pnpm build`

#### Manual

- [ ] 2.8 Board page renders and the Generate button is present

### Phase 3: Sweep the unrelated `useCollisionInspection` orphan

#### Automated

- [ ] 3.1 `useCollisionInspection` is gone from `src/`
- [ ] 3.2 Type check passes: `pnpm check`
- [ ] 3.3 Lint passes (unused `useState` import caught): `pnpm lint`
- [ ] 3.4 FSD boundaries hold: `pnpm steiger`
- [ ] 3.5 Tests pass: `pnpm test`
- [ ] 3.6 Build passes: `pnpm build`

#### Manual

- [ ] 3.7 Collision-details dialog opens and closes correctly

### Phase 4: Truth-up the documentation

#### Automated

- [ ] 4.1 Corrected docs no longer claim greedy is the working affordance
- [ ] 4.2 Corrected docs no longer name the deleted bench as a precondition
- [ ] 4.3 Archived docs untouched

#### Manual

- [ ] 4.4 FR-314 reads as an accurate statement of the current engine situation
- [ ] 4.5 S-309's remaining scope is unambiguous
