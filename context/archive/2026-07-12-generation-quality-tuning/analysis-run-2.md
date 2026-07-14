---
title: "Analyzer run #2 — acceptance run after the quality tuning"
date: 2026-07-14
tool: "pnpm experiment:generation (bench/generation.experiment.ts) → the same analyzer as run #1"
command: 'SOURCE_PLAN_ID=4bc9fe99-33ae-4c58-9b66-9b8477dad33f PIN_SKELETON=1 LABEL="Acceptance run 2" pnpm experiment:generation'
inputs:
  plan_a: "Golden Plan — 4bc9fe99-33ae-4c58-9b66-9b8477dad33f (expert manual board, local snapshot)"
  plan_b: "Acceptance run 2 — a catalog-only clone of the same plan, fixture skeleton pinned (16 rows), generated headless at the app's 20 s budget"
  rig: "local Supabase; greedy engine, stop=budget, 20 006 ms"
status: final
---

# Analyzer run #2 — the acceptance run

The definition of done for `generation-quality-tuning`: the same comparison run #1 made, against the
same gold board, after all seven phases. Run #1 measured the untuned engine; every number below is
the tuned one. Both boards are read by the same analyzer, so the columns are directly diffable.

**The run is reproducible by one command** (above) — clone the catalog, copy the fixture skeleton by
course identity, generate, verify, persist, analyze. No clicking, no hand-pinning.

## 1. R18 checklist — the acceptance bar

| Check | Bar | Run #2 | |
| --- | --- | --- | --- |
| Same-day splits | 0 | **0 / 0** | ✓ |
| Teacher day span / consecutive streak | ≤ 8 / ≤ 6 | **8 / 6** | ✓ |
| Fixtures respected | skeleton intact | **16 pinned rows; 9 mirrored cells, same as gold** | ✓ |
| Soft-availability hits | 0 | **0** | ✓ |
| Golden slots mid-day | in P4–P7 | **11 cells, 100% in band, mean period 4.86 / 6.25** | ✓ |
| Oracle verdict (generated board) | valid | **valid, 0 blocking violations** | ✓ |
| Gold board still verifies | clean | **clean under every new rule** | ✓ |
| Unplaced residue | small, hand-finishable | **6 h** (dp1 1 h, dp2 5 h) | ✓ |
| Friday shortest | yes | **dp2 yes (8 slots, ends P9); dp1 no (10 slots, ends P10)** | ~ |
| Teacher gap-slots | ≤ 2× expert (≤ 148) | **217** (expert 74; untuned engine 345) | ✗ |

**Verdict: accept.** The economic bar (R18: beat ~40 hours of manual planning) is cleared with room —
what remains after generation is 6 unplaced hours to drop onto the board plus a teacher-day sweep,
against a manual process that builds the whole week. The two misses are real and are recorded as such:
teacher compactness is 3× the expert's rather than the 2× we aimed for, and dp1's Friday is not its
shortest day. Neither is a rule violation; both are quality tiers the search runs out of budget to
reach, for the reason stated in §3.

## 2. Scoreboard — gold vs the tuned engine

| Metric (dp1 / dp2) | Golden Plan | Run #1 (untuned) | Run #2 (tuned) |
| --- | --- | --- | --- |
| Unplaced hours | 4\* / 0 | 0 / 1 † | **1 / 5** |
| Occupied slots | 48 / 47 | 47 / 47 | **49 / 47** |
| Interior holes | 0 / 0 | 0 / 0 | **0 / 0** |
| Free at day start | 0 / 0 | 2 / 1 | **0 / 1** |
| Same-course same-day **splits** | 0 / 0 | **27 / 40** | **0 / 0** |
| Same-course adjacent pairs (doubles) | 101 / 125 | 8 / 18 | **41 / 65** |
| Multi-day courses | 19 / 22 | 31 / 33 | 31 / 33 |
| Student gap-slots | 218 / 394 | 436 / 584 | **368 / 510** |
| **Teacher gap-slots** (board-wide) | **74** | **345** | **217** |
| Max consecutive teaching | 6 | 7 | **6** |
| Soft-availability hits | 0 | 3 | **0** |
| Golden cells / mean period | 15 / 4.57 · 5.75 | 13 / 7.5 · 8.0 | **11 / 4.86 · 6.25** |
| Golden cells inside P4–P7 | 9 / 15 (60%) | — (day tail) | **11 / 11 (100%)** |
| Mirrored (fixture) cells | 9 | 1 (accidental) | **9** |

\* the gold board's dp1 "−4 h" is an attribution artifact, not a hole: its Chemistry hours sit on the
HL dependent (reported as +4 over-placed on the same board). Documented in the plan's Key Discoveries.

† **the two residues are not comparable, and run #1's is the flattering one.** Run #1 was measured
before the Chemistry projection fix (Phase 2): `loadCohortCourses` dropped the zero-enrolment
Chemistry SL base and its 4 required hours from the catalog entirely, so the engine was scored
"complete" against a catalog missing hours the school actually teaches — *complete and four hours short
of reality at the same time*, as run #1 put it. Run #2's catalog contains those hours, and its residue
is measured against the truth. The residue also carries the price of the hard rules (R17: an unplaced
hour beats a split course), which run #1's board simply did not pay — it took 67 splits instead.

**What changed, and what did not.** The hard rules did what hard rules do: splits went 67 → 0 and the
7-hour teaching streak is gone, at the price the expert predicted (an unplaced hour instead of a rule
violation — R17). Soft availability, invisible to the untuned search, is now respected outright. Teacher
gaps fell 37% (345 → 217) and student gaps 14% (1020 → 878). The fixture skeleton is intact — 9 mirrored
cells against the untuned engine's 1 accidental one — because the workflow now pins it before solving.
Golden slots moved from the day's tail into the mid-day band, which the research identified as the
actual differentiator; the *count* did not follow (11 vs gold's 15), and that is structural: gold's dp2
composites are built on the biweekly CAS/EE cells, which this change deliberately left to the pinned
fixtures rather than to detection.

Doubles roughly quadrupled (26 → 106 board-wide) but remain far from gold's 226, and multi-day courses
did not move at all (31/33, gold 19/22). The two facts are the same fact: the engine pairs hours *within*
a day it already uses, but nothing pulls a course's days together, so a 4-hour course still spreads
across four days and can only ever pair by luck.

## 3. Why the two misses are the same miss

Both come out of the budget, not the model. The tuple is lexicographic and the search honours it:
completeness (tier 1) and slots (tier 3) outrank teacher gaps (tier 4), which outrank the shape tiers
(7–9). On the real catalog the board never reaches completeness — a residue of 5–8 hours survives every
run — so tier 1 stays hot and the LNS spends most of its 20 seconds there. The tiers below it get
whatever is left, in order. That is the correct behaviour, and it is why teacher gaps stall at 217 and
dp1's Friday stays long.

**The residue is therefore the highest-value next target, not the tier weights.** Close it — a stronger
repair, or the deferred CP-SAT engine — and every tier below tier 1 inherits the freed budget. Tuning
the weights instead would only trade a tier the expert ranks higher for one she ranks lower.

## 4. Run-to-run variance (read the numbers with this in mind)

The search is wall-clock-driven, so the same code on the same input lands on different boards. Across
the phase's harness runs: residue 5–8 h, teacher gaps 217–269, doubles 66–114, golden cells 8–12. Even
the seed-catalog bench moves a slot between runs — which is how the dp2 = 46 bar turned out to be a
property of the runs that first measured it rather than of the engine (bench docblock, 2026-07-14).
Single-run comparisons across phases are noise; only differences larger than these bands mean anything.
