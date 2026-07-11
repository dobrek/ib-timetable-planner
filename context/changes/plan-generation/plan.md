# Plan Generation Implementation Plan

## Overview

Ship automatic plan generation: a zero-config toolbar "Generate" that fills all deficits
on both cohort boards with a complete, all-hard-rules-respecting set of placements at
manual-parity quality (≤ the manual plan's occupied-slot count per cohort, free slots at
day edges) within a ~20 s budget — applied optimistically as **one undo entry**, persisted
by **one atomic RPC**, and reviewed via a solve summary panel plus `finishes_early`
badges. Two engines (or-tools-wasm CP-SAT and a pure-TS greedy) are spiked behind one
`generatePlan()` port; **CP-SAT ships automatically if it passes the measurable bars,
else the TS engine does**. The PRD's standing auto-placement non-goal is reversed as part
of this change.

## Current State Analysis

Both prerequisites have landed:

- **`day-scoped-course-rules` (archived 2026-07-11)** shipped the full rule foundation:
  `courses.finishes_early` + CRUD + clone carry-through; the blocking `early-finish-edge`
  constraint and warn-level `course-day-stacking` constraint registered in the core
  (`src/entities/timetable/model/collision/constraints/index.ts`); the day-occupancy
  index; drag-hint wiring; the flag set delivered plan-scoped via
  `SharedBoardProps.finishesEarlyByCourseId` → `useFinishesEarlySet`
  (`src/_pages/plan-detail/model/use-board-derivations.ts`). PRD registers FR-014/FR-015.
- **`clone-plan-without-board` (archived 2026-07-11)** gives a catalog-only clone — the
  test bench: clone the real plan without its board, generate onto the empty board,
  compare against the 48-slot manual result.

What exists for the generator to stand on (research-verified):

- **Feasibility oracle**: `deriveCellViolations` — pure, ~0.2–0.3 ms per full board
  (`src/entities/timetable/model/collision/collisions.ts:33-58`), now including both
  day-scoped rules. Index builders (`availability-index.ts`, `cross-cohort-index.ts`) are
  O(rows).
- **Objective raw material**: `deriveHours`/`deriveUnplaced`
  (`src/entities/timetable/model/hours.ts:14-60`); parked-deficit semantics in
  `src/_pages/plan-detail/ui/chrome/courses-left-summary.ts`.
- **Optimistic state + undo**: snapshot-region history entries (per-cohort), reconciled
  by re-issuing the normal RPCs; `executeDecomposed` falls back to one `place_course`
  per placement (`src/_pages/plan-detail/model/history/reconcile-exec.ts:76-89`) — a
  batch entry is representable today but undoes as ~N RPCs without a new recognizer.
- **Write path**: `place_course` creates the cell's `bundles` row server-side via
  find-or-create (`supabase/migrations/20260707140000_place_course_preserve_optional.sql:46-50`);
  the atomic delete+reinsert-in-one-transaction template is `replace_cohort_groupings`
  (`supabase/migrations/20260611180006_plans_as_domain_root.sql:132-169`).
- **Toolbar seat**: the `trailing` fragment of `PlanSummaryBar`
  (`src/_pages/plan-detail/ui/PlannerBoard.tsx:262-298`), next to `ExportMenu` /
  `BoardSettingsMenu`. Long-compute UX precedent: `GroupingStalePanel.tsx` /
  `useRecomputeGroupings` (busy guard, inline `role="alert"` error).
- **Greenfield**: no Web Worker, no WASM, no COOP/COEP or custom-header config anywhere
  in `src/`; no `WebWorker` TS lib configured (strict via `astro/tsconfigs/strict`).

## Desired End State

On a plan with deficits and no blocking violations, the author clicks **Generate**; a
progress affordance shows elapsed/budget with a "Stop & keep" cancel; within ~20 s the
board fills with placements that honor every hard rule (five registered constraints plus
the generator-hard 2/day cap and `finishes_early` edge rule), at ≤ the manual plan's
occupied-slot count per cohort with free slots at day edges. The result lands as ordinary
optimistic placements — **one undo press reverts both cohorts** — and persists via one
atomic RPC. A summary panel reports slots per cohort, unplaced courses, and budget used.
Flagged courses show a badge on board and palette chips. The PRD/roadmap no longer list
auto-placement as a non-goal.

**Verification**: the on-demand benchmark on the real catalog asserts completeness, zero
blocking violations, and per-cohort slot parity; a fast CI smoke exercises the
port → engine → verify pipeline on a synthetic catalog; manual acceptance runs on a
catalog-only clone of the real plan.

### Key Discoveries:

- Undo entries carry an unbounded `AffectedScope`/`AffectedSlice`
  (`src/_pages/plan-detail/model/history/history-entry.ts:15-40`) — a batch entry is
  representable; only the reconcile executor needs a batch recognizer to avoid N RPCs.
- History entries are **cohort-scoped** (`use-history.ts:41-46`); "one undo press for
  both cohorts" needs a history extension (multi-segment entry or grouped pop).
- `_headers` files apply only in `pnpm preview`/production; **middleware-set response
  headers apply in both dev and preview** (`src/middleware.ts:44` is the seam) — so
  COOP/COEP, if CP-SAT wins, goes in middleware.
- `place_course` does **not** converge `week`/`is_optional` on conflict
  (`20260707140000` rationale) — the apply RPC's delete-then-reinsert must carry both
  columns for pre-existing rows it touches.
- Both day-scoped rules are now core constraints, so the generator's "hard" treatment of
  them falls out of the verify contract for free: zero blocking violations implies the
  edge rule; a hard 2/day cap in the engine implies zero stacking warns.

## What We're NOT Doing

- **No selective pinning UI, no clear-and-regenerate** — fill-the-gaps only; whatever is
  on the board stays (author decision).
- **No visual highlight of newly generated placements** — explicitly rejected; review
  affordances are the badge + summary panel only.
- **No configuration UI** — zero-config button; budget is a code constant (~20 s). No
  budget picker, no objective-weight toggles.
- **No solver-proven infeasibility explanations** — staged for later; v1 ships
  best-effort board + unplaced list.
- **No server-side generation seat** — no Astro Action engine, no Timefold container;
  client Web Worker only.
- **No maintenance of the losing engine** — it is deleted after the checkpoint; the port
  keeps the door open.
- **No grouping coupling** — engines consume the snapshot only; palette groupings,
  staleness, and `computeGroupings` are untouched.
- **No new Playwright e2e spec** — the CI smoke covers the pipeline; acceptance is
  manual on the cloned real plan.
- **No durable (table-backed) undo history** — the in-memory store stays; only the batch
  entry shape/recognizer is extended.

## Implementation Approach

Build inside-out along FSD layers. The pure generator core (snapshot/config/result
types, deficit derivation, trust-but-verify) joins the scheduling domain in
`src/entities/timetable/model/generation/` — same slice as the constraint core it
consumes, avoiding cross-entity imports. Engines are pure encode/solve/decode modules
behind one `generatePlan()` port; the Web Worker entry, orchestration hook, and UI live
in `src/_pages/plan-detail/` (the only consumer). Persistence follows the
`replace_cohort_groupings` atomic-region template, designed so the **same RPC** serves
forward apply, undo, and redo. Every engine result is re-judged by
`deriveCellViolations` before it touches the board — the oracle stays the single source
of truth. Phase 2 is a hard checkpoint: measurable bars decide the engine automatically
(CP-SAT if it passes), and the spike's benchmark harness is the same artifact that
guards parity forever after.

## Critical Implementation Details

- **COOP/COEP via middleware, not `_headers`** (only if CP-SAT wins). Set
  `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`
  on document responses by capturing `const response = await next()` at
  `src/middleware.ts:44`. Middleware headers apply in dev *and* preview; a
  `public/_headers` file would not apply under `astro dev`. Same-origin worker/wasm
  assets need no CORP; Supabase calls are CORS `fetch` (unaffected by COEP) — but the
  spike must verify sign-in/sign-out and the board's data loads still work in dev **and**
  preview with headers on. If the TS engine wins, ship no headers at all.
- **Verify contract (trust-but-verify)**: merge generated + existing placements per
  cohort, build fresh availability/cross-cohort indexes, run `deriveCellViolations` with
  the flag set; the result is accepted only if there are **zero blocking violations
  board-wide and zero `course-day-stacking` warns among generated cells**. Soft
  teacher-availability warns are permitted but counted in diagnostics. On failure the
  whole result is rejected with a diagnostic — never partially applied. Also assert
  generator invariants the core doesn't check: grid-preset bounds, `week_mode ↔ week`
  consistency, catalog membership (a catalog-missing course is silently skipped by
  validation — `collisions.ts:93` — so verify must catch it explicitly).
- **One RPC for apply, undo, and redo.** `apply_generated_placements` is a region
  replace: "make these cells contain exactly these placements." Forward apply passes the
  affected cells with existing + generated rows; undo passes the same cells with the
  pre-state rows; redo repeats forward. Rows must carry `week` and `is_optional` (the
  delete-then-reinsert would otherwise reset them). Copy the bundle find-or-create from
  the **latest live** `place_course` definition (`20260707140000`), per the lessons rule.
- **History extension for a two-cohort entry.** Entries are cohort-scoped and the
  reconcile executor is per-cohort. One Generate must be one undo/redo press reverting
  both cohorts: either a multi-segment entry (`{cohort, scope, target}[]`) or grouped
  consecutive entries popped together — implementer's choice, preserving the
  recorder-bypass invariant (reconcile never records) and the busy-gating. The batch
  recognizer in `executeReconcilePlan` dispatches any multi-cell plan to the new RPC
  instead of `executeDecomposed`'s per-placement `place_course` loop.
- **Engines are snapshot-only.** No dependency on persisted groupings (avoids staleness
  coupling); MRV ordering is computed from the snapshot's conflict structure directly.
- **Lazy-load the engine.** The worker (and wasm, if CP-SAT) is dynamically imported on
  first Generate click — the board's hot path and initial load stay untouched.
- **Worker TS lib**: no `WebWorker` lib is configured; the worker entry uses
  `/// <reference lib="webworker" />` — do not widen `tsconfig.json`.
- **Cancel = keep best-so-far.** The engine must be able to return its best solution on
  demand. For CP-SAT, if the wasm build exposes no interrupt/solution callback, solve in
  warm-started increments (e.g. 5 s slices re-hinted from the previous best) so cancel
  returns the last completed slice. This is a spike bar, not an afterthought.
- **Block-until-clean gate** (author decision): Generate is disabled while any
  **blocking** violation exists on either cohort's board (warns don't block), and when
  there are no deficits. Tooltip states the reason. Consequence for the model: pins are
  always valid, so engines need no pin-vs-pin exemptions.

## Phase 1: Generator foundations (pure core)

### Overview

The pure domain layer: snapshot/result types and the `generatePlan` port, deficit
derivation, and the trust-but-verify judge — all headless, unit-tested, engine-free.

### Changes Required:

#### 1. Port + types

**File**: `src/entities/timetable/model/generation/types.ts` (new)

**Intent**: Define the engine-agnostic contract every later phase builds against.

**Contract**: `GeneratorSnapshot` (per-cohort `GroupingCourse[]`, existing
`PlannerPlacement[]` as pins, parked member sets, availability rows, grid preset,
plan-scoped `finishesEarlyByCourseId`), `GeneratorConfig` (`budgetMs`),
`GeneratedPlacement` (`cohort, courseId, day, period, week`), and
`GenerationResult` (`placements, diagnostics`) where diagnostics carry per-cohort
occupied-slot counts (before/after), unplaced deficits, elapsed ms, engine id,
`provenOptimal?`, and a `partial` marker for cancel. The port:
`generatePlan(snapshot, config, hooks) → Promise<GenerationResult>` with hooks for
progress reporting and a cancellation signal that resolves best-so-far. Model on
existing app types (`GroupingCourse`, `PlannerPlacement`) — no parallel shapes (lessons:
port the mechanism).

#### 2. Deficit derivation

**File**: `src/entities/timetable/model/generation/deficits.ts` (new, + test)

**Intent**: Compute what the generator must place: per-cohort course deficits =
`deriveUnplaced` minus deficits covered by parked bundles (skip-parked author decision,
matching courses-left semantics).

**Contract**: pure over `(placements, courses, parked member sets)`. If this duplicates
the parked-coverage logic in `src/_pages/plan-detail/ui/chrome/courses-left-summary.ts`,
relocate that pure helper down into the entity and re-export from the page slice —
don't fork the semantics.

#### 3. Trust-but-verify judge

**File**: `src/entities/timetable/model/generation/verify.ts` (new, + test)

**Intent**: Re-judge any engine output through the oracle before it can touch the board,
plus the invariants the core doesn't check.

**Contract**: `verifyGeneration(snapshot, generated) → { ok, violations?, reasons? }`
implementing the verify contract from Critical Implementation Details (merged two-cohort
board through `deriveCellViolations` with fresh indexes + flag set; explicit
grid-bounds / week-consistency / catalog-membership / duplicate-cell checks). Reject
wholesale on any failure.

#### 4. Snapshot assembly

**File**: `src/_pages/plan-detail/model/generation/assemble-snapshot.ts` (new, + test)

**Intent**: Build a `GeneratorSnapshot` from the live combined board state (courses,
current placements, parked bundles, availability, grid preset, flag set) — the same data
`useCombinedBoardState` already owns.

**Contract**: pure function over explicit inputs (testable without hooks); placements
passed as-is are the pins.

#### 5. Synthetic fixtures

**File**: `src/entities/timetable/model/generation/__fixtures__/synthetic-catalog.ts` (new)

**Intent**: A small deterministic two-cohort catalog (≈6–8 courses, 2–3 shared teachers,
a biweekly pair, one flagged course, a 3×4 grid) sized so an engine solves it in ≤2 s —
shared by unit tests now and the CI smoke in Phase 2.

**Contract**: built on the existing builders idiom
(`src/entities/timetable/model/__fixtures__/builders.ts`).

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Lint + FSD structure pass: `pnpm lint` && `pnpm steiger`
- New unit tests (deficits, verify, snapshot assembly) + full suite pass: `pnpm test`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- None — pure model layer, no user-visible change.

**Implementation Note**: No pause needed if automated criteria pass; proceed to Phase 2.

---

## Phase 2: Engine spike & decision checkpoint

### Overview

Both engines minimal behind the port; the benchmark harness on the real catalog; the
auto-decision applied and recorded. This phase kills the change's only research risk.

### Changes Required:

#### 1. COOP/COEP headers (CP-SAT prerequisite)

**File**: `src/middleware.ts`

**Intent**: Enable cross-origin isolation so WASM threads work in the spike, per the
middleware seam in Critical Implementation Details.

**Contract**: headers on document responses after `next()`; verify sign-in/sign-out,
board loads, and export flows in dev and preview. Removed again if the TS engine wins.

#### 2. CP-SAT engine

**File**: `src/entities/timetable/model/generation/engines/cp-sat.ts` (new),
`or-tools-wasm` pinned exact in `package.json`

**Intent**: Direct assignment model — Booleans over `course × slot × week-variant`;
hard: hours-per-course exactly, student/teacher/co-teaching conflicts, strong
availability, cross-cohort teacher (joint two-cohort model), **max 2 periods of one
course per day**, **finishes_early at the edge of each enrolled student's day or
unplaced**; pins fixed. Objective tiers (author's priority): completeness > day-edge
qualities (free slots at day edges, student day compactness) > per-cohort occupied-slot
count > teacher compactness / balanced daily load.

**Contract**: implements the port; encode/decode only — no DOM, no worker specifics.
Completeness is the top objective tier (not a hard constraint) so best-effort boards
with unplaced courses remain expressible.

#### 3. TS greedy engine

**File**: `src/entities/timetable/model/generation/engines/greedy.ts` (new, + test)

**Intent**: The guaranteed-shippable baseline: most-constrained-first constructive
placement scored by the same objective tiers, feasibility-checked per candidate cell via
the core's primitives; budget-bounded local-search repair (relocate/swap moves) only if
needed to reach parity.

**Contract**: implements the same port; same hard rules; returns best-so-far on
budget/cancel.

#### 4. Worker spike seat

**File**: `src/_pages/plan-detail/model/generation/generate.worker.ts` (new)

**Intent**: Vite module worker hosting the engines for the spike measurements (load
time, solve time, progress, cancel).

**Contract**: `/// <reference lib="webworker" />`; message protocol per Phase 4 (start /
progress / done / error / cancel) — built once here, hardened there.

#### 5. Benchmark harness (on-demand)

**File**: `bench/` or `src/entities/timetable/model/generation/generation.bench.test.ts`
+ a `pnpm bench:generation` script (new vitest config or script entry)

**Intent**: The executable success bar: assemble the real dp1+dp2 catalog snapshot (via
the seeded local Supabase through the existing load/factory path; CSV transcode as
fallback), run each engine at full budget, assert **complete, zero blocking violations,
per-cohort occupied slots ≤ the manual plan's counts** (record the actual per-cohort
counts from the real plan when authoring the benchmark), and report soft metrics
(day-edge free slots, elapsed, proven bound if CP-SAT).

**Contract**: excluded from `pnpm test` and CI; run manually and at this checkpoint. If
or-tools-wasm cannot run under Node/vitest, the benchmark's CP-SAT lane runs in a
browser context instead (document how in the script) — the TS lane stays in Node.

#### 6. CI smoke

**File**: `src/entities/timetable/model/generation/generation-smoke.test.ts` (new)

**Intent**: Fast deterministic guard in the unit suite: synthetic catalog through
port → engine → verify in ≤ a few seconds, asserting a complete, zero-violation result.

**Contract**: runs the shipped engine if it works under Node; otherwise covers the TS
parts (snapshot → greedy → verify) and the pure pipeline, with a comment noting the
CP-SAT lane lives in the benchmark.

#### 7. Decision + record

**File**: `context/changes/plan-generation/change.md`

**Intent**: Apply the auto-rule and record measurements + verdict.

**Contract — the bars (all must pass for CP-SAT to ship)**:
1. Worker loads and solves in `pnpm dev` and `pnpm preview` (workerd-served, headers on).
2. Benchmark passes on the real catalog within 30 s (complete, zero blocking
   violations, per-cohort slot parity).
3. Cancel returns best-so-far (interrupt, solution callback, or incremental-solve
   workaround).
4. A progress signal exists (even coarse: slice ticks or objective improvements).

CP-SAT passes all → it ships. Any bar fails → the TS engine ships (extended with
local-search repair until it passes bar 2). **Neither engine reaches parity → STOP and
escalate to the author before Phase 3.** The losing engine file is deleted; the port,
benchmark, and smoke stay.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Lint + FSD structure pass: `pnpm lint` && `pnpm steiger`
- Unit suite incl. CI smoke passes: `pnpm test`
- Benchmark passes for the chosen engine: `pnpm bench:generation`
- Production build stays clean (wasm/worker assets emitted correctly): `pnpm build`

#### Manual Verification:

- Spike measurements + engine verdict recorded in `change.md`
- With headers on (if CP-SAT): sign-in/sign-out and plan-detail load work in dev and
  preview
- Author reviews the benchmark board output (slot counts, day-edge quality) and confirms
  the engine decision

**Implementation Note**: This is the plan's hard checkpoint — pause for manual
confirmation of the engine decision before Phase 3.

---

## Phase 3: Atomic apply + one undo entry

### Overview

The persistence and history machinery: one RPC that makes a set of cells contain exactly
a given set of placements, wired as a batch board write that records a single two-cohort
undo entry and reconciles back through the same RPC.

### Changes Required:

#### 1. Migration — `apply_generated_placements`

**File**: `supabase/migrations/<timestamp>_apply_generated_placements.sql` (via
`pnpm exec supabase migration new apply_generated_placements`)

**Intent**: Atomic region replace serving forward apply, undo, and redo.

**Contract**: `apply_generated_placements(p_plan_id uuid, p_cells jsonb, p_placements
jsonb) returns setof public.placements` — `p_cells` = `[{cohort, day, period}]`,
`p_placements` = `[{cohort, course_id, day, period, week, is_optional}]` (every
placement's cell must be listed in `p_cells`). Body in one transaction: delete placements
in the listed cells, drop emptied bundle rows, then per cell find-or-create the bundle
(copied from the **latest live** `place_course`, `20260707140000`) and insert the rows.
`security invoker`, `set search_path = ''`, plpgsql — the `replace_cohort_groupings`
template. Plan-scoped so one call can carry both cohorts; equally valid for a
single-cohort subset (undo reconcile).

#### 2. Generated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Regenerate after `pnpm exec supabase db reset`.

**Contract**: `pnpm exec supabase gen types typescript --local` (FSD path, not the old
`src/lib/`).

#### 3. Client RPC wrapper

**File**: `src/_pages/plan-detail/api/placements.ts`

**Intent**: `applyGeneratedPlacements(planId, cells, placements)` next to the existing
wrappers, with Zod bounds mirroring the existing day/period/week validation.

**Contract**: same error-translation idiom as `placeCourse`/`moveBundleMembers`.

#### 4. Batch apply verb + two-cohort history entry

**File**: `src/_pages/plan-detail/model/placement/board-writes.ts`,
`src/_pages/plan-detail/model/use-placements.ts`,
`src/_pages/plan-detail/model/history/history-entry.ts`,
`src/_pages/plan-detail/model/history/use-history.ts`,
`src/_pages/plan-detail/model/use-cohort-board-state.ts`

**Intent**: A combined-level `applyGenerated(result)` flow: per cohort one optimistic
batch pass (multi-cell `addManyOptimistic` variant), one RPC call carrying both cohorts'
rows, settle from the returned rows, and record **one** history entry whose undo/redo
reverts/reapplies both cohorts in a single press.

**Contract**: history extension per Critical Implementation Details (multi-segment entry
or grouped pop — implementer's choice); recorder-bypass invariant and busy-gating
(`inFlightRef`, pending-optimistic `busy`) preserved; partial-failure surfaces through
the existing error-banner idiom.

#### 5. Batch reconcile recognizer

**File**: `src/_pages/plan-detail/model/history/reconcile-exec.ts` (+ test)

**Intent**: A multi-cell `ReconcilePlan` dispatches to `apply_generated_placements`
(cells = the entry's scope, placements = the target slice) instead of falling through to
`executeDecomposed`'s per-placement loop.

**Contract**: single-cell shapes keep their existing recognizers untouched; the batch
recognizer is tried before the decomposed fallback.

#### 6. Integration tests

**File**: `src/_pages/plan-detail/api/apply-generated.integration.test.ts` (new)

**Intent**: Prove the RPC's contract: multi-cell insert across both cohorts in one call;
multi-course cells share one bundle row; pre-existing rows included in the region keep
`week`/`is_optional`; emptied bundles are dropped on the undo-shaped call; all-or-nothing
on an invalid row; idempotent replay.

**Contract**: harness builders + teardown (`src/test/factories/`), run via
`pnpm test:integration`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `pnpm exec supabase db reset`
- Type gate passes after types regen: `pnpm check`
- Lint + FSD structure pass: `pnpm lint` && `pnpm steiger`
- Unit suite (history extension, recognizer) passes: `pnpm test`
- Integration suite (RPC contract) passes: `pnpm test:integration`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- None user-visible yet (no UI trigger until Phase 4); machinery is exercised by tests.

**Implementation Note**: No pause needed if automated criteria pass; proceed to Phase 4.

---

## Phase 4: Worker seat + Generate UX

### Overview

The production surface: hardened worker protocol, the orchestration hook, the toolbar
button with its disabled states, the solve summary panel, and the `finishes_early`
badges. Ends with the change's acceptance test on a cloned real plan.

### Changes Required:

#### 1. Worker protocol (hardened)

**File**: `src/_pages/plan-detail/model/generation/generate.worker.ts`,
`.../worker-protocol.ts` (new, + test)

**Intent**: Typed messages — main→worker `start {snapshot, config}` / `cancel`;
worker→main `progress {elapsedMs, best?}` (throttled), `done {result}`, `error
{message}`. Cancel resolves with best-so-far (`partial: true`). Verify runs inside the
worker before `done`; the main thread trusts a verified result.

**Contract**: worker terminated after done/error; budget constant (~20 000 ms) lives
with the protocol types. Engine + wasm loaded inside the worker on `start` (lazy).

#### 2. Orchestration hook

**File**: `src/_pages/plan-detail/model/generation/use-generate-plan.ts` (new, + test)

**Intent**: The `useRecomputeGroupings` idiom scaled up: busy guard; assemble snapshot →
spawn worker → track progress state → on done, dispatch Phase 3's `applyGenerated` and
set the summary state; inline error on failure; cancel wired to keep-best.

**Contract**: exposed from `useCombinedBoardState`'s orchestration seat (it owns both
cohorts); generation `busy` participates in the same gating as other writes (no
undo/redo or drag writes mid-apply).

#### 3. Generate button

**File**: `src/_pages/plan-detail/ui/chrome/GenerateButton.tsx` (new, + test),
seated in the `trailing` fragment (`src/_pages/plan-detail/ui/PlannerBoard.tsx:262-298`)

**Intent**: Zero-config toolbar affordance following the ghost icon-button idiom. Idle →
click generates. Disabled when: any **blocking** violation on either cohort (tooltip
"Resolve blocking violations first" — block-until-clean, author decision), zero deficits
(tooltip "Plan is complete"), or busy. Running → progress (elapsed vs budget) + a
**"Stop & keep"** cancel.

**Contract**: disabled-state inputs derive from existing collision severities and
Phase 1's deficits — no new derivation passes; warns do not block.

#### 4. Solve summary panel

**File**: `src/_pages/plan-detail/ui/chrome/GenerationSummaryPanel.tsx` (new, + test)

**Intent**: Dismissible post-solve review (author decision 5): per-cohort occupied slots
before → after, unplaced count with course names (render-edge name resolution), budget
used, `partial` marker when cancelled, `provenOptimal` note when the engine provides it.

**Contract**: ephemeral (not persisted); rendered from `PlannerBoard` near the summary
bar; dismiss on close or next board edit.

#### 5. `finishes_early` badges

**File**: `src/_pages/plan-detail/ui/grid/slot-cell/PlacedChip.tsx`,
`src/_pages/plan-detail/ui/palette/PaletteCourseChip.tsx`

**Intent**: A small icon-badge on chips of flagged courses so the review UX explains why
the generator pushed them to day edges (deferred here from `day-scoped-course-rules`).

**Contract**: flag set already available via `SharedBoardProps.finishesEarlyByCourseId`
/ `useFinishesEarlySet` — thread the membership down as a boolean prop; semantic tokens
only; native `title` for the explanation.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Lint + FSD structure pass: `pnpm lint` && `pnpm steiger`
- Unit + dom suites (hook, button states, panel, protocol) pass: `pnpm test`
- Integration suite still passes: `pnpm test:integration`
- Production build stays clean: `pnpm build`
- Benchmark still passes post-wiring: `pnpm bench:generation`

#### Manual Verification:

- Catalog-only clone of the real plan → Generate → complete board at ≤ the manual
  per-cohort slot counts, free slots at day edges, zero red flags
- One undo press reverts both cohorts to the pre-generation board; redo reapplies;
  reload confirms persistence matches the visible board
- Cancel mid-solve keeps a partial board, summary marks it partial, undo discards it
- Dirty board (introduce a blocking violation) disables Generate with the tooltip;
  resolving re-enables; a complete plan disables with "Plan is complete"
- Flagged courses show the badge on board and palette chips
- Progress + "Stop & keep" render during solve; board stays responsive (worker
  off-main-thread)

**Implementation Note**: After automated verification passes, pause for manual
confirmation of the checklist above — it is the change's acceptance test.

---

## Phase 5: PRD & roadmap amendment

### Overview

Reverse the standing auto-placement non-goal and register the feature — the process
step the frame put in this change's scope.

### Changes Required:

#### 1. PRD amendment

**File**: `context/foundation/prd.md`

**Intent**: Remove the carried-forward non-goal ("End-to-end automatic timetable
optimization / auto-placement", `prd.md:485`), and register generation as a functional
requirement (next free FR number after FR-015): fill-the-gaps generation, hard-rule set
(five core constraints + generator-hard 2/day and finishes-early-edge-or-unplaced),
objective priority order, parity success bar, budget + cancel-keep-best, one-undo-entry
apply, block-until-clean gate.

**Contract**: follows the FR-014/FR-015 registration idiom from
`day-scoped-course-rules`; note the reversal rationale (NP-hard premise falsified at
this instance scale) with a pointer to `research.md`.

#### 2. Roadmap amendment

**File**: `context/foundation/roadmap.md`

**Intent**: Remove the Parked entry (`roadmap.md:212`) and record the slice as shipped
by this change, following the existing shipped-item idiom.

**Contract**: prose only.

### Success Criteria:

#### Automated Verification:

- Full local gate stays green: `pnpm check` && `pnpm lint` && `pnpm steiger` &&
  `pnpm test` && `pnpm build`

#### Manual Verification:

- PRD/roadmap read consistently: no remaining reference to auto-placement as a non-goal
  anywhere in `context/foundation/`

**Implementation Note**: Final phase; close the change per the usual epilogue flow.

---

## Testing Strategy

### Unit Tests:

- Deficit derivation: unplaced minus parked-covered, per cohort, clamped semantics
- Verify judge: accepts a clean result; rejects out-of-bounds cell, week-mode mismatch,
  catalog-missing course, duplicate cell row, any blocking violation, a 3-stack
- Greedy engine (if shipped) on the synthetic catalog: completeness, hard-rule matrix
  (2/day cap, flagged-course edge-or-unplaced, cross-cohort teacher, biweekly weeks)
- CI smoke: synthetic catalog end-to-end through the shipped pipeline in seconds
- History: two-cohort entry records once, undo/redo round-trip, recorder-bypass holds
- Reconcile recognizer: multi-cell plan → one RPC; single-cell shapes unchanged
- Button disabled-state logic; worker protocol message handling; summary panel rendering

### Integration Tests:

- `apply_generated_placements` contract suite (Phase 3 · 6): atomicity, bundle
  find-or-create, week/is_optional preservation, emptied-bundle cleanup, idempotency

### Manual Testing Steps:

1. Clone the real plan catalog-only; Generate on the empty board; compare slot counts
   and day-edge quality against the manual plan
2. Generate on a partially-filled board (fill-the-gaps): existing placements untouched
3. Undo → redo → reload: board and DB agree at every step
4. Cancel mid-solve: partial board kept and marked; undo discards
5. Disabled states: dirty board tooltip, complete-plan tooltip
6. Badges on flagged courses (board + palette)
7. If CP-SAT shipped: auth + exports still work in dev and preview with COOP/COEP on

## Performance Considerations

Generation runs entirely off the main thread; the board stays interactive. The engine
(and wasm, ~2 MB gzip if CP-SAT) is lazy-loaded on first use — initial page load and the
<200 ms drag budget are untouched. Verify costs ~1 ms (oracle-scale). Snapshot assembly
is O(rows). The apply is one optimistic pass per cohort + one RPC (~254 rows worst case,
well inside PostgREST payload norms). The benchmark asserts the 30 s ceiling on the real
catalog; the production default budget is ~20 s.

## Migration Notes

One additive migration (`apply_generated_placements`) — no table changes, no backfill,
no grant work (default privileges carry; `security invoker` keeps RLS gating). Hosted
rollout is the normal CI deploy path. A code rollback leaves the RPC inert. The
COOP/COEP headers (CP-SAT only) are runtime middleware — removable by reverting the
middleware change; they affect every page, so the Phase 2 manual checks in dev *and*
preview are the guard against auth/embed regressions.

## References

- Frame (problem statement, time-to-parity bar): `context/changes/plan-generation/frame.md`
- Research (feasibility, engines, scale, code map): `context/changes/plan-generation/research.md`
- Planning-session decisions: `context/changes/plan-generation/change.md`
- Prerequisite (rules foundation): `context/archive/2026-07-11-day-scoped-course-rules/plan.md`
- Test bench (catalog-only clone): `context/archive/2026-07-11-clone-plan-without-board/plan-brief.md`
- Oracle: `src/entities/timetable/model/collision/collisions.ts:33-58`
- Atomic-region RPC template: `supabase/migrations/20260611180006_plans_as_domain_root.sql:132-169`
- Bundle find-or-create (latest live): `supabase/migrations/20260707140000_place_course_preserve_optional.sql:24-69`
- History engine: `src/_pages/plan-detail/model/history/` (`history-entry.ts`,
  `use-history.ts`, `reconcile-exec.ts`)
- Toolbar seat: `src/_pages/plan-detail/ui/PlannerBoard.tsx:262-298`
- Long-compute idiom: `src/_pages/plan-detail/ui/palette/GroupingStalePanel.tsx:28-76`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.
> Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Generator foundations (pure core)

#### Automated

- [x] 1.1 Type gate passes (`pnpm check`) — 1149966
- [x] 1.2 Lint + FSD structure pass (`pnpm lint` && `pnpm steiger`) — 1149966
- [x] 1.3 New unit tests + full suite pass (`pnpm test`) — 1149966
- [x] 1.4 Production build stays clean (`pnpm build`) — 1149966

### Phase 2: Engine spike & decision checkpoint

#### Automated

- [x] 2.1 Type gate passes (`pnpm check`) — 8b46dec
- [x] 2.2 Lint + FSD structure pass (`pnpm lint` && `pnpm steiger`) — 8b46dec
- [x] 2.3 Unit suite incl. CI smoke passes (`pnpm test`) — 8b46dec
- [x] 2.4 Benchmark passes for the chosen engine (`pnpm bench:generation`) — 8b46dec
- [x] 2.5 Production build stays clean (`pnpm build`) — 8b46dec

#### Manual

- [ ] 2.6 Spike measurements + engine verdict recorded in change.md
- [ ] 2.7 Auth + plan-detail load verified in dev and preview (headers on, if CP-SAT)
- [ ] 2.8 Author confirms the engine decision (checkpoint)

### Phase 3: Atomic apply + one undo entry

#### Automated

- [x] 3.1 Migration applies cleanly (`pnpm exec supabase db reset`) — 0b51df4
- [x] 3.2 Type gate passes after types regen (`pnpm check`) — 0b51df4
- [x] 3.3 Lint + FSD structure pass (`pnpm lint` && `pnpm steiger`) — 0b51df4
- [x] 3.4 Unit suite passes (`pnpm test`) — 0b51df4
- [x] 3.5 Integration suite passes (`pnpm test:integration`) — 0b51df4
- [x] 3.6 Production build stays clean (`pnpm build`) — 0b51df4

### Phase 4: Worker seat + Generate UX

#### Automated

- [x] 4.1 Type gate passes (`pnpm check`) — 857788f
- [x] 4.2 Lint + FSD structure pass (`pnpm lint` && `pnpm steiger`) — 857788f
- [x] 4.3 Unit + dom suites pass (`pnpm test`) — 857788f
- [x] 4.4 Integration suite passes (`pnpm test:integration`) — 857788f
- [x] 4.5 Production build stays clean (`pnpm build`) — 857788f
- [x] 4.6 Benchmark still passes post-wiring (`pnpm bench:generation`) — 857788f

#### Manual

- [ ] 4.7 Cloned real plan generates to parity (slots + day edges, zero red flags)
- [ ] 4.8 One undo reverts both cohorts; redo reapplies; reload agrees
- [ ] 4.9 Cancel keeps a marked partial board; undo discards
- [ ] 4.10 Disabled states behave (dirty board / plan complete tooltips)
- [ ] 4.11 Badges show on flagged course chips (board + palette)
- [ ] 4.12 Progress + Stop & keep render; board stays responsive during solve

### Phase 5: PRD & roadmap amendment

#### Automated

- [x] 5.1 Full local gate stays green (`pnpm check` && `pnpm lint` && `pnpm steiger` && `pnpm test` && `pnpm build`)

#### Manual

- [ ] 5.2 No auto-placement non-goal reference remains in `context/foundation/`
