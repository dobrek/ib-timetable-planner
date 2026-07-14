---
change_id: generation-quality-tuning
title: Generation quality tuning
status: archived
created: 2026-07-12
updated: 2026-07-14
archived_at: 2026-07-14T12:42:04Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- 2026-07-13: expert elicitation complete — answers collected in `expert-questions.pl.md`,
  digested + classified in `research.md` §Follow-up. Headlines: no-split and teacher-8h-day are
  hard; `totalSlots` confirmed dominant; gradient/switches/anti-batching/spread need no terms;
  Polish A Monday "fixture" was a coincidence; soft availability stays soft (compensated last
  resort). Open: softHits-vs-teacherHoles order, 9.2 live walkthrough.
- 2026-07-13 (later): expert added the **Golden Slot** rule post-questionnaire (verbatim in
  `expert-questions.pl.md` §Uzupełnienie, analysis in `research.md` §Addendum): full-cohort
  coverage slots (English A+B, TOK, composites) must be assembled and placed mid-day. Verified
  in SQL: expert 15 golden cells centred mid-day (mean period 4.6/5.75) vs engine 13 at the day
  tail (7.5/8.0) — position, not count, is the differentiator. Resolves the English A/B
  coupling unknown.
- 2026-07-13 (G-answers): follow-ups answered — near-golden = missing ≤10% (typ. 1–2 students);
  golden slots are _found_ from enrollment, not manufactured (price sub-question unanswered →
  encode as free bonus); mid-day band = **P4–P7**; G4 fixes the last tier gap:
  **teacherHoles above softHits**. Elicitation complete except the 9.2 live walkthrough —
  ready for /10x-frame → /10x-plan.
- 2026-07-13 (flags verified): research open item "do SSSTS/TOK/CAS/EE carry `finishes_early` in
  the imported gold catalog?" resolved by query — **dp2 TOK/CAS/EE flagged; dp1 editions, SSSTS,
  Advisory unflagged**. Consistent with the oracle-passing gold board (Advisory Wed P7 is
  interior, so flagging it would fail early-finish-edge) and IB reality (DP2 core stops before
  exams). Golden catalog-only clones therefore need zero data hygiene; only fixture re-pinning.
- 2026-07-13 (planned): `plan.md` + `plan-brief.md` written. New decisions beyond the research:
  teacher-day cap = **span ≤ 8 AND max 6 consecutive** (both SQL-verified gold-safe: gold spans
  max at exactly 8, longest run 6; engine violates both); Chemistry fix = projection keeps
  overlap bases with enrolled dependents; hard rules surface as UI warns (stacking precedent);
  golden slots = construction anchor + last-place free-bonus tier; bottom-tier order
  doubles → lateStarts → fridayTail; fixtures stay a pre-pin workflow (no R12 reorder);
  verification = phase-wise local analyzer A/B vs run-1.
- 2026-07-13 (harness): plan restructured to 7 phases — new Phase 1 adds a one-command
  experiment harness (`pnpm experiment:generation`: clone catalog-only → copy fixture skeleton
  from the golden board by course identity → generate headless → verify → persist via
  `apply_generated_placements` → analyze vs golden). Eliminates in-app clicking and hand-pinning
  from every phase gate; skeleton cells are never hardcoded.
- 2026-07-14 (P3 measured): hard rules landed. Pinned harness run — sameDaySplits **0/0** (was
  24/30), teacher day span max **8** (was 10), max consecutive teaching **5** (was 7), teacher
  gap-slots 242 (was 345) as a free side-effect; gold board still verifies clean. Price, as R17
  predicts: unplaced residue rises from 0 to **10 h pinned** (dp1 English A SL −2; dp2 Chemistry SL,
  Physics SL, Spanish B AB, Physics HL, Math AA HL, Chemistry HL, BM SL, Geography SL −1 each) and
  **5 h unpinned** (dp1 BM HL, English A HL; dp2 Math AA HL, English A SL, SSSTS SL). An unplaced
  hour beats a rule violation — the residue is the hand-finish tail, and the later tiers do not
  trade against tier 1.
- 2026-07-14 (P3 oracle fix, unplanned): the engine fuzz surfaced a **pre-existing**
  fitsAt-looser-than-verify gap in `early-finish-edge` (reproduced on the pre-change code): the
  oracle unioned weeks A and B for a `both`-week flagged course, so a course with a week-A
  neighbour below and a week-B neighbour above read as "boxed" — while it sits at a day edge in
  every week the student actually lives, which is what `board.fitsAt` (lane-wise) already enforced.
  The oracle now reads per week lane; the test that pinned the union reading was inverted with the
  reasoning recorded. Strictly more permissive, so the gold board is unaffected.
- 2026-07-14 (P4 measured, gate 4.4 PARTIAL): tiers 4–5 landed (`teacherHoles`, `softHits`) plus a
  **teacher-day LNS destroy operator** — not in the plan, but required: a lexicographic tier can only
  _filter_ the boards the neighbourhood produces, and no destroy operator moved teacher rows, so the
  tier alone left teacher gaps at 246 (vs 345 before, i.e. the Phase-3 hard rules did the work, not
  the tier). With the operator the search reaches teacher-compact boards. Cadence matters: a flat
  1-in-3 teacher round cost slots AND completeness on the seed catalog (dp2 46→47/48, dp1 sometimes
  1 h unplaced) for gains the tuple ranks _below_ both — so the cycle is 4 cell-shaped rounds to 1
  people-shaped one, which restores the bench (dp1 50→**49**, dp2 **46**, complete, stable) while
  keeping the teacher gains. Golden-catalog result at the app's 20 s budget: teacher gaps **~231**
  (345 → 231, −33%; the gate's ≤148 target NOT met), soft hits 0–3 (run-dependent), splits 0,
  streak ≤ 6, student gaps 981 (from 1020). At 60 s: teacher gaps 211, residue 6 h.
  **The binding constraint is the residue, not the tier order**: with tier 1 (unplacedTotal) still
  non-zero the LNS spends its whole acceptance budget on completeness and rarely reaches a tier-4
  improving move. Closing the residue (a stronger repair, or CP-SAT) is the highest-value follow-up.
- 2026-07-14 (P5 measured): the 9-tuple landed, but **searching on it does not work** — three
  findings, each measured, each now encoded in the engine:
  1. **The shape tiers must not steer the walk** (`SEARCH_TIERS = 6`). Their improving moves are cheap
     and endless (there is always one more single to pair), so they move the incumbent nearly every
     round and the rare completeness/slot move never gets the repeated attempts from a stable board
     that finding it takes. Searching all nine tiers dropped the seed catalog's dp1 from
     complete-at-50-slots to **48 slots with an hour unplaced** — a board the tuple itself ranks
     strictly worse. The engine now searches on tiers 1–6 (phase B) and polishes on all nine in the
     budget's last 15% (phase C), where lexicographic acceptance makes a polish move incapable of
     costing a higher tier.
  2. **The completing move needs its own operator** (`deficit`): the shape tiers pack the board
     tighter, and a blind repair can no longer find room for the hour the board still owes. Aiming a
     destroy at what blocks an unplaced course out of one cell restores it — dp1 complete in every run
     since, and the golden-catalog residue fell **10 h → 6–8 h**. It fires only under a deficit,
     because merely lengthening the operator cycle cost dp2 a slot (the cadence is load-bearing).
  3. **Doubles are bought in the repair, not the objective**: an adjacency bonus in the placement
     heuristic (`ADJACENT_RANK_BONUS`) costs no search time — the round would have picked _some_
     fitting course for the cell anyway. Buying the same doubles with search budget instead starved
     the teacher tier (gap-slots 231 → 278).
     Golden catalog, pinned skeleton, app budget (20 s), 3 runs: adjacent pairs **66 / 90 / 100** (was 26;
     gold 226), residue **8 / 7 / 6 h**, splits **0**, interior holes **0**, teacher streak ≤ 6, teacher
     gaps **226 / 263 / 242** and student gaps **923–1070** (Phase 4 measured 231 / 981 — the same noise
     band), soft hits 1–3, slots 48–49 / 47–48 (gold 48 / 47). Day shape (SQL, per cohort-day): **9 of 10
     days start at P1** (dp2's Friday starts at P2), and **Friday ends earliest** in both cohorts — P9
     against P10 on every other day (gold: P8). Still adrift from gold: multi-day courses (32/32 vs gold
     19/22) — the doubles bonus pairs hours _within_ a day it already uses, but nothing pulls a course's
     days together, so a 4-hour course still tends to spread. A candidate for the next round of tuning.
- 2026-07-14 (P6 measured): golden slots landed — census (analyzer), cover-set detection, the band
  anchor (construction stage 0) and `goldenBandDistance` (tier 10, count-neutral). **The gold census
  reproduces the addendum exactly**: 15 golden cells (7 dp1 + 8 dp2), mean period **4.57 / 5.75**,
  band share 5/7 + 4/8 (the addendum said 10 of 15; the one-cell difference is the band rule, not the
  detection). Harness runs (golden catalog, pinned skeleton, 20 s, ×3): golden cells **8 / 12 / 12**,
  band share **67–100%**, mean period **4.5–5.2 (dp1) / 5.0–6.7 (dp2)** — inside P4–P7 in every run,
  against the pre-tuning engine's 13 cells parked at 7.5/8.0. Residue 6–8 h, teacher gaps 221–269,
  adjacency 82–114: all inside the Phase-5 noise band, so the anchor costs the higher tiers nothing.
  **Position was the differentiator and position is fixed; count is not** (12 vs the gate's ≥13, gold's
  15). The gap is structural and known: gold's dp2 composites lean on the biweekly CAS/EE cells, which
  the plan deliberately left to the pinned fixtures rather than to detection. A count-_rewarding_ tier
  would close it, and would be wrong — it would buy golden cells with slots, which outrank them six
  tiers up. An off-anchor control run confirms the anchor is what does the work: without it the board
  still assembles 11 golden cells, but at mean period 3.4 and 50% band share (accidental, badly placed).
- 2026-07-14 (P7 — acceptance: **ACCEPT**): `analysis-run-2.md` records the R18 checklist from a
  one-command `PIN_SKELETON=1` harness run, diffable against run-1's scoreboard. Green: 0 splits,
  teacher span 8 / streak 6, fixtures intact (9 mirrored cells vs the untuned engine's 1 accidental
  one), 0 soft hits, golden slots 100% in the mid-day band, oracle-valid, gold board still clean, and
  a **6 h** hand-finishable residue. Missed: teacher gaps **217** against the ≤ 148 bar (expert 74,
  untuned engine 345), and dp1's Friday is not its shortest day. Both are the same miss, and it is
  budget rather than model: the residue keeps tier 1 hot, so the LNS rarely reaches the tiers below it.
  The economic bar (beat ~40 h of manual planning) is cleared with room — what is left after Generate
  is dropping 6 hours onto the board plus a teacher-day sweep. **Closing the residue (stronger repair,
  or the deferred CP-SAT engine) is the single highest-value follow-up**: every tier below tier 1
  inherits the budget it frees. `docs/runbooks/plan-generation.md` carries the expert-facing workflow
  (pin the skeleton → generate → hand-finish) and states the known gaps.
- 2026-07-14 (bench bar re-measured, dp2 46 → ≤ 47): the dp2 = 46 pin was recorded as "the shipped
  engine reliably reaches 46". Re-measuring the **pre-tuning** engine at its shipped LNS seed produced
  **47** on one run and 46 on the next, and a third seed left an hour unplaced. The search is
  wall-clock-driven, so the round count — and with it which plateau the LNS walks — moves with machine
  load: 46 was a property of the runs that measured it, not of the engine. The bar is now a one-slot
  envelope (a 48 still fails), and completeness stays pinned hard. Every 46-vs-47 comparison in this
  change was therefore reading noise; the reproducible regressions (dp1's unplaced hour, 3/3) were not.

- 2026-07-14 (impl review): `reviews/impl-review.md` — 10 findings, 9 fixed + 1 accepted. The one
  **critical** was a re-run of the very trap the plan warned about (`fitsAt` must never be looser than
  verify): verify judged the `teacher-day-shape` delta per `(teacher, day)` while `fitsAt` judged it
  per **week lane**, so an author who hand-placed an over-long teacher day — which the UI only _warns_
  about, by design — could not generate at all: the engine burned the full 20 s budget building boards
  verify then rejected, with no in-loop signal and "nothing was applied" as the only diagnosis.
  Reproduced, then fixed by giving verify the same lane-wise reading against a pins-only baseline.
  `course-day-split`/`-stacking` carried the identical lane-blind key (biweekly courses only) and were
  fixed with it; all three day-scoped rules now read weeks through one shared lane reader.
  Also: tier 10 scored only 100%-coverage cells while the anchor _seats_ ≥90% ones, so the near-golden
  cells construction actually produces had **zero gravity** — the tier's bar is now the detector's, and
  `GOLDEN_MISS_SHARE = 0.1` is the single elicited source for all three consumers. `constructed` is now
  re-judged before return (the "always-valid floor" no longer holds once hard rules are day-scoped).
  The destroy cadence is pinned by tests. `plan.md` was amended: its prose still described an engine
  that no longer exists (it claimed `compareObjectives` needed no change, and never mentioned
  `SEARCH_TIERS = 6` or the three operators/heuristics that actually delivered tiers 4–9).
  **The golden-cell figures in `analysis-run-2.md` predate the tier-10 fix and need a re-run.**
- 2026-07-14 (bench is not a guard): measured during the review — `pnpm bench:generation` fails on
  **unmodified `main`** in 3 of 4 runs on this machine (dp1 one hour unplaced), and it is not in CI.
  Follow-up §4 below is therefore not a nice-to-have: the change's only quality guard is noise.

## Follow-up recommendations (deferred)

Written 2026-07-14, at the close of this change. Ranked. The first two are the same target from two
directions; **do not start the third or fourth before the first is answered** — they all compete for
the same search budget, and the residue is what rations it.

### 1. Close the unplaced residue — it rations every tier below it

The board leaves **5–8 hours unplaced** on the real catalog at the app's 20 s budget, and that single
fact explains both acceptance misses (teacher gaps 217 vs the ≤ 148 bar; dp1's Friday not its shortest
day). The objective is lexicographic and the search honours it: while tier 1 (`unplacedTotal`) is
non-zero, the LNS spends its budget there and the tiers below inherit only leftovers. **Tuning tier
weights cannot fix this** — it would only trade a tier the expert ranks higher for one she ranks lower.
Closing the residue hands the freed budget to teacher compactness, doubles, and day shape _for free_.

Two routes, cheapest first:

- **Stronger repair inside the greedy** (no architecture change): the `deficit` destroy operator added
  in Phase 5 already cut the residue 10 h → 6–8 h by aiming a destroy at what blocks an unplaced course
  out of _one_ cell. It is deliberately shallow. A deeper ruin-and-recreate around the unplaced course
  (evict its whole conflict neighbourhood across a day, re-seat everything) is the obvious next step.
- **CP-SAT residual repair** (see §2): encode _only_ the unplaced hours plus a small neighbourhood of
  movable rows, everything else fixed as constants — a few hundred booleans, not 25 k.

Either way, an unplaced hour is currently **ambiguous**: we cannot tell a search failure from a
genuinely infeasible instance (pins + availability + hard rules may simply admit no complete board).
Resolving that ambiguity is worth as much as closing the residue.

### 2. CP-SAT as a backend service — re-open the question the WASM spike closed

**The 2026-07-11 spike verdict does not settle this, and should not be cited as if it did.** That spike
(`context/archive/2026-07-11-plan-generation/change.md` §Phase 2) measured `or-tools-wasm@0.9.1`:
single-threaded, unhinted, naive joint encoding. It found **no feasible solution in 60 s** on the real
catalog — while our greedy finds a complete board in about a second. That is a _configuration_ failure,
not a hardness result, and in hindsight it says almost nothing about native CP-SAT.

What is different if it runs as a **backend service** (container; native OR-Tools; 8–16 workers,
including CP-SAT's own LNS workers; solution hinting; minutes rather than a 20 s UI budget):

- **Completeness / validity — expect success, with high confidence.** ~8–25 k booleans is small for
  native CP-SAT. Every current hard rule encodes naturally: the 2/day cap and no-split become "≤ 2 per
  course-day, adjacent if 2"; teacher span ≤ 8 and streak ≤ 6 are min/max over a teacher-day plus
  forbidden 7-in-a-row windows; `early-finish-edge` is the reified "flagged period ≤ min(other) OR
  ≥ max(other)" per enrolled student-day (the original research already sketched this); strong
  availability just fixes variables to zero. Warm-start from the greedy board and the solver _starts_
  with a near-complete incumbent. It either closes the residue or **proves it cannot be closed** and
  names the minimal conflict set — which is the ambiguity in §1, answered.
- **Slot count — expect improvement, not a proof.** The one warm-started measurement we have (dp1
  alone, 90 s) reached 49 slots against a proven bound of 46, and dp1's conflict-clique lower bound is 48. Take best-found; do not promise optimality.
- **The 10-tier lexicographic objective needs staged solves** (optimize tier 1, fix, optimize tier 2,
  …) — fine in a backend with minutes, impossible in a 20 s UI budget.
- **Costs, honestly**: it cannot run in workerd (no threads / SharedArrayBuffer), so this is an
  architecture decision — a container service, an async job with polling, and the TS engine kept as the
  offline/fallback path. `verifyGeneration` stays the oracle for whatever any engine returns.

**Kill the unknown with a standalone spike, not an integration**: export a real snapshot to JSON, encode
the model in Python OR-Tools, warm-start from the greedy board, and measure (a) does it complete, (b)
what happens to teacher gaps, (c) how long a staged lexicographic solve takes. One day's work, no app
changes. That either justifies the service or ends the conversation with data instead of vibes.

### 3. The model still misses course-day _spread_ — and this is the strongest argument for a solver

Multi-day courses: **31 / 33** against the expert's **19 / 22** — untouched by this change. The doubles
tier pairs hours _within_ a day the course already uses, but nothing pulls a course's days together, so
a 4-hour course still spreads over four days and can only pair by luck. That one gap explains most of
the remaining adjacency shortfall (106 pairs vs gold's 226).

The asymmetry is the point. In the greedy engine, **a tier is inert unless some destroy operator
reaches its improving moves** — the lesson this change paid for three times (teacher gaps did not move
until a teacher operator existed; completeness broke until a deficit operator existed; doubles had to
be bought in the placement heuristic rather than the objective). Adding a days-per-course term there
means designing a fourth operator and re-tuning a cadence that is already load-bearing. In CP-SAT it is
one term over a "course uses day d" indicator. **Weigh that when deciding §2.**

### 4. Bench bars are wall-clock-noisy — decide whether that is acceptable

`pnpm bench:generation` is stagnation- and budget-driven by `Date.now()`, so the same code on the same
input walks a different plateau under different machine load. Re-measuring the _pre-tuning_ engine gave
dp2 = 47 on one run and 46 on the next, and one seed left an hour unplaced — which is how the "reliable"
dp2 = 46 bar turned out to be a property of its measuring runs. The bar is now a one-slot envelope, and
every soft metric in this change is reported as a range for the same reason (teacher gaps 217–269,
doubles 66–114, golden cells 8–12).

If we want bars tight enough to catch a _one-slot_ regression, the engine needs a deterministic mode —
round-count-bounded rather than wall-clock-bounded — used by the bench only. Until then: **compare
distributions, never single runs**, and treat any cross-phase difference smaller than these bands as
noise.

### 5. Smaller, carried forward

- **Teacher compactness remains the engine's weakest modeled tier** — 217 gap-slots against the
  expert's 74 (≈ 3×). Downstream of §1; do not attack it directly first.
- **Golden-slot _count_** — 11–12 cells against gold's 15. Structural: gold's dp2 composites are built
  on the biweekly CAS/EE cells this change left to the pinned fixtures rather than to detection.
  A count-rewarding tier would be the wrong fix (it would buy golden cells with slots, which outrank
  them six tiers up); biweekly-pair completion in `deriveGoldenSets` would be the right one.
- **The Advisory "all teachers free" convention is not enforced** — a _manual_ edit into the Advisory
  hour only warns. Pre-pinning makes it moot for generation (see the runbook); it is a real gap for
  hand-editing.
- **The expert's 9.2 live walkthrough** was never held — the only elicitation item still open.
