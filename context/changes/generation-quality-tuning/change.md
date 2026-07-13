---
change_id: generation-quality-tuning
title: Generation quality tuning
status: plan_reviewed
created: 2026-07-12
updated: 2026-07-13
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
