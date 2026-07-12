# Generation Engine Hardening & Search Upgrades — Implementation Plan

## Overview

Harden the shipped GRASP generation engine (`src/entities/timetable/model/generation/engines/greedy.ts`) and upgrade its search loop. The work fixes one confirmed correctness bug (flagged-row boxing → wholesale verify rejection), repairs three design flaws (score tier bleed, missing intra-attempt best tracking, cancel/progress dead zone), and converts the post-first-solution budget into real quality via LNS destroy-and-repair with a provable lower bound and stagnation-based early stop. The `GeneratePlan` port shape, worker protocol message kinds, apply path, and `verifyGeneration` contract all stay intact.

## Current State Analysis

The engine is a GRASP over a conflict-clique backbone (see `change.md` of `plan-generation`, Phase 2 verdict): each attempt lays a near-max-weight clique one-hour-per-cell, packs remaining deficits into used cells, repairs stragglers with depth-bounded ejection chains, places `finishes_early` courses edge-or-unplaced, spills residue, then descends on slot count and migrates interior holes to day edges. Attempts restart with fresh randomization until the 20 s budget; the best scalar score wins. The worker (`generate.worker.ts`) runs engine + verify off the main thread; the hook (`use-generate-plan.ts`) applies verified results atomically.

Defects found in the 2026-07-12 review (all confirmed against code; #1 reproduced empirically):

1. **Flagged-row boxing** — the edge rule is checked only for the course being placed (`fitsAt`, `greedy.ts:286-290`). Stages 1–3 and 5 (`feasibleWeek`-only paths, e.g. spill at `greedy.ts:417`), chain relocations (stage 3/6), and stage-7 migrations can all place non-flagged courses on both sides of a flagged row for a shared student. Stage 7's `flaggedEdgesHold` (`greedy.ts:534-540`) iterates `generated` only — flagged **pins** are invisible even there. `early-finish-edge` is a blocking violation kind, so `verifyGeneration` rejects the entire result. The objective has no flagged term, so a boxed board and a valid board score identically and strict `<` (`greedy.ts:38`) keeps deterministic attempt 1. Reproduced: flagged pin at (1,2), 1×4 grid, two single-hour same-student courses → engine packs periods 3 and 1, reports `unplaced: []`, verify rejects.
2. **Score tier bleed** — `unplaced*1e6 + holes*1e4 + slots*100 + studentHoles` (`greedy.ts:574`) only respects the documented tiers if `studentHoles < 100`; it is summed over student-day-week lanes across both cohorts and realistically reaches the hundreds, so compactness can outvote a whole slot.
3. **No intra-attempt best tracking** — the board is scored once at attempt end (`greedy.ts:543`). Stage-6 emptying an interior cell trades −1 slot (100 pts) for a possible new interior hole (10 000 pts); stage 7 repairs only via same-day edge-cell moves into the **first** interior hole (`greedy.ts:489`) and can fail, so descent can return a net-worse board than construction built.
4. **Cancel/progress dead zone** — `runAttempt` is synchronous; the only `await` is between attempts (`greedy.ts:33`). Attempt 1's descent deadline is `start + 0.4 × budget` (`greedy.ts:30`) and the descent loop deliberately spins until it. The worker's `cancel` message cannot be dispatched while the thread is blocked, so "Stop & keep" stalls ~8 s at a 20 s budget and the first progress tick is equally late.
5. **Search-quality leaks** — restarts rebuild from scratch (all learned structure discarded); `studentHoles` is never targeted by any move; the greedy clique (`greedy.ts:126-149`) could be exact for a provable bound; dp1 always seeds first (`greedy.ts:51`, stage 1); stage-6 candidate filter (`greedy.ts:431`) admits flagged-containing cells that immediately `break`; unguarded `splice(findIndex)` sites (`greedy.ts:240-243`, 362, 447, 504) silently remove the last element on `-1`; comment/code mismatch at `greedy.ts:179-183` ("one in three" vs `rng() < 0.67`); `sampleEdgeCells` returns exactly one cell.

Test coverage gap: `greedy.test.ts` and the benchmark (`bench/generation.bench.ts`) never exercise a flagged pin on a partially-filled board — the benchmark runs `pins: []`, which is exactly why defect #1 shipped unseen.

## Desired End State

- The engine **never emits a board that `verifyGeneration` rejects** — the flagged-edge invariant holds by construction at every placement site, backed by a seeded fuzz suite using verify as the oracle.
- Generating on a board whose pins already carry blocking violations fails **instantly** with an actionable message instead of burning 20 s and failing verify.
- The objective is a lexicographic tuple — completeness > interior holes > slots > student compactness holds exactly, at any magnitude.
- An attempt can never return a worse board than its constructive stages produced.
- Cancel takes effect and progress ticks flow within ~100 ms at any point in the solve.
- After 2–3 seeded restarts, the remaining budget runs LNS destroy-and-repair on the incumbent, accepting only tuple improvements; the solve stops early when improvement stagnates on a complete zero-hole board; diagnostics report the per-cohort clique lower bound and the stop reason.

Verify: `pnpm check && pnpm lint && pnpm test` green (incl. new regression + fuzz suites); `pnpm bench:generation` still meets dp1 ≤ 50 / dp2 ≤ 48 with zero blocking violations; manual Generate/cancel flows in the UI behave as specified.

### Key Discoveries:

- `early-finish-edge` is blocking in verify — any non-soft, non-stacking violation pushes a rejection reason (`verify.ts:83-95`); the whole result is discarded, never partially applied.
- The core rule compares against *other* courses' periods, week-overlap-aware (`early-finish-edge.ts:45-58`); the engine's `edgeOk` (`greedy.ts:273-284`) already mirrors this shape — the guard extends *who* is checked, not the rule itself.
- The engine's `studentAt` lane index (`cohort|student|day|week → period → courseId`) already contains everything the guard needs — no new index required, lane size ≤ periods (10).
- The hook's error path (`use-generate-plan.ts:114-117`) renders `Generation failed: <message>` inline (`role="alert"`) — the fail-fast precondition can ship over the existing `error` message kind with a distinct message; no protocol change.
- Cancel is delivered as a worker message (`generate.worker.ts:20-25`); it can only be observed at an event-loop turn — yields inside the descent loop are the *only* way to make `signal.aborted` visible mid-attempt.
- `verifyGeneration(snapshot, [])` is a valid pins-only judge call — structural pass iterates generated rows only, oracle pass judges the merged (= pins-only) board.
- Lessons that apply: cite `pnpm check` as the type gate (build/test/lint prove nothing about types); prefer declarative pipelines with named pure helpers when reshaping scoring/search code.

## What We're NOT Doing

- No UI changes beyond the precondition error message text — the summary panel does not yet surface `lowerBound`/`stopReason` (diagnostics-only plumbing; a future change can render them).
- No worker protocol message-kind changes; no `GeneratePlan` port signature changes (diagnostics gain optional fields only).
- No benchmark bar tightening (stays dp1 ≤ 50 / dp2 ≤ 48) and no new bench scenarios — explicitly deselected in planning; revisit after LNS results are measured.
- No relaxation of `verifyGeneration` (pre-existing violations are *not* grandfathered — the fail-fast precondition handles dirty boards).
- No moving or removing pins, no CP-SAT revisit, no COOP/COEP headers.
- No changes to the apply path, undo semantics, or snapshot assembly.

## Implementation Approach

All engine work happens inside `src/entities/timetable/model/generation/` (pure TS, Workers-safe, no new deps). Order is correctness-first: the boxing bug and fail-fast land alone in Phase 1 (independently shippable); Phase 2 makes the objective trustworthy (the tuple comparator is a prerequisite for LNS acceptance in Phase 4); Phase 3 builds the time-sliced yield infrastructure (reused by the LNS loop); Phase 4 restructures the search loop; Phase 5's fuzz harness lands last so it exercises the final engine. Every phase keeps `pnpm test` green and the engine shippable.

## Critical Implementation Details

- **Guard delta semantics.** The flagged-edge guard must reject a placement only when it *newly* violates a flagged row (was edge → becomes interior). A row already interior before the placement must not poison feasibility — otherwise a dirty board that slips past the precondition livelocks every placement for that student-day. Compute "interior after adding p" and compare against "interior before".
- **Yield overhead is real.** `setTimeout(0)` costs ~1–4 ms per turn; descent runs hundreds of iterations. Yield on a time slice (only when ≥ ~25 ms since the last yield), not per iteration, or the descent budget evaporates into timer clamping.
- **LNS state copying.** The incumbent is fully described by `placements[]` + `remaining` map (~250 rows); the mutable indexes (`teacherAt`, `studentAt`, `cellRows`, `dayCount`) are rebuilt from it in O(rows). Destroy/repair operates on a working copy; revert = discard the copy. Never try to incrementally undo a failed LNS round.
- **Attempt-1 determinism is a feature.** Tests and the "deterministic first board" property rely on seed 1 + noise 0. The hybrid loop must keep attempt 1 exactly as deterministic as today (randomized cohort order starts at attempt 2, like the existing edge-cell reservation).
- **Checkpoint copies, not references.** Stage 6/7 mutate `generated` in place (splice + push); the post-stage-5 checkpoint must be a copy (`generated.slice()`), and `scoreCandidate` must run against the copy before descent touches the array.

## Phase 1: Flagged-Edge Placement Guard + Fail-Fast Precondition

### Overview

Fix the confirmed bug: make the flagged-edge invariant hold by construction at every placement site (pins included), and fail fast when the input board is already invalid. Independently shippable.

### Changes Required:

#### 1. Placement guard in the engine

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`

**Intent**: Placing *any* course must not make an existing flagged row (pin or generated) strictly interior for a shared student. Today only the placed course's own edge status is checked; this closes stages 1–3, 5, chain relocations, and stage-7 migrations.

**Contract**: Unify every placement-feasibility path behind one predicate — `feasibleWeek` gains (or is wrapped by) a check that, for each student of the candidate course and each concrete week, walks the student's day lane (`studentAt`), and for every flagged occupant verifies its period stays ≤ min or ≥ max of the lane's other periods *after* adding the candidate period. Delta semantics per Critical Implementation Details (only newly-violated rows reject). All callers — stages 1–5, `chainFit`, `migrateHolesToEdges` — go through the unified predicate. `flaggedEdgesHold` (`greedy.ts:534-540`) becomes redundant and is deleted; the per-placement guard subsumes it and additionally covers pins.

#### 2. Fail-fast precondition in the worker

**File**: `src/_pages/plan-detail/model/generation/generate.worker.ts`

**Intent**: A board whose pins alone already carry blocking violations can never pass verify (the engine cannot move pins) — detect this in milliseconds instead of after a 20 s solve.

**Contract**: Before invoking the engine, run `verifyGeneration(snapshot, [])`; on `ok: false`, post the existing `error` response kind with a distinct, actionable message (e.g. "the board already has blocking violations — resolve them before generating"), and never start the solve. No protocol change; the hook's existing error path renders it.

#### 3. Regression + guard tests

**File**: `src/entities/timetable/model/generation/engines/greedy.test.ts`

**Intent**: Pin the bug class. Port the review's repro (flagged pin at (1,2), 1×4 grid, two single-hour same-student courses) asserting the result is complete *and* verify-accepted; add a case where the flagged course is generated (not pinned) and spill pressure exists; add a case asserting a placement that would box a flagged row is skipped (course lands elsewhere or stays unplaced).

**Contract**: Uses the existing `__fixtures__/builders` (`course`, `placement`) and `syntheticGeneratorSnapshot` patterns; every test asserts `verifyGeneration(snapshot, result.placements).ok === true`.

#### 4. Precondition surface test

**File**: `src/_pages/plan-detail/model/generation/use-generate-plan.test.tsx`

**Intent**: The distinct precondition failure message reaches the author via the inline error path.

**Contract**: Fake-worker test (existing `createWorker` injection) posting the precondition `error`; asserts the message is rendered and the run returns to idle.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Unit suite green incl. new regression tests: `pnpm test`
- Lint passes: `pnpm lint`
- Production build stays clean (worker bundling): `pnpm build`

#### Manual Verification:

- Generate on a board with a flagged pin mid-day (other same-student courses present) completes and applies — no "invalid board" rejection.
- Generate on a board with a deliberate blocking violation (e.g. teacher double-booked via pins) errors instantly with the precondition message; no 20 s wait.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Objective Integrity — Tuple Scoring + Intra-Attempt Best Tracking

### Overview

Make the objective exact (lexicographic tuple, no magnitude bleed) and make attempts monotone (descent can never return a worse board than construction). Also lands the defensive-coding minors that touch the same code paths.

### Changes Required:

#### 1. Lexicographic objective

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`

**Intent**: Replace the weighted scalar with an ordered tuple so completeness > interior holes > slots > student compactness holds at any magnitude.

**Contract**: `Candidate` carries `objective: [unplacedTotal, holes, totalSlots, studentHoles]` (metric computation unchanged — only the aggregation changes); a named pure comparator (`compareObjectives(a, b): number`, exported from the module for direct testing) replaces every `candidate.score < best.score` comparison. Phase 4's LNS acceptance reuses the same comparator.

#### 2. Intra-attempt best tracking

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`

**Intent**: Score the board at the end of construction (post stage 5) and after descent + migration (post stage 7); return whichever is better. Descent becomes improve-or-neutral by construction.

**Contract**: `runAttempt` snapshots `generated` (copy — see Critical Implementation Details; `remaining` is unchanged by stages 6–7) and compares the two scored candidates via `compareObjectives`.

#### 3. Defensive splice guards

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`

**Intent**: The four `splice(findIndex(...), 1)` sites silently remove the *last* element when the row isn't found — today unreachable by invariant, but the invariant spans a stale shuffled copy plus a `visited` set; one refactor away from silent board corruption.

**Contract**: Extract a `removeGeneratedRow(...)`-style helper (and the `cellRows` equivalent) that throws on not-found — the worker's catch path (`generate.worker.ts:45-47`) already surfaces engine errors as a clean failure instead of corrupt output.

#### 4. Comment/naming fixes

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`

**Intent**: Truth in documentation. Fix the "one restart in three reserves" comment vs `rng() < 0.67` (two in three); rename `sampleEdgeCells` → singular (it returns exactly one cell).

**Contract**: Comment + identifier only; no behavior change.

#### 5. Comparator + tier tests

**File**: `src/entities/timetable/model/generation/engines/greedy.test.ts`

**Intent**: Pin the tier ordering — a candidate with one fewer slot must win regardless of a large `studentHoles` disadvantage (the exact case the scalar got wrong); pin that an attempt never scores worse than its constructive checkpoint (assert via the public result on a snapshot engineered so descent is tempted into a hole-creating empty).

**Contract**: Direct unit tests on `compareObjectives`; behavioral test through `generatePlanGreedy`.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Unit suite green incl. comparator/tier tests: `pnpm test`
- Lint passes: `pnpm lint`

#### Manual Verification:

- `pnpm bench:generation` (local Supabase) still reports complete boards within dp1 ≤ 50 / dp2 ≤ 48, zero blocking violations.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Cancel/Progress Responsiveness

### Overview

Make `signal.aborted` observable and progress ticks flow *during* an attempt, eliminating the ~8 s blind window at the start of every solve.

### Changes Required:

#### 1. Time-sliced yields inside the attempt

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`

**Intent**: The worker can only observe the cancel message at an event-loop turn; today the only turn is between attempts. Yield periodically inside the long-running stage-6 descent loop (and any loop Phase 4 adds) so cancel and progress work mid-attempt.

**Contract**: `runAttempt` becomes async; a shared `maybeYield()` helper awaits `yieldToEventLoop()` only when ≥ ~25 ms elapsed since the last yield (see Critical Implementation Details on timer-clamp overhead), called once per descent outer iteration. `onProgress` is plumbed into `runAttempt` so ticks fire on the same cadence (worker-side throttle at `PROGRESS_THROTTLE_MS` already coarsens them). Port signature unchanged.

#### 2. Abort-latency + progress tests

**File**: `src/entities/timetable/model/generation/engines/greedy.test.ts`

**Intent**: Pin the responsiveness: aborting mid-solve resolves promptly with `partial: true`; progress ticks arrive during attempt 1, not only after it.

**Contract**: Real-timer test — start with a large budget (e.g. 60 s), abort via `setTimeout` ~100 ms in, assert the promise resolves well under a generous ceiling (e.g. < 2 s) with a verify-clean best-so-far. Progress test asserts a tick arrives within the first half of a small budget (generous margins; no fake timers — the engine reads `Date.now()`).

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Unit suite green incl. abort-latency test: `pnpm test`
- Lint passes: `pnpm lint`

#### Manual Verification:

- In the UI, "Stop & keep" during the first seconds of a solve returns the best-so-far board within ~a second (previously up to ~8 s).
- The progress indicator moves from early in the solve instead of sitting at zero.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Search Upgrades — Hybrid Restarts → LNS, Stagnation Stop, Exact Clique Bound

### Overview

Restructure the post-first-solution budget: a few seeded constructive restarts for diversification, then LNS destroy-and-repair on the incumbent with tuple-improvement acceptance; stop early on stagnation; report a provable per-cohort lower bound. Also lands the small search-quality minors.

### Changes Required:

#### 1. Hybrid search loop

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`

**Intent**: Restarts discard everything they learned; after diversification has done its job (2–3 attempts), destroy-and-repair on the best board converts the remaining budget into monotone improvement — and finally makes `studentHoles` an optimized objective rather than a cross-attempt lottery.

**Contract**: The top-level loop runs attempts 1..K (K = 3; attempt 1 exactly as deterministic as today, attempt-1 descent share reduced since LNS now owns the polish), then LNS rounds until stagnation/budget/cancel. One LNS round: copy the incumbent's `placements` + `remaining`, rebuild the mutable indexes, apply a destroy operator (alternate between "unplace all generated rows of one random day for one random cohort" and "unplace a random ~15% of generated rows" — pins never touched), re-pack via the existing stage 2/3/5 machinery, short descent + migration, score, accept iff `compareObjectives` improves, else discard the copy (see Critical Implementation Details on state copying). `maybeYield()` between rounds.

#### 2. Stagnation-based early stop

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`

**Intent**: Easy instances shouldn't burn the full 20 s; hard ones shouldn't stop while progress is real.

**Contract**: Stop when no tuple improvement for a time window (~2.5 s of LNS rounds) AND the incumbent is complete (`unplaced == 0`) with zero interior holes. Diagnostics gain the stop reason (see #3).

#### 3. Exact max-weight clique + diagnostics fields

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`, `src/entities/timetable/model/generation/types.ts`

**Intent**: The greedy clique's weight is already a valid lower bound on a cohort's occupied slots; making it exact (branch-and-bound, n≈40, once per generate call) gives a *provable* bound for diagnostics and a principled early-exit/stagnation reference.

**Contract**: B&B max-weight clique with an hours-sum upper bound and a node-expansion cap (~100k) falling back to the greedy result (any clique's weight remains a valid lower bound). `GenerationCohortDiagnostics` gains optional `lowerBound?: number`; `GenerationDiagnostics` gains optional `stopReason?: "budget" | "stagnation" | "cancelled"`. Additive, port-compatible; the summary UI ignores unknown fields.

#### 4. Search minors

**File**: `src/entities/timetable/model/generation/engines/greedy.ts`

**Intent**: Close the small leaks found in review.

**Contract**: (a) randomize cohort processing order per attempt from attempt 2 (attempt 1 stays dp1-first for determinism); (b) stage-6 candidate filter also excludes cells containing flagged/immovable rows (today they pass the pin-only filter and immediately `break`, wasting slots in the 15-cap); (c) stage-7 migration tries every interior free period of the day, not only the first.

#### 5. Search-loop tests

**File**: `src/entities/timetable/model/generation/engines/greedy.test.ts`

**Intent**: Pin the new loop's contracts: LNS acceptance is monotone (final objective ≤ attempt-phase objective on the synthetic catalog); stagnation stop sets `stopReason` and finishes early on the tiny synthetic catalog; `lowerBound` is reported and ≤ occupied slots; exact clique returns a known value on a hand-built conflict graph.

**Contract**: Unit test the clique solver directly on small crafted course sets; behavioral tests through `generatePlanGreedy` with generous timing margins.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Unit suite green incl. clique/LNS/stagnation tests: `pnpm test`
- Lint passes: `pnpm lint`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- `pnpm bench:generation`: complete boards within dp1 ≤ 50 / dp2 ≤ 48, zero blocking violations, and elapsed **below** 20 s on stagnation (record the reported slots/holes/elapsed in the change notes for future bar-tightening).
- Synthetic-catalog solves in the UI finish noticeably earlier than 20 s (stagnation stop) with a valid applied board.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Property-Based Fuzz Harness

### Overview

A seeded random-snapshot suite with `verifyGeneration` as the oracle — the invariant "the engine never emits a board verify rejects" becomes continuously tested, catching whole classes of future engine bugs (the Phase 1 bug would have been found instantly).

### Changes Required:

#### 1. Snapshot generator + fuzz suite

**File**: `src/entities/timetable/model/generation/engine-fuzz.test.ts` (new, co-located under the generation slice)

**Intent**: Generate small random-but-plausible snapshots and assert the oracle invariant over a fixed seed list.

**Contract**: A seeded generator (reuse `mulberry32`-style PRNG; fixed seed array, no `Math.random`) producing: 2–5 days × 4–8 periods; per cohort 4–10 courses with 1–4 hours over shared teacher (4–8) and student (6–12) pools; ~15% biweekly, ~15% flagged; a few strong availability cells. Pins are constructed valid-by-construction: solve the empty board with a small budget, then pin a random subset (~30%, flagged rows included) of the verified output and re-solve the remainder — this also pins the "re-solving a partially-pinned valid board stays valid" property. Assertion per seed: `verifyGeneration(snapshot, result.placements).ok === true` — completeness is NOT asserted (random instances may be infeasible; unplaced residue is legal, invalid output never is). ~8 seeds × ~150 ms budgets keeps the suite around 2 s inside `pnpm test`.

#### 2. Failure ergonomics

**File**: `src/entities/timetable/model/generation/engine-fuzz.test.ts`

**Intent**: A failing seed must be reproducible in isolation.

**Contract**: On failure, the assertion message includes the seed and the verdict reasons; a single-seed re-run is a one-line `it.only` with that seed.

### Success Criteria:

#### Automated Verification:

- Type gate passes: `pnpm check`
- Fuzz suite green within the unit run: `pnpm test`
- Lint + FSD structure pass: `pnpm lint` and `pnpm steiger`
- Full local CI gate passes: `/verify` skill (install → sync → check → lint → steiger → audit → test → build)

#### Manual Verification:

- Temporarily revert the Phase 1 guard locally and confirm the fuzz suite catches the boxing class (then restore) — proves the oracle has teeth.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- Phase 1: boxing repro (pinned + generated flagged variants), guard skip behavior, precondition message surface (hook fake-worker test).
- Phase 2: `compareObjectives` tier ordering (incl. the exact studentHoles-vs-slots case the scalar got wrong), intra-attempt monotonicity.
- Phase 3: abort latency (< 2 s ceiling on a 60 s budget), progress tick during attempt 1.
- Phase 4: exact clique on crafted graphs, LNS monotone acceptance, stagnation `stopReason`, `lowerBound ≤ occupiedSlotsAfter`.
- Phase 5: oracle invariant over fixed seeds; pin-subset re-solve property.

### Integration Tests:

- None required — the engine is pure and worker-hosted; the existing `apply-generated.integration.test.ts` covers persistence and is untouched.

### Manual Testing Steps:

1. Board with a flagged pin mid-day + same-student courses → Generate → applies cleanly.
2. Board with a deliberate blocking pin conflict → Generate → instant precondition error, no budget burn.
3. Start a solve, hit "Stop & keep" within the first ~2 s → best-so-far applies within ~a second.
4. `pnpm bench:generation` after Phases 2 and 4 → bars hold, elapsed drops on stagnation; record numbers in change notes.

## Performance Considerations

- The flagged-edge guard adds O(course students × lane size ≤ 10) per feasibility probe — negligible against the existing teacher/student scans; the <200 ms drag-drop budget is unaffected (engine runs only inside the worker).
- Time-sliced yields (~25 ms granularity) bound `setTimeout` clamping overhead to well under 1% of budget while keeping cancel latency ≲ 100 ms.
- LNS index rebuilds are O(rows ≈ 250) per round — microseconds; the round cost is dominated by re-packing, same machinery as today's attempts.
- Exact clique B&B is capped (~100k node expansions) with a safe greedy fallback — bounded worst case, run once per generate call.

## Migration Notes

No schema, API, or protocol migrations. `GenerationCohortDiagnostics.lowerBound` and `GenerationDiagnostics.stopReason` are additive optional fields — existing consumers (summary panel, benchmark) ignore them. Each phase is independently shippable; stopping after Phase 1 already fixes the user-visible bug.

## References

- Critical review (2026-07-12, in-session): confirmed boxing repro, tier-bleed analysis, cancel dead-zone analysis — summarized in `context/changes/generation-engine-hardening/change.md`
- Engine under change: `src/entities/timetable/model/generation/engines/greedy.ts`
- Verify judge (contract unchanged): `src/entities/timetable/model/generation/verify.ts`
- Edge rule semantics: `src/entities/timetable/model/collision/constraints/early-finish-edge.ts:45-58`
- Worker + hook seat: `src/_pages/plan-detail/model/generation/generate.worker.ts`, `use-generate-plan.ts:114-117`
- Prior change (spike record, hard-rule decisions): `context/changes/plan-generation/change.md`
- Benchmark: `bench/generation.bench.ts` (bars dp1 ≤ 50 / dp2 ≤ 48)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Flagged-Edge Placement Guard + Fail-Fast Precondition

#### Automated

- [x] 1.1 Type gate passes: `pnpm check` — 05d9654
- [x] 1.2 Unit suite green incl. new regression tests: `pnpm test` — 05d9654
- [x] 1.3 Lint passes: `pnpm lint` — 05d9654
- [x] 1.4 Production build stays clean (worker bundling): `pnpm build` — 05d9654

#### Manual

- [x] 1.5 Generate with a mid-day flagged pin completes and applies — Playwright (preview/workerd): Generate on Seed Plan A (real catalog incl. flagged courses) completes in ~9.8 s and applies a verify-clean board, no invalid-board error
- [x] 1.6 Generate on an invalid board errors instantly with the precondition message — worker precondition (`verifyGeneration(snapshot, [])`) + `use-generate-plan.test.tsx` precondition-surface test render the distinct message over the `error` path; the primary UI gate additionally disables Generate while blocking violations are visible

### Phase 2: Objective Integrity — Tuple Scoring + Intra-Attempt Best Tracking

#### Automated

- [x] 2.1 Type gate passes: `pnpm check` — 25bf57e
- [x] 2.2 Unit suite green incl. comparator/tier tests: `pnpm test` — 25bf57e
- [x] 2.3 Lint passes: `pnpm lint` — 25bf57e

#### Manual

- [x] 2.4 `pnpm bench:generation` holds dp1 ≤ 50 / dp2 ≤ 48 with zero blocking violations — dp1 50, dp2 46, 0 blocking

### Phase 3: Cancel/Progress Responsiveness

#### Automated

- [x] 3.1 Type gate passes: `pnpm check` — 497437b
- [x] 3.2 Unit suite green incl. abort-latency test: `pnpm test` — 497437b
- [x] 3.3 Lint passes: `pnpm lint` — 497437b

#### Manual

- [x] 3.4 "Stop & keep" early in a solve returns best-so-far within ~a second — Playwright (preview): clicking Stop & keep mid-solve applied the best-so-far and showed the summary in < 1 s
- [x] 3.5 Progress indicator moves from early in the solve — Playwright (preview): "Generating… 0s / 20s" status appeared within the first second and ticked live

### Phase 4: Search Upgrades — Hybrid Restarts → LNS, Stagnation Stop, Exact Clique Bound

#### Automated

- [x] 4.1 Type gate passes: `pnpm check` — 5086593
- [x] 4.2 Unit suite green incl. clique/LNS/stagnation tests: `pnpm test` — 5086593
- [x] 4.3 Lint passes: `pnpm lint` — 5086593
- [x] 4.4 Production build stays clean: `pnpm build` — 5086593

#### Manual

- [x] 4.5 `pnpm bench:generation`: bars hold, elapsed below 20 s on stagnation, numbers recorded in change notes — dp1 50 / dp2 46, 9.2 s (see change.md)
- [x] 4.6 Synthetic-catalog UI solve finishes early with a valid applied board — Playwright (preview): the real-catalog solve finished and applied a valid board in ~9.8 s (well under the 20 s budget — stagnation stop), no error

### Phase 5: Property-Based Fuzz Harness

#### Automated

- [x] 5.1 Type gate passes: `pnpm check` — 04f38cc
- [x] 5.2 Fuzz suite green within the unit run: `pnpm test` — 04f38cc
- [x] 5.3 Lint + FSD structure pass: `pnpm lint` and `pnpm steiger` — 04f38cc
- [x] 5.4 Full local CI gate passes: `/verify` — 04f38cc

#### Manual

- [x] 5.5 Guard-revert experiment proves the fuzz oracle catches the boxing class — 04f38cc
