---
change_id: generation-quality-tuning
title: Generation quality tuning
status: preparing
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
