---
change_id: generation-quality-tuning
title: Generation quality tuning
status: implementing
created: 2026-07-12
updated: 2026-07-14
archived_at: null
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
  golden slots are *found* from enrollment, not manufactured (price sub-question unanswered →
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
  *filter* the boards the neighbourhood produces, and no destroy operator moved teacher rows, so the
  tier alone left teacher gaps at 246 (vs 345 before, i.e. the Phase-3 hard rules did the work, not
  the tier). With the operator the search reaches teacher-compact boards. Cadence matters: a flat
  1-in-3 teacher round cost slots AND completeness on the seed catalog (dp2 46→47/48, dp1 sometimes
  1 h unplaced) for gains the tuple ranks *below* both — so the cycle is 4 cell-shaped rounds to 1
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
     heuristic (`ADJACENT_RANK_BONUS`) costs no search time — the round would have picked *some*
     fitting course for the cell anyway. Buying the same doubles with search budget instead starved
     the teacher tier (gap-slots 231 → 278).
  Golden catalog, pinned skeleton, app budget (20 s), 3 runs: adjacent pairs **66 / 90 / 100** (was 26;
  gold 226), residue **8 / 7 / 6 h**, splits **0**, interior holes **0**, teacher streak ≤ 6, teacher
  gaps **226 / 263 / 242** and student gaps **923–1070** (Phase 4 measured 231 / 981 — the same noise
  band), soft hits 1–3, slots 48–49 / 47–48 (gold 48 / 47). Day shape (SQL, per cohort-day): **9 of 10
  days start at P1** (dp2's Friday starts at P2), and **Friday ends earliest** in both cohorts — P9
  against P10 on every other day (gold: P8). Still adrift from gold: multi-day courses (32/32 vs gold
  19/22) — the doubles bonus pairs hours *within* a day it already uses, but nothing pulls a course's
  days together, so a 4-hour course still tends to spread. A candidate for the next round of tuning.
- 2026-07-14 (bench bar re-measured, dp2 46 → ≤ 47): the dp2 = 46 pin was recorded as "the shipped
  engine reliably reaches 46". Re-measuring the **pre-tuning** engine at its shipped LNS seed produced
  **47** on one run and 46 on the next, and a third seed left an hour unplaced. The search is
  wall-clock-driven, so the round count — and with it which plateau the LNS walks — moves with machine
  load: 46 was a property of the runs that measured it, not of the engine. The bar is now a one-slot
  envelope (a 48 still fails), and completeness stays pinned hard. Every 46-vs-47 comparison in this
  change was therefore reading noise; the reproducible regressions (dp1's unplaced hour, 3/3) were not.
