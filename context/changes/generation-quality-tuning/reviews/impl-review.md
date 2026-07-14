<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Generation Quality Tuning

- **Plan**: `context/changes/generation-quality-tuning/plan.md`
- **Scope**: Phases 1–7 of 7 (full plan)
- **Date**: 2026-07-14
- **Verdict**: REJECTED at review → **all 10 findings triaged; 9 fixed, 1 accepted**
- **Post-triage gate**: `check` 0 errors · `lint` · `steiger` · `test` 1447/1447 · `test:integration` 105/105 · `build` — all clean
- **Findings**: 1 critical · 6 warnings · 3 observations

At review, the automated gate was already clean (`check` 0 errors · `lint` · `steiger` · `test`
1434/1434 · `build`), every planned item verified MATCH, and no "What We're NOT Doing" boundary was
crossed. The findings below are what the green gate did not catch.

## Verdicts

| Dimension | At review | After triage |
|-----------|-----------|--------------|
| Plan Adherence | PASS | PASS |
| Scope Discipline | WARNING | PASS — plan.md amended (F4) |
| Safety & Quality | FAIL | PASS — F1, F2, F3, F5, F6, F8 fixed; F10 accepted |
| Architecture | PASS | PASS |
| Pattern Consistency | WARNING | PASS — F9 resolved with F2 |
| Success Criteria | WARNING | PASS — gates 4.4 / 5.4 annotated (F7) |

## Carried forward

- **The golden-cell numbers in `analysis-run-2.md` predate the F3 fix** and were measured under the
  old tier-10 semantics (full-coverage bar, either-lane reading). They need a `PIN_SKELETON=1`
  harness re-run to stay honest. Nothing else in the acceptance run is affected — the F1/F2 fixes
  only *loosen* verify on boards that were already being rejected, and F5's extra oracle pass was
  bench-measured as free.
- **`pnpm bench:generation` is not a reliable guard**: measured during this review, it fails on
  *unmodified* `main` in 3 of 4 runs on this machine (dp1 one hour unplaced), and it is not in CI.
  This is change.md follow-up §4 (the engine needs a deterministic, round-count-bounded mode for the
  bench) — and it is why F6's literal constant pins matter.

## Findings

### F1 — Verify is stricter than fitsAt on teacher-day-shape; a pin-broken teacher day kills Generate for the whole plan

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/entities/timetable/model/generation/verify.ts:102-108` vs `engines/greedy/board.ts:138,221`
- **Detail**: `board.fitsAt` reads the teacher-day-shape delta **per week-lane** (`creates(...)` = breaches with the candidate AND did not breach without it), so a lane a pin already broke still accepts placements. `verifyGeneration` reads the delta **per (teacher, day)** only — `generatedTeacherDays` holds any (teacher, day) the generator touched. The moment the engine places one hour on a pin-broken teacher-day, the board-wide violation is attributed to the generator and the entire result is rejected.

  Reproduced by probe: pins `math@(d1,P1)` + `phys@(d1,P10)` for teacher `t1` (span 10). `verifyGeneration(snap, [])` → ok (precondition passes, pin-only warns tolerated). `board.fitsAt("dp1", eng, 1, 5)` → `"both"` (accepted). `verifyGeneration(snap, [eng@(d1,P5)])` → `ok: false`, "teacher-day-shape (span 10, streak 1) among generated placements".

  Reachable through normal use: `teacher-day-shape` is a WARN kind (`collisions.ts:138`), so an author can hand-place an over-long teacher day (amber, non-blocking), then hit Generate. The engine has no incentive to avoid that teacher-day, burns the full 20 s budget, and the user gets "Generation produced an invalid board — nothing was applied" (`use-generate-plan.ts:126`) with no diagnosis and no recourse.

  This is precisely the trap the plan's own Critical Implementation Details warn about (`plan.md:143-149`).
- **Fix**: Make verify's delta lane-aware to match `fitsAt`. Compute the pin-only period set per (teacher, day, lane) and fail only when the merged lane breaches while the pin-only lane did not — reuse the same `creates(exceedsTeacherDayShape, …)` predicate `board.ts` already builds from the oracle.
  - Strength: `teacherDayPeriods` is already exported from `constraints/index.ts` for exactly this "both sides agree" reason — it simply isn't used on the verify side. Keeps the oracle as the single definition (portability invariant 2).
  - Tradeoff: Verify gets marginally more permissive on dirty boards — correct per the plan's delta semantics. Tightening `fitsAt` instead is NOT an option: a board-wide reading poisons every placement on that teacher-day and livelocks the search (the boxing-bug lesson, `plan.md:154`).
  - Confidence: HIGH — reproduced end-to-end; the asymmetry is visible in the two key shapes (lane-keyed vs (teacher,day)-keyed).
  - Blind spot: Haven't measured how often real authors leave an over-long teacher day pinned before generating; the runbook's pre-pin workflow may make it rare.
- **Decision**: **FIXED** — verify's `teacher-day-shape` delta is now lane-aware against a pins-only baseline, mirroring `board.fitsAt`'s `creates()`. The violation carries every offending `lanes` entry; the `(teacher, day)` key is gone. Three regression tests added (same-day generated row on a pin-broken teacher day is permitted; a breach the generator creates on a legal day still fails; a pin-broken week A does not excuse week B).

### F2 — course-day-split delta key is week-lane-blind

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/entities/timetable/model/generation/verify.ts:139-147,186`
- **Detail**: The violation is lane-scoped (`course-day-split.ts:47-59` filters per `lanesOf(week)`), but the delta set deciding whether the generator "participates" is keyed `${courseId}|${day}` with no lane. A biweekly course with a pre-existing week-A pin split on day 1 rejects a generated week-B hour on day 1 that created nothing.

  Reproduced: pins `bio@(d1,P2,"a")` + `bio@(d1,P5,"a")` (precondition passes). `fitsAt("dp1", bio, 1, 8)` → `"b"` (correctly accepts, lane B empty). `verifyGeneration` → `ok: false`, two course-day-split reasons.

  Same class as F1, narrower blast radius (needs a biweekly course AND a dirty pin lane). The `courseDayKey` shape is inherited from the pre-existing stacking path — the new split rule widens the same hole.
- **Fix**: Key the delta set by (courseId, day, lane) and have `course-day-split` / `course-day-stacking` carry the offending lane on the violation (both already compute it internally), so verify can match lane-for-lane.
- **Decision**: **FIXED via the same pattern** — `course-day-split` and `course-day-stacking` violations now carry `lanes`, and verify reads the delta lane-by-lane against the pins-only board via the oracle's own `hasDaySplit` / `exceedsDayCap`. A shared `courseDayPeriods` lane reader was added to `day-occupancy-index.ts`. Two regression tests added.

### F3 — Golden-set detection (≥90%) and tier 10 (100%) disagree, so anchored near-golden cells have no gravity

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `golden-sets.ts:21,39` vs `generation/objective.ts:309`
- **Detail**: `deriveGoldenSets` admits a cover set at `GOLDEN_COVERAGE = 0.9`, and `golden-sets.test.ts` explicitly pins that (the expert's G1 near-golden rule). But tier 10 only scores cells reaching the FULL roster (`if (students.size < roster) continue;`).

  So `anchorGoldenSets` (stage 0) seats a 90–99% set inside P4–P7, and tier 10 assigns it zero cost anywhere on the board — the LNS is free to drag it back to the day tail, which is exactly what the tier exists to prevent. Both bars are as the plan wrote them (Phase 6 #2 says ≥90%, #4 says "full coverage"), so this is a plan-level gap.

  Two related mismatches ride along: the rosters differ (`objective.ts:172` unions ALL cohort courses; `problem.ts:73` hands detection only the non-flagged ones), and `countGoldenBandDistance` calls a cell golden if EITHER lane covers the roster while the analyzer census (`slot-census.ts:108`) takes the WORST lane — the metric reporting the tier's success measures something the tier doesn't optimize.
- **Fix A ⭐ Recommended**: Lower tier 10's bar to `GOLDEN_COVERAGE` and single-source the roster + lane reading.
  - Strength: Matches the expert's own G1 definition (near-golden = missing ≤10% is still a golden slot), so the anchored cells construction actually produces are the ones the tier protects. Stays count-neutral.
  - Tradeoff: Slightly more cells carry a band-distance cost; measured band share (67–100%) may shift. Needs a harness re-run to confirm no tier 1–9 drift.
  - Confidence: HIGH — the two constants are literally different numbers for the same concept, and G1 names 90%.
  - Blind spot: Haven't measured whether the extra protected cells cost the LNS budget tier 1 (residue) still needs.
- **Fix B**: Raise the detector to full coverage (drop `GOLDEN_COVERAGE`).
  - Strength: Simplest reconciliation — one bar, one meaning.
  - Tradeoff: Discards the expert's near-golden rule (G1) and would shrink the already-short golden count (8–12 vs gold's 15). Contradicts `golden-sets.test.ts`.
  - Confidence: MEDIUM — optimizes internal consistency over the elicited domain rule.
  - Blind spot: Unknown how many anchored sets today are 90–99% rather than 100%.
- **Decision**: **FIXED via Fix A** — tier 10's bar is now `GOLDEN_COVERAGE` (the same ≥90% G1 bar the detector and anchor use), and it takes a cell's WORST week lane, matching `deriveGoldenSets` and the analyzer census. `deriveGoldenSets` now takes the whole catalog plus the flagged set, so its roster is the true cohort (flagged courses' students count; flagged courses are dropped from candidates only). `GOLDEN_MISS_SHARE = 0.1` is now the single elicited primitive, with `GOLDEN_COVERAGE = 1 - GOLDEN_MISS_SHARE` (`1 - 0.1` is exactly `0.9` in IEEE-754; `1 - 0.9` is not) and the census re-exporting it. **Changes engine behaviour — the golden-cell figures in `analysis-run-2.md` predate this and need a harness re-run.**

### F4 — plan.md was never amended; it still describes an engine that no longer exists

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Scope Discipline
- **Location**: `context/changes/generation-quality-tuning/plan.md:107-120,163-165,460`
- **Detail**: `git diff e1c7d37^..HEAD -- plan.md` touches only the Progress checkboxes. Every prose section is untouched, so the plan still asserts things the shipped code contradicts:
  - `plan.md:107-120` — "The final tuple: [10 tiers]" with no mention that the search steers by only 6 (`SEARCH_TIERS = 6`, `objective.ts:69`; phase-C polish on all 10 in the last 15%, `search.ts:122-152`).
  - `plan.md:163-165` and `:460` — "compareObjectives and the LNS acceptance test need nothing." Both changed: `compareObjectives` gained a `tiers` parameter (`objective.ts:81`); acceptance passes `polishing ? FULL_TIERS : SEARCH_TIERS` (`search.ts:149`).
  - Phase 4/5/6 Changes Required list only `objective.ts` edits. The three engine mechanisms that actually delivered those tiers — the `teacher` and `deficit` LNS destroy operators (`search.ts:192,209`) and `ADJACENT_RANK_BONUS` (`stages.ts:49`) — are absent from the plan entirely.

  The work itself is honestly documented in change.md and in-code comments, and each mechanism is load-bearing. None breaches a portability invariant in letter. But the architectural consequence belongs on the record: the declared 10-tuple is no longer what greedy *optimizes* — it is what greedy *filters* by, while the walk is driven by 6 tiers plus an engine-private adjacency heuristic. A future CP-SAT engine handed the same tuple would produce a materially different board.
- **Fix A ⭐ Recommended**: Amend plan.md's Implementation Approach + Critical Implementation Details with the three engine findings, and correct the two false comparator claims.
  - Strength: plan.md is the artifact future reviews treat as ground truth; leaving demonstrably false statements in it will mislead the next change.
  - Tradeoff: Plan becomes a moving target; original scope no longer legible as-written.
  - Confidence: HIGH — the divergences are concrete and citable.
  - Blind spot: None significant.
- **Fix B**: Leave plan.md as a historical artifact; rely on change.md's notes.
  - Strength: Preserves the plan as an honest record of intent before measurement.
  - Tradeoff: Every future reader who greps plan.md for the engine's architecture gets a wrong answer — the stale-convention lesson says this is how false premises propagate.
  - Confidence: MEDIUM — defensible only if plan.md is never re-read.
  - Blind spot: The next change's /10x-research would read plan.md first.
- **Decision**: **FIXED via Fix A** — `plan.md` gained a dated amendment after the tuple (the three unplanned engine mechanisms, each with the measurement that forced it, and the CP-SAT consequence: the 10-tuple is greedy's *filter*, not its gradient), plus in-place corrections at each false claim (Critical Implementation Details; Phase 4 §2; Phase 5 §1).

### F5 — "Construction is the always-valid floor" no longer holds, and the constructed board is returned unverified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `engines/greedy/search.ts:303-306`; `stages.ts:142,326,330`
- **Detail**: `search.ts` gates `descended` on `verifyGeneration` but returns `constructed` unverified, justified by "construction as the always-valid floor". That floor rests on `chainFit` — whose failure path calls `board.place(...)` directly (`stages.ts:330`), bypassing `fitsAt`, onto a board a successful nested `chainFit` may already have mutated (the `continue` at `:326` leaves a re-homed member in its new cell without rollback). In `repairStragglers`, `excludeKey` is undefined, so a re-homed row can land in the very cell being restored.

  The two new rules widen this materially: unlike the five cell-local hard rules, `course-day-split` and `teacher-day-shape` are DAY-scoped, so a relocation elsewhere on the same day can make the unchecked restore breach them. The old "the cell it returns to is untouched" argument no longer covers day-scoped rules.

  Not reproduced — the path needs a specific nested-chain shape — so plausible, not confirmed.
- **Fix**: Verify `constructed` too — the same `verifyGeneration` call already guards `descended`, so the cost is one extra oracle pass per attempt.
  - Strength: Turns a silent invalid-board return into a caught failure; closes the class, not the instance.
  - Tradeoff: One oracle pass per attempt against a 20 s budget already rationed by the unplaced residue; needs a bench check.
  - Confidence: MEDIUM — the unchecked-place sites are real and cited; day-scoped reachability is inferred, not demonstrated.
  - Blind spot: If `constructed` can in fact breach, verifying it means some runs return nothing — the fallback needs a plan.
- **Decision**: **FIXED** — `search.ts` now re-judges `constructed` before returning it, and falls back to the LNS incumbent when both boards breach (rather than poisoning `best`). Cost verified: `preferDescended` counts ties, so a valid descended board still costs exactly one verify per round. **Bench-measured**: 4 runs with the fix vs 4 at HEAD — same distribution (dp1 49–50 slots, dp2 47–48, 0–1 unplaced); HEAD itself fails the bench 3/4 on this machine. No throughput regression.

### F6 — The engine's load-bearing cadence constants are unpinned, and the bench bar guarding them was loosened in the same change

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `search.ts:53` (SEARCH_TIERS), `:192`,`:209` (DESTROY_OPERATORS 4:1, DEFICIT_EVERY=3); `stages.ts:49` (ADJACENT_RANK_BONUS=250); `bench/generation.bench.ts` (SLOT_BARS dp2 46 → 47)
- **Detail**: change.md describes the operator cadence as "load-bearing" — a flat 1-in-3 teacher round cost both slots and completeness; merely lengthening the cycle cost dp2 a slot. Yet no unit test touches `destroyFor`, and the only guard is `pnpm bench:generation`, whose dp2 slot bar was relaxed 46 → 47 inside this same change.

  The bar loosening is itself well-controlled and honestly recorded (the pre-tuning engine re-measured at 47/46/unplaced across runs, so 46 was a property of the measuring runs). But the net effect is that four empirically-tuned constants whose mis-setting demonstrably breaks completeness now have one weaker guard and no test.
- **Fix**: Pin the cadence in a unit test over `destroyFor` (assert the 4:1 cell/teacher cycle and the deficit-only firing condition), so a future edit fails loudly instead of silently walking a worse plateau.
  - Strength: Converts "load-bearing, don't touch" from a comment into an executable claim.
  - Tradeoff: Pins an empirical tuning as if it were a spec; a legitimate retune must update the test.
  - Confidence: HIGH — the constants' fragility is documented by the implementer's own measurements.
  - Blind spot: A cadence test doesn't catch a bad `ADJACENT_RANK_BONUS` value; only the bench does, and it is wall-clock-noisy.
- **Decision**: **FIXED** — new `search.test.ts` pins the cadence: `DESTROY_OPERATORS` and `DEFICIT_EVERY` asserted literally (the behavioural tests derive from the constants, so only the literal pin actually guards them — verified by mutation: `DEFICIT_EVERY = 4` fails the pin while the other four still pass), plus `SEARCH_TIERS === 6`, the 4:1 cycle, deficit-never-on-complete, and deficit-substitutes-rather-than-lengthens. Note: the bench bar itself remains flaky (fails on unmodified HEAD 3/4 here) and is *not* in CI — see change.md follow-up §4.

### F7 — Two Progress gates checked without recording their misses

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `plan.md:779` (gate 4.4), `plan.md:792` (gate 5.4)
- **Detail**: Gate 4.4 reads "teacher gaps → ≤ 148, softHits = 0, totalSlots not worse — bbdc382", checked with no caveat; change.md's P4 note says "gate 4.4 PARTIAL … teacher gaps ~231 (the gate's ≤148 target NOT met)". Gate 5.4 reads "lateStarts = 0 …" checked with no caveat; change.md's P5 note records "9 of 10 days start at P1 (dp2's Friday starts at P2)".

  A rubber-stamping signal, and inconsistent within the same plan — gates 6.5 and 7.2 WERE annotated inline with their shortfalls. The misses are recorded in change.md and analysis-run-2, so nothing is hidden; the Progress section just doesn't reflect them, and Progress is what a reviewer reads first.
- **Fix**: Annotate 4.4 and 5.4 inline with their measured shortfalls, matching the format already used for 6.5 and 7.2.
- **Decision**: **FIXED** — Progress gates 4.4 and 5.4 annotated inline with their measured shortfalls (teacher gaps ~231 vs the ≤148 target; dp2's Friday starts at P2; multi-day spread unmoved), matching the format already used for 6.5 and 7.2.

### F8 — Harness says "nothing persisted" when a clone already exists

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `bench/generation.experiment.ts:86` (vs `:63`, `:70`, `:104`)
- **Detail**: On a failed verdict the message reads "The engine's board FAILED verification — nothing persisted", but the clone plan exists by then (`:63`) and with `PIN_SKELETON=1` the skeleton is already written (`:70`). Nothing cleans up on the throw, so repeated failing runs accumulate orphan clones in the local DB. Separately, the `clone_plan` RPC result is typed `string` but not null-checked (`:104-110`).

  The safety posture is otherwise sound: `createLocalSupabase()` asserts a local hostname and throws otherwise; the write path never passes `allowRemote`; only the read-only analyzer opts in behind `ANALYZE_ALLOW_REMOTE=1`. `persistRegion` writes exclusively to the clone id. No destructive-op risk found.
- **Fix**: Reword to "no generated rows persisted — clone `<id>` left for inspection", and add a null guard on the `clone_plan` result.
- **Decision**: **FIXED** — failure message now says "no generated rows persisted" and names the clone left for inspection; `clone_plan`'s result is null-guarded.

### F9 — Week semantics now live in two places

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `collision/constraints/course-day-stacking.ts:44-48`
- **Detail**: The two NEW constraints fold weeks through the shared `lanesOf` / `weeksDisjoint` primitives. The older sibling `course-day-stacking.ts` still carries private `concreteWeeks` / `runsWeek` duplicates, leaving it the odd one out among three day-scoped rules. A future week-semantics change now has to be made twice.
- **Fix**: Fold `course-day-stacking.ts` onto `lanesOf`/`weeksDisjoint` so all three day-scoped rules read weeks from one place.
- **Decision**: **FIXED as a side-effect of F2** — `course-day-stacking`'s private `concreteWeeks`/`runsWeek` duplicates are gone; all three day-scoped rules now read weeks through the shared `lanesOf`/`weeksDisjoint` + `courseDayPeriods`.

### F10 — Kept overlap base with hours_per_week = 0 newly emits a zero-hours warning

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/shared/api/load-cohort-courses.ts:74,81,207-213`
- **Detail**: The regression the plan worried about is NOT present: a kept overlap base gets `studentKeys` from the dependents' fold, so `collectWarnings` does not emit a spurious `no-students` — confirmed in code and by `load-cohort-courses.integration.test.ts:84`. Merge topology is untouched and pinned by the third integration case.

  New edge: a base with `hours_per_week = 0` AND an enrolled dependent now projects and — not being a merge child — emits a `zero-hours` warning where it was previously dropped silently. Arguably correct (it IS an anomaly), just newly visible.
- **Fix**: None needed — accept, or note in the runbook's data checklist.
- **Decision**: **ACCEPTED** — no code change. The `no-students` regression the plan feared is confirmed absent. The new `zero-hours` warning on a 0-hour overlap base with enrolled dependents is correct behaviour (a real data anomaly, newly visible).
