# First Verified Proposal (S-301) Implementation Plan

## Overview

Implement the north-star slice: an author clicks **Generate** on a plan and receives, minutes later,
a complete, oracle-verified CP-SAT board on a proposal plan. The app clones the plan as the proposal
target, assembles + hashes the snapshot **from the source**, records a durable `generation_jobs` row
(one active job per plan), and dispatches to the solver with the shipped **clean-mode default**
(pinned-floor semantics). On revisit or manual refresh, the app verifies the result **server-side**
against the solved snapshot, translates `courseId` into the clone's id space via the natural key, and
applies the board onto the proposal clone through the atomic RPC.

**FR-313 honesty note (say it out loud):** the Action-triggered result read satisfies FR-313's
*location* requirement (the oracle runs server-side in the delivery pipeline) but **not** its
*rationale* ("without a browser open") — headless delivery is S-303 (polling) and S-306 (drift-decided
delivery). This plan does not pretend otherwise.

## Current State Analysis

The research (`research.md`) drove the entire flow end to end on the real stack before this plan was
written — clone → source-side assembly → hash → enqueue → dispatch → 11¼-min real solve → server-side
oracle → id translation → apply onto clone, **all assertions green**. What exists and what's missing:

- **Built and tested, zero production call sites:** `createSolverTransport`
  (`src/entities/timetable/api/solver-transport.ts:52`) and `getSolverTransport()`
  (`src/entities/timetable/api/solver-config.ts:23`). Wiring them is this slice's first job.
- **Already server-side today:** `verifyGeneration` (pure, ~1.7 ms) runs in workerd via
  `src/_pages/plan-comparison/api/load-comparison.ts:125`. The oracle "relocation" is a new call
  site, not a runtime capability.
- **Already done:** "settle unsaved board state" — every board mutation persists per gesture; the
  only unsettled notion is the optimistic in-flight window already exposed as `busy` and already
  gating Generate (`GenerateButton.tsx:42`).
- **Missing entirely:** clean mode in the engine, the Python-side snapshot-hash binding, the enqueue
  and delivery Actions, the result-read trigger, and any job UI.
- **Bench-only, needs promotion:** `loadPins`/`toSnapshot` (`bench/experiment-harness.ts:41,75`),
  `autoParkPhantomCourses` (`bench/auto-park.ts:26`).
- **FSD constraint discovered during planning:** the enqueue path (in `_pages/plan-detail/`) needs
  `loadPlanAnalysis` (in `_pages/plan-comparison/api/`) and `clonePlan` (in
  `_pages/plans-list/api/`). Cross-`_pages` imports break steiger (zero exist today), so **both
  relocate to `src/entities/timetable/api/`**, following the `solver-config.ts` precedent.
- **Schema is ready:** `generation_jobs` already carries `proposal_plan_id`, `delivered_plan_id`,
  `error`, `stages`, `policy jsonb not null`, the six-status CHECK, and the partial unique index
  enforcing one active job per plan. `authenticated` holds full RLS access, so the app can write
  delivery state. No new columns needed.

## Desired End State

An author on the plan-detail page clicks **Generate** (the existing button, now dispatching CP-SAT
instead of the greedy worker). A status strip appears: *"Generating… started \<time\>"* with a
Refresh affordance. When the author revisits (or refreshes) after the solve completes, the app
verifies and applies the board, and the strip shows *"Proposal ready — open"* linking to the proposal
plan, with honest clean labelling (*clean*, or *"clean — N pinned hours remain on soft cells"*, or
the non-clean fallback label). Failures show the diagnostic and the orphan clone is removed. A
tiny-fixture integration test proves the whole chain in CI.

### Key Discoveries (from research.md, all verified live):

- The pinned floor makes clean mode satisfiable whenever it can be: constrain `softHits == floor`,
  not `== 0` (`change.md` decision 1); floor is Σ over pin **rows** of the count of that course's
  soft co-teachers at the pinned cell — per row × per soft co-teacher (`objective.py:176-186`), NOT
  a pins × soft-cells set intersection (that undercounts co-taught and week-split pins).
- `parity()`/`evaluate_board()` take no `SolveConfig`, so a config-gated flag is invisible to the
  10/10 parity gate by construction (`solve.py:109-128`).
- `GeneratedPlacement` carries exactly one id (`courseId`); the natural key
  `(cohort, name, level, group_index)` is unique 84/84 and matches 84/84 across a clone.
- The claim CAS (`services/solver/src/cpsat_service/supabase.py:95-114`) can read `snapshot_hash` in
  the same round trip by widening its projection — the role already holds table-wide SELECT.
- Narrow poll projections are mandatory: `snapshot` is ~100–124 KB TOASTed; `result` ~35 KB.

## What We're NOT Doing

- **No polling loop / headless delivery** — on-visit check + manual refresh only (S-303, S-306).
- **No policy picker** — clean default only; `policy` column gets a minimal audit descriptor (S-307).
- **No job cancel/stop** — the greedy button's "Stop & keep" does not carry over (S-305).
- **No wedged-`running` reclaim** — stale-heartbeat recovery is S-304.
- **No container deploy** — runs against the native/local solver; deploy lane is S-302 (parallel).
- **No drift-decided delivery to the source** — S-301 always applies to the clone; FR-307's drift
  check and auto-apply are S-306.
- **No greedy-engine removal** — the greedy worker/hook code stays in the repo; it only loses its UI
  entry point. Removal is separate cleanup. (The roadmap's "greedy stays untouched" line is stale —
  recorded in memory and acknowledged here.)
- **No per-job solver credential** — the RLS narrowing is the achievable status-window form.
- **No wire-contract change** — no schema edit, no `formatVersion` bump, no golden regeneration.

## Implementation Approach

Five phases, each independently verifiable: engine work first (self-contained, its own toolchain),
then the DB migration, then the app-side enqueue path, then delivery + UI, then the end-to-end proof
and docs truth-up. All design forks were settled in `change.md` (five recorded decisions) and the
planning session (seven confirmed choices): on-visit trigger, Generate-button engine swap,
status-window RLS narrowing, phantom auto-park promotion, minimal status strip, orphan-clone
deletion, tiny-fixture E2E test.

## Critical Implementation Details

- **Clean constraint placement.** The `softHits == floor` constraint goes in `solve_complete` at the
  feasibility stage (`solve.py:196-200`), **never** in `build_model` and never after Mode A —
  otherwise a later ladder stage returning neither OPTIMAL nor FEASIBLE leaves the pre-clean
  incumbent to be returned behind a green `succeeded` (`change.md` decision 3.1). **Mechanism:** the
  tier aux-vars do not exist at the feasibility stage (deliberately — `solve.py:193-195`;
  `build_objective` runs only after SAT), so the constraint is a linear expression built directly
  over `bundle.x` + the pin constants by a small helper reusing `_soft_index` and the
  per-co-teacher weighting — no early `build_objective` call. Once added and SAT, the constraint
  **stays in the bundle through the entire ladder** (CP-SAT can't remove constraints, and it must
  persist anyway: tiers 2–4 hardening could otherwise push `softHits` above the floor); tier-5
  minimization then lands on the floor trivially.
- **Fallback, not inference.** Clean-infeasibility is handled by construction: compute the floor
  up front, constrain to it, and if the feasibility solve is INFEASIBLE *with* the constraint,
  **rebuild the model from the dump without it** (constraints can't be dropped from a CP-SAT model;
  `build_model` is cheap — `parity()` already rebuilds per call) and re-run the feasibility solve
  once, then continue the ladder normally (labelled downstream, never refused).
  The existing hard-rule infeasibility path stays truthful because the clean constraint can never be
  the reported cause.
- **No new cleanliness field anywhere.** The app derives the label: `floor` recomputed app-side from
  the job's stored snapshot (per pin row × per soft co-teacher, pure TS helper — the same formula
  as the engine's floor), `achieved` = tier-5
  `StageReport.best` from `generation_jobs.stages`. `achieved == 0` → clean; `achieved == floor > 0`
  → "clean — N pinned hours remain on soft cells"; `achieved > floor` → the fallback label.
- **Enqueue ordering.** Assemble + hash first (pure reads, no side effects) → clone → insert the job
  row (`23505` → delete the just-made clone, translate to "a generation is already running for this
  plan") → dispatch (non-202/transport failure → mark job `failed` with `error`, delete clone,
  surface the error). Never leave a `queued` row that was never dispatched.
- **Barrel client-safety.** Any module importing `astro:env/server` — or composing one that does
  (the enqueue path pulls in `solver-config.ts`) — stays off the barrel and is imported at its own
  path: the barrel is pulled into the greedy Web Worker bundle and `astro:env/server` throws at load
  time. That is the actual `solver-config.ts` precedent — the barrel already exports
  `api/solver-transport` (`index.ts:80`), which is env-free; leave that export alone. The pure
  `auto-park` transform may be barrel-exported; the new env-free loaders may be too, but own-path
  imports are the safe default for api modules.
- **Delivery idempotency.** The delivered marker is a CAS: `update … set delivered_plan_id = …
  where id = <job> and delivered_plan_id is null` (with a returning check), so two tabs firing the
  on-visit check cannot double-apply. Check the marker before loading the heavy columns.
- **Narrow projections.** The status read selects only
  `id,status,proposal_plan_id,delivered_plan_id,stages,error,created_at,finished_at`; `snapshot` and
  `result` are fetched in a second query only when `succeeded` and undelivered.
- **Golden parity discipline.** `uv run pytest` green in CI does **not** prove the golden parity
  test ran — it is `skipif`-gated on the dump's presence. Run it locally before claiming Phase 1
  green (`change.md` decision 4).
- **Local DB housekeeping.** Run `pnpm exec supabase db reset` before Phase 2 (live policy name has
  drifted from the migration), and write the policy drop as `drop policy if exists` for **both**
  names (`Solver reads any job`, `Solver reads its jobs`).

---

## Phase 1: Engine — clean mode + snapshot-hash binding

### Overview

All solver-side work: the clean-mode flag with pinned-floor semantics and fallback, the runner
requesting it as the shipped default, the Python-side canonical digest and post-claim hash binding,
the cross-language hash parity assertion, and the two stale comments.

### Changes Required:

#### 1. `SolveConfig.clean_mode` + pinned-floor constraint

**File**: `services/solver/src/cpsat_engine/solve.py`

**Intent**: Add a defaulted-off `clean_mode: bool = False` field to `SolveConfig` (`:31-41`), read
only inside `solve_complete`. When set: compute the pinned floor as Σ over pin rows of the count of
that course's `teacher_keys` soft at the pinned `(day, period)` — exactly mirroring
`_tier_soft_hits`'s per-soft-co-teacher weighting (`objective.py:181-183`) applied to the per-row
pin constants (`objective.py:107-110`): a co-taught pin with N soft co-teachers counts N, and
week-split pin rows of the same course/cell count once each (no dedup by cell). Add a hard
`softHits == floor` constraint at the feasibility solve (`:196-200`) as a linear expression built
directly over `bundle.x` + the pin constants (small helper reusing `_soft_index` + the
per-co-teacher weights — the tier aux-vars don't exist pre-SAT and are not needed). On INFEASIBLE
with the constraint, rebuild the model from the dump without it and re-run feasibility once (the
labelled fallback — CP-SAT constraints can't be removed; `build_model` is cheap). In the clean
case the constraint persists through the ladder unchanged — required, or tiers 2–4 hardening
could push `softHits` back above the floor.

**Contract**: `SolveConfig` gains one keyword field; `parity()` and `evaluate_board()` signatures
are untouched, keeping the change invisible to the 10/10 objective-parity gate by construction. The
floor computation must agree exactly with how pinned rows enter tier 5, or the constraint is
unsatisfiable when it shouldn't be.

#### 2. Runner requests clean mode + hash binding

**File**: `services/solver/src/cpsat_service/runner.py`, `services/solver/src/cpsat_service/supabase.py`

**Intent**: The runner passes `clean_mode=True` in the `SolveConfig` at its single `solve_complete`
call (`runner.py:144`) — clean is the shipped default, solver-side, no contract change. Widen the
claim CAS projection (`supabase.py:95-114`) to `select=id,snapshot_hash`; after claim, digest the
canonical form of the request body's snapshot (`hashlib.sha256` over `canonical_snapshot_json`,
`wire.py:51-53`) and compare against the row's `snapshot_hash`. On mismatch: write `failed` with a
diagnostic `error` naming the hash mismatch and do not solve (the row is already `running`; RLS
forbids returning to `queued`).

**Contract**: The digest's output format (hex encoding, any prefix) must byte-match TS
`computeSnapshotHash` (`src/entities/timetable/model/generation/wire.ts:105-108`) — that agreement
is pinned by the parity assertion below, not assumed.

#### 3. Cross-language hash parity assertion

**File**: `services/solver/tests/test_contract.py`, `bench/contract-parity.test.ts`

**Intent**: Both byte-gate suites assert the same recorded hash for the golden fixture snapshot —
Python's new digest and TS's `computeSnapshotHash` must agree byte-for-byte, gated bilaterally like
every other contract surface.

**Contract**: One recorded hash constant per golden fixture, asserted in both suites in the same
commit.

#### 4. Tests

**File**: `services/solver/tests/` (engine + service suites)

**Intent**: (a) clean mode drives `softHits` to 0 on a snapshot whose unconstrained optimum would
not (use the `b.soft(...)` builder, `tests/builders.py:49-50`); (b) pin-on-soft-cell succeeds with
`softHits == floor` — explicitly asserting the outcome is **not** "infeasible under the hard rules";
(c) the fallback: a floor-infeasible snapshot still returns a complete board (constraint dropped);
(d) the runner's recorded `SolveConfig` carries `clean_mode=True` (`tests/test_service.py`); (e) the
hash binding: mismatched `snapshot_hash` → `failed` with diagnostic, no solve; matching → proceeds;
(f) floor arithmetic: a co-taught pin (2 soft co-teachers) counts 2 and a week-split pin pair counts
2 — each solves clean at its exact floor, no fallback triggered.

**Contract**: All fast micro-tests; no golden-dump dependency for the new tests.

#### 5. Stale comments

**File**: `services/solver/src/cpsat_engine/schema.py:76`, `contracts/README.md`

**Intent**: Correct the soft-severity prose — "a tier-5 objective term, **never a constraint**"
becomes false with clean mode. Same diff as the mechanism change (lessons.md:
prose-coupled-to-mechanism drift).

**Contract**: Comment-only; no schema or canonical-form change (contracts/ goldens untouched).

### Success Criteria:

#### Automated Verification:

- Solver suite passes: `mise run solver:test` (from repo root) / `uv run pytest`
- Strict types + lint: `mise run solver:check` (`ruff check` + `mypy --strict`)
- Objective-parity suite stays exactly 10/10 (part of pytest)
- Golden parity test runs **locally** (skipif-gated — confirm it executed, not just green CI)
- TS contract suite green: `pnpm test` (includes `bench/contract-parity.test.ts`)

#### Manual Verification:

- Clean solve on a real dump: OPTIMAL, complete board, `softHits = 0` (mirrors research measurement)

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: DB — RLS status-window narrowing

### Overview

Narrow the solver role's SELECT to active rows and make the migration prose truthful; pin the policy
posture in the integration suite so name/predicate drift can't recur silently.

### Changes Required:

#### 1. Narrowing migration

**File**: `supabase/migrations/<new>_solver_select_status_window.sql`

**Intent**: Replace the solver SELECT policy with `using (status in ('queued','running'))` — every
terminal job's `snapshot`, `policy`, and `result` leave the role's reach; combined with the partial
unique index, the readable set collapses to ≤1 row per plan. Rewrite the stale
`20260810200931_solver_job_writer_role.sql:75-88`-era promise (per-dispatch binding is not
expressible with one shared machine credential; this window is the achievable narrowing).

**Contract**: `drop policy if exists` for **both** drifted names (`Solver reads any job`,
`Solver reads its jobs`) before `create policy`. No grant changes — the claim CAS's
`select=id,snapshot_hash` needs only the existing table-wide SELECT grant plus this row window
(claim happens while the row is `queued`).

#### 2. Pin policy posture in tests

**File**: `src/test/solver-credential.integration.test.ts`

**Intent**: Assert the live policy name and predicate (via `pg_policies`) so the drift class found
during research (hand-patched local DB diverging from migrations) fails loudly next time. Also
assert the solver can no longer SELECT a terminal row.

**Contract**: Extends the existing credential suite; runs under `pnpm test:integration`.

### Success Criteria:

#### Automated Verification:

- Fresh reset applies cleanly: `pnpm exec supabase db reset`
- Credential + transport suites pass: `pnpm test:integration src/test/solver-credential.integration.test.ts src/test/solver-transport.integration.test.ts` (solver running)

#### Manual Verification:

- `has_table_privilege` / a solver-token probe confirms terminal rows are unreadable (posture
  verified live, not by reading migration text — lessons.md)

---

## Phase 3: App — assembly promotion + enqueue path

### Overview

Relocate the shared loaders into `entities/timetable/api/`, promote the bench assembly pieces,
build the enqueue domain function + Action, and switch the Generate button's engine.

### Changes Required:

#### 1. Relocate `loadPlanAnalysis` and `clonePlan` into the entity layer

**File**: `src/entities/timetable/api/load-plan-analysis.ts` (from `_pages/plan-comparison/api/`),
`src/entities/timetable/api/clone-plan.ts` (from `_pages/plans-list/api/`)

**Intent**: Both are needed by `_pages/plan-detail`; cross-`_pages` imports break steiger. Both
files import only from `shared`/`entities` already, so they move verbatim; `plan-comparison`,
`plans-list`, and `bench/` update their imports. `clonePlan` keeps its per-cohort `catalog_hash`
refresh (skipping it opens the proposal with a stale-groupings palette).

**Contract**: Import-at-own-path (not barrel-exported — see Critical Implementation Details).
`clonePlan`'s input type moves with it or stays slice-side with the Zod schema; keep the Zod schema
in the plans-list slice (it is the action's input gate) and have the domain function accept plain
parameters.

#### 2. Promote the snapshot assembly + phantom auto-park

**File**: `src/entities/timetable/api/assemble-plan-snapshot.ts` (new; `loadPins` + `toSnapshot`
promoted from `bench/experiment-harness.ts:41,75`),
`src/entities/timetable/model/generation/auto-park.ts` (moved from `bench/auto-park.ts` with its
doc-comment and test)

**Intent**: One production entry point: load the source plan (`loadPlanAnalysis`) + pins, assemble
via `assembleGeneratorSnapshot`, then apply `autoParkPhantomCourses` — production assembly does what
bench does before every solve. Return the snapshot **and** the `autoParked` audit list. Bench
switches to importing the promoted modules (no duplicate assembly path left behind).

**Contract**: Pure transform stays pure (barrel-exportable); the loader composition is api-segment,
own-path import. The assembled snapshot is byte-canonicalizable by `computeSnapshotHash`.

#### 3. Natural-key course map helper

**File**: `src/entities/timetable/model/generation/course-map.ts` (new)

**Intent**: Build the source→clone `courseId` map keyed on `(cohort, name, level, group_index)` —
validated unique 84/84 and matching 84/84 in research. Throws on a duplicate key or an unmapped
result id (fail loud, never a partial apply). Do **not** generalise to teachers/students
(`full_name` is 1-of-18 distinct; results carry no such ids anyway).

**Contract**: `(sourceCourses, cloneCourses) → Map<sourceCourseId, cloneCourseId>`; consumed by
Phase 4's delivery. Unit-tested with duplicate-key and missing-course cases.

#### 4. Enqueue domain function + Action

**File**: `src/_pages/plan-detail/api/generation-job.ts` (new domain functions),
`src/_pages/plan-detail/api/generation-actions.ts` (new, `defineDomainAction`),
`src/actions/index.ts` (register)

**Intent**: `startGeneration(supabase, { planId })`: assemble + hash from the **source** (no side
effects first) → `clonePlan` (name e.g. `"Proposal — <source name>"`; `plans.name` has no unique
constraint) → insert `generation_jobs` (`plan_id` = source, `proposal_plan_id` = clone, `snapshot`,
`snapshot_hash`, minimal audit `policy` such as `{"clean": true}` — the vocabulary is S-307's) →
dispatch via `createSolverTransport(getSolverTransport())` (own-path imports). Failure handling per
Critical Implementation Details: `23505` → delete clone + "already running" `DomainError`; transport
`null` → "generation dispatch unavailable"; dispatch failure → mark `failed` + delete clone +
surface.

**Contract**: Follows the `defineDomainAction` pattern (`requireSession` → `requireSupabase` →
`runDomain`); Zod input `{ planId: uuid }`. Returns the job id + proposal plan id.

#### 5. Generate button switches engines

**File**: `src/_pages/plan-detail/model/generation/use-generation-job.ts` (new hook),
`src/_pages/plan-detail/model/use-cohort-board-state.ts`,
`src/_pages/plan-detail/ui/chrome/GenerateButton.tsx`

**Intent**: A new hook owns the job lifecycle client-side: launch (call the enqueue action), expose
job state for the strip, and (Phase 4) the on-visit check + refresh. `GenerateButton` keeps its
slot, ghost idiom, and disable logic (`busy` settle guard, blocking-violations, "Plan is complete")
but `generate` now enqueues the CP-SAT job; the worker-driven solving state ("Stop & keep",
elapsed/budget) is removed from the button (an enqueued job renders via the Phase 4 strip). The
greedy hook/worker files stay in the repo, unreferenced by the button. Note: the swap may leave
`GenerationSummaryPanel` (and anything else fed by the old `GeneratePlanControls` shape) as
unreachable UI — that is acceptable here (unreferenced ≠ broken; steiger + `pnpm check` gate actual
breakage) and is swept up by the separate greedy-removal cleanup change, not this slice.

**Contract**: `GenerationControls` (`use-cohort-board-state.ts:192`) is rewired to the new hook's
shape; the React island keeps render-purity (React Compiler — no hand memoization).

### Success Criteria:

#### Automated Verification:

- Unit tests pass (course map, auto-park move, enqueue domain logic): `pnpm test`
- Types: `pnpm check` (after `pnpm exec astro sync`) — the mandatory type gate, not build/lint
- FSD structure: `pnpm steiger`
- Lint + build: `pnpm lint`, `pnpm build`
- Enqueue integration test (insert + 23505 translation + dispatch-failure cleanup): `pnpm test:integration`

#### Manual Verification:

- Clicking Generate on a local plan creates the clone + `queued` row and the solver claims it
- Second click while active shows "a generation is already running for this plan"
- With `SOLVER_URL` unset, the action fails cleanly and no clone/row is left behind

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: App — delivery pipeline + status strip

### Overview

The check-and-deliver Action (server-side oracle → id translation → atomic apply → delivered
marker), orphan-clone cleanup on failure, and the minimal job status strip with on-visit check +
manual refresh.

### Changes Required:

#### 1. Delivery domain function

**File**: `src/_pages/plan-detail/api/generation-job.ts`, registered in `generation-actions.ts`

**Intent**: `checkGeneration(supabase, { planId })`: narrow-projection read of the latest job for
the plan. `queued`/`running` → return status for the strip. `succeeded` + undelivered → fetch
`snapshot` + `result` (second query), run `runVerifiedGeneration` with a trivial injected engine
returning the stored result (the relocated runner seam, FR-313), build the course map, translate
`courseId`s, apply onto the clone via the existing `applyGeneratedPlacements` domain function
(`src/_pages/plan-detail/api/placements.ts:106` — same slice, already integration-tested, already
wraps the `apply_generated_placements` RPC's region shape; do not re-derive it from
`bench/import-generated.experiment.ts`), then CAS the `delivered_plan_id` marker.
Verdict not ok → mark job `failed` with a diagnostic `error`, delete the orphan clone — an
unverified board never lands. `failed`/`infeasible` terminal states with an undelivered clone →
delete the orphan clone (strictly guarded: only the job's own `proposal_plan_id`, only when
`delivered_plan_id is null`). Leave the `delivery` column null — its vocabulary is S-306's.

**Contract**: Idempotent under concurrent invocation via the delivered-marker CAS. The injected
engine re-runs the pins precondition on the same snapshot the solver validated — an idempotent
re-check, kept deliberately (the seam stays `runVerifiedGeneration`, as the roadmap names it).

#### 2. Clean-label derivation

**File**: `src/entities/timetable/model/generation/clean-label.ts` (new, pure)

**Intent**: Derive the honest label from `floor` (recomputed from the job's stored snapshot — per
pin row × per soft co-teacher, mirroring the engine's floor formula exactly) and `achieved` (tier-5 `StageReport.best` from
`generation_jobs.stages`): `achieved == 0` → clean; `achieved == floor > 0` → "clean — N pinned
hour(s) remain on soft cells" (with the unpin hint); `achieved > floor` → non-clean fallback label.
Locate the tier-5 entry by `tier === 5` (never array index — the `stages` shape varies: single
completeness report on infeasible/unknown, tiers 1+4 only in repair mode); a missing entry or
missing `best` yields a "label unavailable" state, not a throw. Per `change.md`: cleanliness is a
derived read, no new field anywhere.

**Contract**: Pure, unit-tested for all three label branches plus the missing-tier-5 guard;
consumed by the delivery read and the strip.

#### 3. Status strip UI

**File**: `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx` (new), wired near
`GenerateButton` in the toolbar/chrome

**Intent**: One component, four states: hidden (no job), active ("Generating… started \<time\>" +
Refresh button invoking the check action), delivered ("Proposal ready — open" linking to
`/plans/<proposalPlanId>` + the clean label), failed (the diagnostic `error`, `role="alert"`
mirroring the existing inline-error idiom). The hook fires the check action on mount (the on-visit
trigger) and after launch.

**Contract**: Semantic theme tokens only (lessons.md); status copy states time from `created_at`/
`finished_at`. S-303 upgrades this strip in place.

### Success Criteria:

#### Automated Verification:

- Unit tests (clean label branches, delivery guards): `pnpm test`
- Types / lint / structure / build: `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build`
- Delivery integration test (seeded terminal rows: succeeded→verify→apply→CAS; failed→clone
  deleted; already-delivered→no-op): `pnpm test:integration`

#### Manual Verification:

- Full local run: launch, wait out the solve, revisit the plan — proposal delivers, opens, board is
  complete
- Clean label correct on the seed catalog (expect fully clean)
- A failed job (e.g. kill the solver mid-run is S-304 territory — instead force a hash mismatch or
  seed a failed row) shows the diagnostic and removes the clone
- Two tabs refreshing concurrently deliver exactly once

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: End-to-end proof + truth-up

### Overview

The tiny-fixture E2E integration test joining the CI integration job, the roadmap wording truth-up,
and the full local gate.

### Changes Required:

#### 1. Tiny-fixture E2E integration test

**File**: `src/test/generation-proposal.integration.test.ts` (new)

**Intent**: Drive the real chain against the local stack + running solver: build a small,
seconds-solvable plan via `src/test/factories/` builders → `startGeneration` → poll the row to
terminal (test-side polling is fine; the app doesn't poll) → `checkGeneration` → assert the proposal
plan holds the verified board, the job is delivered, and cleanup via `teardown`. Follows
`src/test/solver-transport.integration.test.ts`'s `SOLVER_URL` gating so it joins the existing CI
integration job (which already boots the solver).

**Contract**: Adds ~10–30 s to `pnpm test:integration`; skipped when `SOLVER_URL` is absent, like
the transport suite.

#### 2. Roadmap truth-up

**File**: `context/foundation/roadmap.md:113`

**Intent**: Two wording fixes owed by the id-space decision (`change.md`): "assembles the snapshot
from the clone" → from the **source** (clone is the apply target via `courseId` translation);
"settles unsaved board state" → the existing `busy` settle guard (no unsaved state exists). Neither
is a scope change.

**Contract**: Wording only; no status flips (archive/handoff updates belong to `/10x-archive`).

### Success Criteria:

#### Automated Verification:

- Full E2E integration test green locally with the stack + solver up: `SOLVER_URL=http://127.0.0.1:8000 pnpm test:integration src/test/generation-proposal.integration.test.ts`
- The full local CI mirror passes: `/verify` (sync → check → lint → steiger → audit → test → build)
- Solver lane green: `mise run solver:test`, `mise run solver:check`
- Full integration suite: `pnpm test:integration`

#### Manual Verification:

- One full-catalog run end to end on the local stack (~11–12 min solve) — the north-star flow, seen
  with your own eyes: Generate → revisit → "Proposal ready — open" → complete, clean board
- CI run on the PR shows the new test executing in the `integration` job

---

## Testing Strategy

### Unit Tests:

- Engine: clean drives `softHits`→0; pin-on-soft-cell honors the floor (and is not "infeasible"),
  including co-taught and week-split pin floor arithmetic;
  fallback returns a labelled complete board; runner requests clean; hash-binding mismatch fails
  without solving.
- App: course-map (unique/duplicate/missing), clean-label branches, auto-park (test moves with the
  file), enqueue error translation.

### Integration Tests:

- Credential posture pinned (policy name + predicate + terminal-row invisibility).
- Enqueue (row + clone + 23505 + dispatch-failure cleanup); delivery (verify→apply→CAS, orphan
  cleanup, idempotency); the tiny-fixture full chain.

### Manual Testing Steps:

1. `pnpm exec supabase db reset`; provision the solver user; `mise run solver:dev`; `pnpm dev`.
2. Generate on Seed Plan A → strip shows active state; solver log shows claim + clean mode.
3. After ~11–12 min, revisit → proposal delivers; open it; board complete; clean label correct.
4. Force a failure path (hash mismatch or seeded failed row) → diagnostic shown, clone gone.

## Performance Considerations

Assembly 84 ms, clone 40 ms, hash + verify ~2.3 ms, apply single-RPC — the interactive paths are
far inside budgets; the solve itself is asynchronous by design. The <200 ms drag-drop budget is
untouched (no board-editing code changes). Narrow projections keep the status poll off the ~100 KB
TOASTed columns.

## Migration Notes

One additive migration (policy replacement, no schema change). No production data exists; local DBs
must `db reset` first (policy-name drift). Rollback = revert the migration file pre-merge; the app
functions without the narrowing (it only widens what the solver role can read).

## References

- Research: `context/changes/first-verified-proposal/research.md` (incl. the full-flow probe)
- Decisions: `context/changes/first-verified-proposal/change.md`
- Delivery pipeline prior art: `bench/import-generated.experiment.ts`
- Enqueue mirror: `src/test/solver-transport.integration.test.ts:153-168`
- Roadmap slice: `context/foundation/roadmap.md:111-122`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Engine — clean mode + snapshot-hash binding

#### Automated

- [ ] 1.1 Solver suite passes (`mise run solver:test`)
- [ ] 1.2 Strict types + lint (`mise run solver:check`)
- [ ] 1.3 Objective-parity suite stays exactly 10/10
- [ ] 1.4 Golden parity test executed locally (skipif-gated)
- [ ] 1.5 TS contract suite green (`pnpm test`)

#### Manual

- [ ] 1.6 Clean solve on a real dump: OPTIMAL, complete, `softHits = 0`

### Phase 2: DB — RLS status-window narrowing

#### Automated

- [ ] 2.1 Fresh reset applies cleanly (`pnpm exec supabase db reset`)
- [ ] 2.2 Credential + transport integration suites pass

#### Manual

- [ ] 2.3 Terminal rows verified unreadable by the solver role (live probe)

### Phase 3: App — assembly promotion + enqueue path

#### Automated

- [ ] 3.1 Unit tests pass (`pnpm test`)
- [ ] 3.2 Type gate (`pnpm check`)
- [ ] 3.3 FSD structure (`pnpm steiger`)
- [ ] 3.4 Lint + build (`pnpm lint`, `pnpm build`)
- [ ] 3.5 Enqueue integration test (`pnpm test:integration`)

#### Manual

- [ ] 3.6 Generate creates clone + queued row; solver claims it
- [ ] 3.7 Second click surfaces "already running"
- [ ] 3.8 `SOLVER_URL` unset fails cleanly, nothing left behind

### Phase 4: App — delivery pipeline + status strip

#### Automated

- [ ] 4.1 Unit tests pass (`pnpm test`)
- [ ] 4.2 Type / lint / structure / build gates
- [ ] 4.3 Delivery integration test (`pnpm test:integration`)

#### Manual

- [ ] 4.4 Full local run delivers and opens the proposal
- [ ] 4.5 Clean label correct on the seed catalog
- [ ] 4.6 Failure path shows diagnostic and removes the clone
- [ ] 4.7 Concurrent refresh delivers exactly once

### Phase 5: End-to-end proof + truth-up

#### Automated

- [ ] 5.1 Tiny-fixture E2E integration test green
- [ ] 5.2 `/verify` full local gate passes
- [ ] 5.3 Solver lane green (`mise run solver:test`, `mise run solver:check`)
- [ ] 5.4 Full integration suite (`pnpm test:integration`)

#### Manual

- [ ] 5.5 One full-catalog end-to-end run observed
- [ ] 5.6 CI shows the new test executing in the `integration` job
