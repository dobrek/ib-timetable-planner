# Generation Quality Tuning Implementation Plan

## Overview

Encode the expert's fully-elicited quality rules into the generation engine so generated boards
approach the gold board's quality. The elicitation (research.md §Follow-up, rules R1–R21 + G1–G4)
supplies every parameter: three hard rules, five new objective tiers in a confirmed order, the
Golden Slot family, the dp1 Chemistry completeness fix, and the pre-pin fixture workflow. Each
engine phase is measured locally against the run-1 analyzer baselines before the next begins,
through a one-command experiment harness (Phase 1) that clones, pins the skeleton, generates,
persists, and analyzes without any manual clicking.

## Current State Analysis

- **Objective** (`src/entities/timetable/model/generation/objective.ts:17`):
  `[unplacedTotal, holes, totalSlots, studentHoles]`, lexicographic. No teacher, soft-availability,
  adjacency, day-shape, or coverage term exists. `compareObjectives` loops over tuple length, so
  tier insertion needs no comparator change.
- **Hard rules** (collision registry `src/entities/timetable/model/collision/constraints/index.ts:12-20`
  + `generation/verify.ts`): duplicate-course, teacher/student conflict, teacher-availability
  (strong→block, soft→warn), cross-cohort-teacher, early-finish-edge, course-day-stacking (2/day,
  warn in UI, generator-hard via delta-aware escalation in `verify.ts:87-91`). **No same-day-split
  rule, no teacher-day cap of any kind.**
- **Search** (`engines/greedy/`): `board.fitsAt` (`board.ts:162-166`) is the single feasibility
  choke point every stage and LNS repair flows through. **Soft availability is invisible to the
  search** — `problem.ts:51-52` indexes only `strong` rows.
- **Measured gaps** (analysis-run-1, gold vs engine on identical inputs): 0 vs 67 same-day splits;
  226 vs 26 adjacent pairs; 74 vs 345 teacher gap-slots; 0 vs 3 soft hits; 612 vs 1020 student
  gaps; 0 vs 3 late day starts; 15 vs 13 golden cells but mean period 4.6/5.75 vs 7.5/8.0.
- **Verified this session (SQL, local golden plan)**: gold teacher day spans max out at exactly 8
  (12 lanes at the boundary, 0 over); gold max consecutive teaching run is 6. Engine board: 16
  lanes over span 8 (max 10), one run of 7. Both new teacher rules are gold-safe and
  discriminating.
- **Completeness ground truth**: `loadCohortCourses` (`src/shared/api/load-cohort-courses.ts:61`)
  drops the 4-hour Chemistry SL base (0 direct enrolments); the overlap fold only pushes students
  onto the base, never hours onto the dependent. 4 of the engine's 5 unplaced hours are this
  projection gap, not a search failure. The bench loader (`bench/load-plan-analysis-input.ts`)
  delegates to `loadCohortCourses`, so one fix covers app + engine + analyzer.
- **Pins are universal** (`src/_pages/plan-detail/model/generation/assemble-snapshot.ts:40-53`,
  `generation/types.ts:16-23`): the fixture workflow (pre-pin Advisory / CAS-EE / SSSTS, then
  Generate) needs no engine code. Assembly currently sits in the page layer with page-shaped
  inputs (`SharedBoardProps`, `LocalParkedBundle`) — Phase 1 relocates it to
  `entities/timetable` so the harness shares the exact in-app assembly (portability invariant 3).

## Desired End State

Generating on a catalog-only clone of the golden catalog (with fixtures pre-pinned) produces a
board that:

1. contains zero same-day splits, zero teacher day-lanes with span > 8 or streak > 6 (hard);
2. leaves at most a small hand-finishable unplaced residue (expert: an unplaced hour beats any
   rule violation — R17);
3. scores teacher gaps within ~2× the expert's 74, zero soft-availability hits, day starts at P1,
   free capacity banked at day ends and maximally on Friday;
4. keeps its golden slots (full-coverage cells) centred in the P4–P7 band instead of the day tail;
5. and passes `verifyGeneration` — while the gold board itself still verifies clean against every
   new rule (regression guard).

Verified by: unit suite green in CI; per-phase local analyzer A/B via the one-command experiment
harness (Phase 1) against the run-1 baselines; final R18 acceptance checklist recorded in the
change folder.

### Key Discoveries:

- `compareObjectives` iterates `a.length` (`objective.ts:35-40`) — tuple can grow phase by phase;
  only tests that pin tuple shapes need same-commit updates (`objective.test.ts`,
  `quality-bar.test.ts`).
- `course-day-stacking` is the exact template for "warn in UI, generator-hard": warn-kind
  violation + `citesGeneratedDay` escalation in `verify.ts:119-125` + `dayCount` guard in
  `board.ts:112`. Both new hard rules follow it.
- The 2/day cap means the no-split `fitsAt` guard degenerates to a single adjacency check: a
  second same-day hour must land adjacent to the first (a third is already rejected by the cap).
- `board.ts`'s `teacherAt` index is global across cohorts — the teacher-day guard reads both
  cohorts for free, matching the teacher-lens premise (16 of 17 teachers teach both).
- Golden cells are *found, not manufactured* (G2): cover-set detection over `studentKeys` is a
  construction anchor; the objective only protects band position of golden cells that exist,
  never rewards count (the price question went unanswered — encode as free bonus).
- Gold's Chemistry hours live on the HL dependent (6 rows), so after the projection fix the gold
  board's completeness report will read "base −4 / HL +4" — an attribution artifact to document,
  not a regression (the engine's own boards will be truthful).

## What We're NOT Doing

- **R15** — disjunctive ("first 4 XOR last 4") and frequency-capped positive teacher preferences:
  future data-model change.
- **R12** — flagged-first construction reordering: the pre-pin workflow covers it; revisit only if
  post-fix measurement still shows completeness gaps.
- **Golden-slot count maximization** or paying any higher tier for a golden slot (G2's price
  sub-question unanswered — free-bonus semantics only).
- **Blocking-severity UI enforcement** of the new rules — warn only (stacking precedent).
- **Building the CP-SAT engine** (full solve or residual-repair hybrid) — still deferred; but this
  change actively preserves the port for it (see the portability invariants in Implementation
  Approach), and any phase that would force quality or rule logic into `engines/greedy/` must
  restructure instead.
- Hard per-teacher weekly window cap (5.7: none exists) · subject-heaviness labels / T3 metrics
  (R13 refuted) · anti-batching / switch-weave / spread terms (R14 emergent) · multi-year
  gold-plan import (F3) · an "all teachers free during Advisory" verify rule (pre-pin makes it
  moot for generation; noted as a known gap for manual edits) · the 9.2 live walkthrough (open
  with the expert, blocks nothing here).

## Implementation Approach

Seven phases, each independently shippable and measurable. Completeness truth first (Chemistry),
then hard rules (they reshape the feasible space), then objective tiers in confirmed order, then
golden slots, then acceptance. The final tuple:

```
Objective = [
  unplacedTotal,      // 1  completeness                      (unchanged)
  holes,              // 2  cohort interior holes             (unchanged)
  totalSlots,         // 3  slot count — confirmed dominant   (R4)
  teacherHoles,       // 4  NEW — teacher gap-slots           (R5, above softHits per G4)
  softHits,           // 5  NEW — soft-availability hits      (R6)
  studentHoles,       // 6  student gap-slots                 (unchanged position)
  doublesDeficit,     // 7  NEW — avoidable singles           (R7)
  lateStarts,         // 8  NEW — day-start offsets           (R8)
  fridayTail,         // 9  NEW — last-day tail load          (R8)
  goldenBandDistance, // 10 NEW — golden cells off P4–P7      (R20, free bonus)
]
```

Hard rules (never in generated output, warn for hand edits): **R1** no same-day split (lunch =
any break, per week-lane); **R2a** teacher day span ≤ 8; **R2b** teacher consecutive teaching ≤ 6
(user-confirmed: "max 6 in a row", matching gold's revealed practice).

All new counting functions follow the `lanes.ts` week conventions (a `both` row fans into both
lanes), mirroring `countStudentHoles`.

**Engine portability (CP-SAT readiness).** A second engine (CP-SAT full solve, or the archived
hybrid idea — CP-SAT as an exact residual-repair operator) remains a live follow-up, and nothing
in this change may narrow the `GeneratePlan` port. Three invariants keep it open:

1. **Quality is defined only in engine-agnostic modules** — every new tier is a pure function in
   `objective.ts` over `(snapshot, placements)`; no engine-private scoring anywhere.
2. **Hard rules are single-sourced in the oracle** (collision registry + `verifyGeneration`
   escalation). `fitsAt` is greedy's fast *mirror* of the oracle, never the definition — a future
   engine encodes the same rules as native constraints and is re-judged by the same verify.
3. **Shared derivations live outside `engines/greedy/`** — golden cover-set detection is a pure
   snapshot derivation and lands beside `objective.ts`, not in greedy's `problem.ts` (Phase 6);
   greedy consumes it like any engine would.

## Critical Implementation Details

- **`fitsAt` must stay at least as strict as verify's escalation for generated rows.** The
  "constructed board is always valid" floor is an *assumption, not a check*: constructed boards
  are returned unverified (`search.ts:230`; verify gates only LNS acceptance at `:229`). A
  fitsAt-looser-than-verify gap therefore burns the whole 20 s budget producing candidates and
  surfaces only as a failed final `runVerifiedGeneration` verdict — no in-loop signal. When in
  doubt, make `fitsAt` stricter, never looser, than the verify rule.
- **Verify is the rule definition; `fitsAt` is an optimization.** Write each new hard rule so the
  oracle (constraint file + verify escalation) is complete on its own — a hypothetical engine
  with no `fitsAt` at all must still be correctly judged. This is what keeps the CP-SAT door
  open (see Implementation Approach).
- **Delta-aware semantics, or livelock.** Both new hard-rule guards must reject only placements
  that *create* a violation, tolerating pre-existing pin-caused ones — mirror `flaggedEdgeOk`'s
  delta reading (`board.ts:126-160`) and `citesGeneratedDay` (`verify.ts:119-125`). A board-wide
  reading poisons every placement for that student/teacher-day on a dirty board (the boxing-bug
  lesson).
- **`scoreCandidate` is the LNS hot loop.** Build per-call structures (teacher map, availability
  index, studentsOf) once per call at the top — never inside per-tier counting functions. If the
  generation bench (`pnpm bench:generation`) shows a material rounds/sec drop, lift them into a
  `createScorer(snapshot)` closure; don't pre-build that abstraction otherwise.
- **Tuple shape changes ripple into tests, not the comparator.** Each tier-adding phase updates
  `objective.test.ts` / `quality-bar.test.ts` fixtures in the same commit; `compareObjectives`
  and the LNS acceptance test need nothing.
- **Golden-set detection must require pairwise student-disjointness AND distinct teachers** within
  a set (the expert's TOK+TOK precondition). Detection runs once per generate call in
  `buildProblem` (n≈40 courses — negligible).
- **Migration stage friction is expected.** `migrateHolesToEdges` moves one cell at a time; moving
  half of a double will now be rejected by the split guard. That is correct (hard rule beats
  tier-2 holes) — do not special-case it.

## Phase 1: One-Command Experiment Harness

### Overview

Automate the measurement loop before touching the engine: one command runs
clone-catalog-only → pin the fixture skeleton → generate → verify → persist → analyze
side-by-side vs the golden plan. First relocate snapshot assembly from the page layer to
`entities/timetable` so the harness runs the app's exact assembly rather than a copy. Every later phase's gate runs through it; nobody clicks
through the app, and pinning errors become impossible. Its own acceptance is reproducing the
run-1 numbers before any engine change.

### Changes Required:

#### 1. Relocate snapshot assembly to the entity layer

**File**: `src/entities/timetable/model/generation/assemble-snapshot.ts` (moved from
`src/_pages/plan-detail/model/generation/`, test moves with it) + call-site adaptation in
`plan-detail`

**Intent**: One shared assembly source, so harness boards are indistinguishable from in-app
generations *by construction*, not by convention — and snapshot assembly joins the other
engine-agnostic generation modules (portability invariant 3). No bench file imports from
`_pages/**` today; this move keeps it that way.

**Contract**: Restate the inputs in entity-level terms (grid, availability, per-cohort courses /
placements / parked course ids) instead of the page board-state shapes (`SharedBoardProps`,
`LocalParkedBundle`); `plan-detail` adapts its live board state at the call site. Stays pure
(type-only imports); `pnpm steiger` gates the layer move; behavior unchanged — the existing
`assemble-snapshot.test.ts` passes after the move.

#### 2. Experiment harness script

**File**: `bench/generation-experiment.ts` (new) + `vitest.experiment.config.ts` +
`package.json` script (e.g. `pnpm experiment:generation`)

**Intent**: One command against local Supabase: clone the source plan catalog-only
(`clone_plan(id, label, false)`), optionally copy the fixture skeleton from the source board,
assemble the snapshot (the clone's placements become pins), run the default-tuned greedy engine
at the app's 20 s budget, gate on `verifyGeneration`, persist via the existing
`apply_generated_placements` RPC so the board is viewable in-app (needed for the expert
walkthrough), then run the analyzer and print the comparison vs the source plan.

**Contract**: Follows the bench convention (vitest as the script runner; plans addressed by id,
never name — the loader lesson). Inputs via env: `SOURCE_PLAN_ID`, `LABEL`, `PIN_SKELETON=1`.
Reuses only existing RPCs and the relocated `assembleSnapshot` from `@/entities/timetable`
(change 1), fed from DB rows (clone placements → pins verbatim), so harness boards are
indistinguishable from in-app generations. Dev tooling — Workers-runtime constraints do not
apply to `bench/`.

#### 3. Fixture-skeleton copy by course identity

**File**: `bench/fixture-courses.ts` (new, config) + copy logic in the harness

**Intent**: Pin the skeleton by *copying the source board's placements* for the configured
fixture courses (Advisory, CAS, EE, SSSTS). Two-part split, deliberately: fixture **positions**
are never hardcoded (always copied from the source board — a moved Advisory costs zero edits);
the fixture **roster** is a curated name list, because auto-detection is untrustworthy (the
mirrored-cell census over-claimed — Polish A was a coincidence, R11; a human must confirm, and
the list is that confirmation recorded once) and no existing data field selects the set
(`finishes_early` doesn't match it). Clones mint new course ids, so identity maps via
`(cohort, name, level, group_index)`.

**Contract**: Config is a plain name list in `bench/` dev tooling only — the engine and app
never see a "fixture" concept, just pins (labels-as-config before labels-as-schema, the D4
lesson; an `is_fixture` domain concept is a possible future change once the workflow proves
out). The copy fails loudly when an identity is ambiguous or a fixture course is missing from
either plan — never silently pins a partial skeleton. Identity-mapping/skeleton-copy unit tests
live as `bench/*.test.ts`, and `vitest.config.ts`'s unit project include gains
`bench/**/*.test.ts` in the same commit — today only `src/**/*.test.ts` is collected, so without
the include these tests would run under no config and 1.1 would pass vacuously. Containment: the
suffix convention keeps every DB-touching bench entry point (`*.bench.ts` / `*.analyze.ts` / the
new `*.experiment.ts`) invisible to this glob, and bench `.test.ts` files must stay pure
(no Supabase, no env) — the unit project has no `load-test-env` setup, so a DB-reaching test
fails loudly in CI rather than being quietly absorbed into `pnpm test`.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes (identity-mapping and skeleton-copy unit coverage)
- `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual Verification:

- Harness re-analysis of the existing Golden Catalog Clone board matches the run-1 tables
  (pure re-analysis — proves the analyzer path is wired correctly)
- A `PIN_SKELETON=1` run produces a clone whose pinned cells exactly match the golden board's
  skeleton cells, and generation leaves them untouched (pins are immovable)
- A fresh unpinned generation lands within the run-1 story (same catalog, same engine)

**Implementation Note**: After this phase, every later gate is
`pnpm experiment:generation` + reading the printed comparison. Pause for manual confirmation
before Phase 2.

---

## Phase 2: Chemistry Completeness Fix

### Overview

Fix the projection so a combined-session overlap base with zero direct enrolments survives when
its dependents are enrolled — the engine's catalog then demands the 6 taught Chemistry hours
instead of 2. Re-baseline the analyzer numbers afterward.

### Changes Required:

#### 1. Projection keeps live overlap bases

**File**: `src/shared/api/load-cohort-courses.ts`

**Intent**: Keep a course with no direct `student_choices` when at least one of its overlap
dependents has students — the existing fold (`:67`) already unions the dependents' students onto
the base, so a kept base projects with the right roster and its own `hours_per_week`. This
generalizes to any future year: overlap rows exist ⇒ combined teaching; a split year has no
overlap rows and no behavior change.

**Contract**: The `regularCourses` filter (`:61`) becomes "has direct choices OR has ≥1 dependent
with direct choices", still excluding merge parents. `collectWarnings` must not emit
`no-students` for such a base (its `studentKeys` are non-empty via the fold). No type changes —
`GroupingCourse` and the catalog hash are untouched.

#### 2. Regression coverage for the projection

**File**: `src/test/factories/` + a co-located or integration test beside the loader

**Intent**: Pin the new topology: base(4 h, 0 direct) + dependent(2 h, 9 students) projects to two
courses sharing the same 9 `studentKeys`; a base with zero-enrolment dependents stays dropped;
merge topologies are unchanged.

**Contract**: `pnpm test:integration` exercises the real loader against local Supabase using the
factory builders (the suite's convention — build state, assert, teardown).

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes
- `pnpm test:integration` passes (new projection cases included)
- `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual Verification:

- Harness run (unpinned): unplaced drops from 5 to ≤ 1 (the dp2 EE hour may remain until
  fixtures are pinned)
- Harness comparison: gold board's completeness shows the expected attribution shift
  (Chemistry SL base −4 / HL +4) and nothing else moves

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 3: Hard Rules — No Same-Day Split + Teacher Day Span/Streak

### Overview

Add the two expert-inviolable rules as warn-level collision constraints (visible during manual
editing), escalate them to blocking for generated placements in `verifyGeneration`, and guard
them delta-aware in `board.fitsAt` — the exact `course-day-stacking` template.

### Changes Required:

#### 1. Same-day-split constraint

**File**: `src/entities/timetable/model/collision/constraints/course-day-split.ts` (new) +
`index.ts` registration

**Intent**: R1 — a course's hours within one (day, week-lane) must be consecutive; the lunch
break counts like any break. Day-scoped via `ctx.dayOccupancy` like `course-day-stacking`.

**Contract**: New violation kind `course-day-split` carrying `courseIds` (generic consumers walk
`courseIds` — no UI changes needed beyond severity mapping). For each distinct occupant course
and each concrete week the cell runs: if the course occupies ≥ 2 periods that day-lane and they
are not consecutive, emit one violation. Warn severity wherever kinds map to severities (mirror
`course-day-stacking`'s classification).

#### 2. Teacher day-shape constraint

**File**: `src/entities/timetable/model/collision/constraints/teacher-day-shape.ts` (new) +
`index.ts` registration

**Intent**: R2a/R2b — a teacher's working day (both cohorts merged) must span ≤ 8 periods and
contain no run of 7+ consecutive teaching periods.

**Contract**: New warn-kind `teacher-day-shape` carrying `teacherKey` + `courseIds` (the cell's
courses taught by that teacher). Teacher day periods = own-cohort periods (via `ctx.dayOccupancy`
+ `catalogById` teacherKeys) ∪ sibling-cohort cells (via `ctx.occupiedByTeacher`), per week-lane.
Violation when span > 8 or maxStreak > 6.

**Registration surface (both new kinds — five points, two silent traps)**: (1) the kind union
(`constraints/types.ts:15-22`); (2) the `CELL_CONSTRAINTS` registry (`constraints/index.ts:12-20`);
(3) the `violationSeverity` mapping (`collisions.ts:133-138`) — **trap: unlisted kinds default to
`block`**, which would make these rules block manual editing against this plan's warn-only scope;
(4) `CollisionDetailsDialog`'s kind record + switch — the only compile-gated point, it fails the
build until registered; (5) kind-scoped escalation in `verify.ts:83-95` — **trap: the `else`
branch treats unlisted kinds as blocking board-wide, pins included** (the livelock case), so each
kind needs its explicit generated-participation handler (change 3 below).

#### 3. Verify escalation for generated placements

**File**: `src/entities/timetable/model/generation/verify.ts`

**Intent**: Both new warn kinds fail verification when a generated placement participates —
pin-only violations stay permitted (delta semantics), mirroring `citesGeneratedDay`.

**Contract**: `judgeMergedBoards` escalates `course-day-split` when the cited course has a
generated placement that day, and `teacher-day-shape` when the cited teacher teaches any
generated placement that day. Reasons name the rule; `softWarnCount` semantics unchanged.

#### 4. Search-time guards

**File**: `src/entities/timetable/model/generation/engines/greedy/board.ts`

**Intent**: `fitsAt` rejects placements that would create either violation, so every stage and
LNS repair respects the rules by construction.

**Contract**: Two additions to the feasibility pass, both delta-aware (reject only newly-created
violations; a pre-existing pin-caused violation must not poison unrelated placements — mirror
`flaggedEdgeOk`):
- *Split guard*: if the course already occupies a period that day-lane, the candidate period must
  be adjacent to it (the 2/day cap makes >1 existing generated period impossible). Needs a
  course-day-period lookup — either a new `dayPeriods` index maintained in `index`/`unindex`
  beside `dayCount`, or a bounded scan; implementer's choice.
- *Teacher guard*: for each teacher of the course and each concrete lane of the candidate week,
  the teacher's day periods (from the global `teacherAt` axis or a parallel per-day index) with
  the candidate added must keep span ≤ 8 and maxStreak ≤ 6.

#### 5. Unit tests

**File**: co-located `*.test.ts` beside each new/changed module

**Intent**: Constraint fixtures (split across lunch, biweekly lanes counted separately, pin-only
tolerance), fitsAt delta cases (adjacent second hour OK, gapped second hour rejected; span-8 pin
day not poisoned; 7th consecutive rejected), verify escalation cases.

**Contract**: Follow `course-day-stacking.test.ts` and `verify.test.ts` shapes. `engine-fuzz`
must stay green — constructed boards satisfy the new rules by construction.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes (new constraint + board + verify cases; fuzz green)
- `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual Verification:

- Harness run: analyzer shows sameDaySplits = 0, teacher spans ≤ 8, max streak ≤ 6
- Gold board still verifies clean (`verify-gold` convention via `pnpm analyze:plans`)
- Unplaced residue noted — if it rises above ~2, record which courses before proceeding
- Manual editing: placing a split shows a warning, does not block

**Implementation Note**: Pause for manual confirmation (analyzer numbers) before Phase 4.

---

## Phase 4: People Tiers — teacherHoles + softHits

### Overview

Insert the two confirmed people tiers into the objective so the search optimizes teacher
compactness and soft-availability avoidance: tiers 4 and 5, both below `totalSlots` (5.2/5.3),
teacher above soft (G4), both above `studentHoles` (5.4).

### Changes Required:

#### 1. Counting functions + tuple growth

**File**: `src/entities/timetable/model/generation/objective.ts`

**Intent**: Add `countTeacherHoles` (lane-expanded span−count per (teacher, day, week-lane) over
the merged pins+generated rows of BOTH cohorts — teacher days span cohorts) and `countSoftHits`
(one hit per (row, teacher) landing on a soft-unavailable cell, week-agnostic per row — the
teacher-lens convention). Extend `Objective` to
`[unplacedTotal, holes, totalSlots, teacherHoles, softHits, studentHoles]`.

**Contract**: `scoreCandidate` computes both from the snapshot it already receives
(`snapshot.availability` carries soft rows; courses carry `teacherKeys`). Per-call structures
built once at the top of `scoreCandidate` (see Critical Implementation Details). Teacher terms
are board-wide, not per-cohort — computed outside the cohort loop.

#### 2. Test updates

**File**: `objective.test.ts`, `quality-bar.test.ts`, any fixture pinning 4-tuples

**Intent**: Grow expected tuples; add cases proving a soft hit and a teacher hole each cost
exactly one tier step and never outbid a slot.

**Contract**: Same-commit update; `compareObjectives` and search code need no change.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes with 6-tuple fixtures
- `pnpm bench:generation` shows no material throughput regression (LNS rounds/sec)
- `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual Verification:

- Harness run: teacher gap-slots drop from ~345 toward ≤ 148 (2× expert's
  74); softAvailabilityHits = 0; totalSlots does not increase vs the Phase 3 run
- studentHoles may drift up slightly (it now yields to teacher terms) — confirm it stays within
  the expert's revealed band (≤ ~10/student/week, 5.8)

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Shape Tiers — doublesDeficit + lateStarts + fridayTail

### Overview

Add the three bottom shape tiers in the confirmed order (doubles → day-shape → Friday tail),
encoding the expert's deliberate doubles-seeking, days-start-at-P1, and short-Friday policies.

### Changes Required:

#### 1. Three counting functions + tuple positions 7–9

**File**: `src/entities/timetable/model/generation/objective.ts`

**Intent**: Encode R7 + R8 as minimizable counts:
- `doublesDeficit` — avoidable singles: per (course, week-lane), `singles − (laneHours mod 2)`
  clamped at 0, summed; a single is a day-lane holding exactly one period of the course. The
  expert's no-doubles exceptions (CAS/EE 1-hour biweekly, the odd TOK hour, splittable languages)
  need no flags — a 1-hour lane's single is its own minimum, and odd-hour courses get one free
  single.
- `lateStarts` — Σ over (cohort, day, week-lane) of (first occupied period − 1). Gold = 0.
- `fridayTail` — Σ over (cohort, week-lane) of the last occupied period on the final grid day.
  Minimizing pulls the week's tail free capacity onto Friday's end (slot-neutral moves, so tier 3
  never resists).

**Contract**: Tuple grows to 9; all three follow `lanes.ts` week-fan conventions and count over
pins+generated per cohort (lateStarts/fridayTail) or per course (doublesDeficit). Tests updated
same-commit.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes with 9-tuple fixtures
- `pnpm bench:generation` still no material regression
- `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual Verification:

- Harness run: day-start free slots = 0; Friday is the earliest-ending day;
  adjacentPairs rises materially toward gold's 226 and multi-day courses fall toward gold's 41;
  no regression in tiers 1–6 numbers

**Implementation Note**: Pause for manual confirmation before Phase 6.

---

## Phase 6: Golden Slots — Census, Detection, Band Anchor, Bottom Tier

### Overview

R19–R21: measure golden/near-golden coverage in the analyzer, detect cover sets from enrollment
in the problem projection, seed them into the P4–P7 band during construction, and protect their
band position with the final (free-bonus) objective tier.

### Changes Required:

#### 1. Analyzer golden census (R21)

**File**: `src/entities/timetable/model/analysis/slot-census.ts` (+ `types.ts`, report printing
in `bench/plan-quality.analyze.ts`)

**Intent**: Per week-lane cell coverage census: golden = distinct enrolled students of the lane's
occupants == cohort size; near-golden = missing ≤ 10% (G1). Report count, mean period of golden
cells, share inside P4–P7, and composite (≥ 3 courses) count — the run-1 addendum table,
reproducible by command.

**Contract**: Extends `SlotCensusFeatures` additively (existing metrics untouched). Baseline
targets from the addendum: gold 15 golden cells / mean period 4.6–5.75 / 10 of 15 in band.

#### 2. Cover-set detection (R19)

**File**: `src/entities/timetable/model/generation/golden-sets.ts` (new, engine-agnostic —
beside `objective.ts`) + `engines/greedy/problem.ts` (consumption)

**Intent**: Detect golden/near-golden cover sets per cohort: greedy disjoint-union search over
non-flagged, `both`-week courses (pairwise student-disjoint, pairwise distinct teachers), keeping
sets with roster-union coverage ≥ 90% of the cohort. Biweekly-pair completion (the CAS/EE
composite) is out of scope — the fixtures cover it via pins. Lives at the engine-agnostic level
because it is a pure snapshot derivation any engine (including a future CP-SAT) would consume —
the portability invariant from Implementation Approach.

**Contract**: Exported `deriveGoldenSets(courses: GroupingCourse[]): Set<string>[]` (course-id
sets, best coverage first); greedy's `buildProblem` calls it into a per-cohort
`Problem.goldenSets`. No snapshot/type changes; `GeneratePlan` port untouched.

#### 3. Band-anchor construction stage (R20)

**File**: `src/entities/timetable/model/generation/engines/greedy/stages.ts` +
`search.ts` (stage call)

**Intent**: Before the backbone, best-effort place each detected set as complete cells inside the
P4–P7 band (doubles where hours allow, respecting `fitsAt` — which now enforces adjacency and
teacher shape). Skip on any infeasibility: golden slots are found, never forced (G2), and must
cost nothing the higher tiers care about.

**Contract**: A new stage function (construction only, never LNS — mirror `constructBackbone`'s
gating) that decrements `remaining` via the normal `placeDeficit` path. Backbone and later stages
run unchanged over whatever remains.

#### 4. goldenBandDistance tier (tier 10)

**File**: `src/entities/timetable/model/generation/objective.ts`

**Intent**: Protect band position through LNS: for each golden lane-cell (full coverage), add its
distance to the P4–P7 band (0 inside). Count-neutral — the tier never rewards *more* golden cells,
only well-placed existing ones.

**Contract**: Tuple grows to 10. Coverage computed from the per-call `studentsOf` structure;
tests updated same-commit.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes (census, detection — disjointness + distinct-teacher preconditions, stage,
  tier fixtures)
- `pnpm bench:generation` still acceptable
- `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual Verification:

- `pnpm analyze:plans` on the gold board reproduces the addendum census (15 / mean 4.6–5.75)
- Harness run: golden cells ≥ 13 with mean period inside P4–P7 and band share
  ≥ ⅔ (gold: 10/15); tiers 1–9 numbers hold

**Implementation Note**: Pause for manual confirmation before Phase 7.

---

## Phase 7: Acceptance Run + Fixture Workflow Runbook

### Overview

Document the pre-pin workflow the expert accepted (4.5/10.2), run the full acceptance experiment,
and record the R18 verdict in the change folder.

### Changes Required:

#### 1. Plan-generation runbook

**File**: `docs/runbooks/plan-generation.md` (new)

**Intent**: The expert-facing workflow: clone catalog-only → hand-place the fixture skeleton
(Advisory Wed P7 both cohorts — leadership-fixed, all-teachers-free slot; the CAS/EE paired
cells under the finish-early rule; SSSTS per teacher SD's availability at student-day edges) →
Generate (20 s budget) → hand-repair the residue. Include the fixture table from the expert's
answers and the acceptance bar (anything under ~40 h of manual work wins — R18).

**Contract**: Follows `author-provisioning.md`'s runbook shape; states the known gap (a manual
edit violating the Advisory all-teachers convention only warns). Includes a pre-generation data
checklist using existing fields only — `finishes_early` set on every mid-year-ending course
(SSSTS, TOK, CAS/EE; the research flags this as verify-by-query for the imported catalog) and
availability rows current — no schema or catalog-page changes anywhere in this plan.

#### 2. Acceptance measurement

**File**: `context/changes/generation-quality-tuning/analysis-run-2.md` (new, local numbers only
— no student/teacher names, per the no-prod-data rule)

**Intent**: The definition of done: a `PIN_SKELETON=1` harness run compared against run-1;
record the R18 checklist — 0 splits, span/streak clean, fixtures respected, Friday shortest,
golden band mid-day, teacher gaps ≤ 2× expert, soft hits 0, unplaced residue ≤ small
hand-finishable count, gold board verifies clean.

**Contract**: Table mirrors analysis-run-1's scoreboard so the two are diffable side by side.

### Success Criteria:

#### Automated Verification:

- `pnpm check && pnpm test && pnpm lint && pnpm steiger && pnpm build` clean (full `/verify` gate)

#### Manual Verification:

- R18 checklist green in analysis-run-2.md
- Expert eyeball (or the deferred 9.2 walkthrough) on the final board — informative, not blocking

---

## Testing Strategy

### Unit Tests:

- New constraint files: split across lunch, biweekly lanes independent, pin-only tolerance;
  teacher span/streak boundaries (8/8-exact OK, 9 rejected; 6-run OK, 7-run rejected)
- `fitsAt` delta guards: newly-created vs pre-existing violations (the livelock cases)
- Objective counting functions: each tier's unit semantics + one-tier-step ordering proofs
- Cover-set detection: disjointness, distinct-teacher precondition, threshold boundary (missing
  ≤ 10%)
- Existing fuzz/smoke/quality-bar suites stay green (tuple fixtures updated per phase)
- `engine-fuzz` additionally asserts `verifyGeneration(...).ok` on constructed boards — any
  future fitsAt-looser-than-verify gap becomes a unit failure instead of a burned-budget mystery
  (constructed boards are returned unverified in production, `search.ts:230`)

### Integration Tests:

- Projection: overlap base with 0 direct + enrolled dependents survives; zero-enrolment
  dependents don't resurrect a base; merge topologies unchanged

### Manual Testing Steps:

1. Per phase 2–6: one harness command (`pnpm experiment:generation`, local only; golden data is
   gitignored PII) — it clones catalog-only, optionally pins the skeleton (`PIN_SKELETON=1`),
   generates, verifies, persists, and prints the comparison vs run-1 tables. Catalog-only clones
   inherit every catalog setting — courses + `finishes_early` flags, teachers, choices,
   overlaps, availability — so no data hygiene is ever needed on a clone (verified by query
   2026-07-13: dp2 TOK/CAS/EE flagged, dp1's year-long editions and SSSTS/Advisory unflagged,
   consistent with the oracle-passing gold board). Skeleton pinning is automated by identity-
   mapped copy from the golden board — no hand-placement anywhere in the loop. Phase gates
   2–6 may run unpinned (dp2 EE expected unplaced until pinned); run both variants when cheap.
2. Gold-board verify regression after each hard-rule/tier change
3. Phase 7 acceptance = a `PIN_SKELETON=1` harness run (the runbook's hygiene checklist targets
   future fresh catalogs, not golden clones)

## Performance Considerations

- **UI drag-drop < 200 ms**: both new constraints are day-scoped and index-backed
  (`dayOccupancy`, `occupiedByTeacher`) — same cost class as `course-day-stacking`.
- **Engine hot paths**: `fitsAt` additions are bounded map lookups (periods ≤ 12 × teacherKeys);
  `scoreCandidate` grows ~2× in work — per-call structures built once, `pnpm bench:generation`
  guards throughput each tier phase. The 20 s budget and stagnation window stay untouched.
- **Detection**: once per generate call over ~40 courses — negligible.

## Migration Notes

No schema migrations. The Chemistry fix is code-only (the hosted catalog stays as recorded —
correct per E1: hours belong on the courses as the school records them; the projection owns the
combined-session reading). Gold-board completeness reports shift attribution (base −4 / HL +4)
after Phase 2 — documented, expected, local-only.

## References

- Research + expert elicitation digest: `context/changes/generation-quality-tuning/research.md`
  (rules R1–R21, G1–G4, revised objective picture)
- Expert answers verbatim: `context/changes/generation-quality-tuning/expert-questions.pl.md`
- Run-1 baselines: `context/archive/2026-07-12-plan-quality-analyzer/analysis-run-1.md`
- Hard-rule template: `src/entities/timetable/model/collision/constraints/course-day-stacking.ts`
  + `src/entities/timetable/model/generation/verify.ts:119-125`
- Delta-semantics precedent: `src/entities/timetable/model/generation/engines/greedy/board.ts:126-160`
- Lane conventions: `src/entities/timetable/model/analysis/lanes.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: One-Command Experiment Harness

#### Automated

- [x] 1.1 `pnpm test` passes (identity-mapping and skeleton-copy coverage)
- [x] 1.2 `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual

- [x] 1.3 Harness re-analysis of the existing Golden Catalog Clone matches run-1 tables
- [x] 1.4 `PIN_SKELETON=1` run pins exactly the golden board's skeleton cells; generation
      leaves them untouched
- [x] 1.5 Fresh unpinned generation lands within the run-1 story

### Phase 2: Chemistry Completeness Fix

#### Automated

- [ ] 2.1 `pnpm test` passes
- [ ] 2.2 `pnpm test:integration` passes (new projection cases included)
- [ ] 2.3 `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual

- [ ] 2.4 Harness run (unpinned): unplaced 5 → ≤ 1
- [ ] 2.5 Analyzer shows only the expected gold attribution shift

### Phase 3: Hard Rules — No Same-Day Split + Teacher Day Span/Streak

#### Automated

- [ ] 3.1 `pnpm test` passes (constraints, fitsAt deltas, verify escalation, fuzz green)
- [ ] 3.2 `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual

- [ ] 3.3 Harness run: sameDaySplits = 0, spans ≤ 8, streaks ≤ 6 on generated board
- [ ] 3.4 Gold board verifies clean against the new rules
- [ ] 3.5 Unplaced residue recorded (courses named if > ~2)
- [ ] 3.6 Manual-edit split shows warning, not block

### Phase 4: People Tiers — teacherHoles + softHits

#### Automated

- [ ] 4.1 `pnpm test` passes with 6-tuple fixtures
- [ ] 4.2 `pnpm bench:generation` shows no material throughput regression
- [ ] 4.3 `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual

- [ ] 4.4 Harness run: teacher gaps → ≤ 148, softHits = 0, totalSlots not worse
- [ ] 4.5 studentHoles stays within the expert's revealed band

### Phase 5: Shape Tiers — doublesDeficit + lateStarts + fridayTail

#### Automated

- [ ] 5.1 `pnpm test` passes with 9-tuple fixtures
- [ ] 5.2 `pnpm bench:generation` still acceptable
- [ ] 5.3 `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual

- [ ] 5.4 Harness run: lateStarts = 0, Friday earliest-ending, adjacency/multi-day move toward
      gold, tiers 1–6 hold

### Phase 6: Golden Slots — Census, Detection, Band Anchor, Bottom Tier

#### Automated

- [ ] 6.1 `pnpm test` passes (census, detection, stage, 10-tuple fixtures)
- [ ] 6.2 `pnpm bench:generation` still acceptable
- [ ] 6.3 `pnpm check && pnpm lint && pnpm steiger && pnpm build` clean

#### Manual

- [ ] 6.4 Gold census reproduces the addendum table (15 golden / mean 4.6–5.75)
- [ ] 6.5 Harness run: golden ≥ 13, mean period in P4–P7, band share ≥ ⅔, tiers 1–9 hold

### Phase 7: Acceptance Run + Fixture Workflow Runbook

#### Automated

- [ ] 7.1 Full `/verify` gate clean

#### Manual

- [ ] 7.2 R18 checklist green in `analysis-run-2.md` (from a `PIN_SKELETON=1` harness run)
- [ ] 7.3 Runbook `docs/runbooks/plan-generation.md` reviewed against the expert's fixture answers
