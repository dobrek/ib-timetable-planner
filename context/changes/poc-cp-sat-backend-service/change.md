---
change_id: poc-cp-sat-backend-service
title: Poc cp sat backend service
status: implemented
created: 2026-07-15
updated: 2026-07-15
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### 2026-07-15 — Chemistry SL premise superseded (Phase 1)

The plan's "auto-park Chemistry SL (4 h, zero students)" premise turned out to be inaccurate for the
golden data. Chemistry SL dp1 is an **overlap base** (base of the SL/HL overlap): 0 direct choices
but **9 effective students** inherited from its Chemistry HL dependent, and **4 real teaching hours**
the app model requires. So it is _not_ an empty-roster course, and the auto-park mechanism
(`bench/auto-park.ts`, keyed on `studentKeys.length === 0`) correctly **parks nothing** on the golden
snapshot (no empty-roster course in either cohort). The mechanism stays as a correct general no-op
(unit-tested; fires only if a genuinely student-less course ever enters a snapshot).

Root cause of the "Chemistry SL not placed" the board summary showed: the **expert board attributed
all 6 combined-session hours to Chemistry HL** (HL 6/2 over-placed, SL 0/4 unplaced) — a labelling
choice, same 6 physical cells. User re-attributed the golden board to the catalog split (**4 h SL +
2 h HL**), so expert / greedy / CP-SAT now all compare per-course-complete on Chemistry. Physical
metrics (occupied slots, teacher gaps = G2) were never affected by the label.

`data/golden-plan.sql` regenerated + reload-verified to preserve the fix across `supabase db reset`.
Decision instance is a clean **3 h dp2 residue** (Math AA HL ×2, English B HL ×1). To reflect in
`results.md` at Phase 5 (auto-park record = "no phantom present"; the corrected expert board is the
comparison baseline).

### 2026-07-15 — Campaign verdict: GO ([results.md](results.md))

Mode A closes the golden residue: **SAT / OPTIMAL in 0.7 s**, complete board (`verify: OK`, 0 h
unplaced both cohorts). Gates: **G1 PASS** (residue closable — the decision question answered),
**G2 PASS** (teacherHoles 95 ≤ 148 bar; greedy 179, expert 74), **G3 PASS** (Mode B closes a
fabricated seed residue in ~0.75 s). Mode A was SAT, so the conditional infeasibility memo does not
exist. CP-SAT board imported + viewable at `/plans/2f8e3054-2799-4d70-8d74-0b49f02bf871`. Full
verdict + recommendation (hybrid: Mode A global generate path, Mode B interactive repair) in
`results.md`.
