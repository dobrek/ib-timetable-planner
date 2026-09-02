---
change_id: solve-policy-choice
title: Solve policy choice
status: implemented
created: 2026-09-02
updated: 2026-09-02
archived_at: null
---

## Notes

Decisions taken in planning (2026-09-02), for whoever archives this:

1. **Dominance split out.** No producer (one job, one board) and no consumer (the comparison page
   refuses to judge, type- and test-enforced). Recorded in the roadmap S-307 entry as the follow-up
   slice "true objective tuple on the wire" (also the home for `deriveCleanLabel`'s upper-bound fix
   and checkpoint monotonicity).
2. **Three presets** — `clean` (default), `canonical`, `student-first` — every one a *permutation* of
   the canonical ladder, so `LADDER_TIER_COUNT` and "stage N of 10" hold on every surface.
3. **The CLI flag is in** (`cpsat --policy`, default `canonical` = today's CLI bytes) so the POC
   frontier reproduces from the file transport; the hosted campaign varies policy through the dialog.
4. **Broad doc trueing is out** — PRD FR-302's `softHits ≡ 0`, the migration header comment, GitHub
   issue #104's stale body and S-309's de-gating were not selected. Only in-code docstrings the diff
   falsified and the roadmap entry were touched.
5. **Launch surface is `AlertDialog` + `ToggleGroup type="single"`** (the S-305 deliberate-act idiom),
   with one consequence sentence per option — never a comparison, ranking or number.
6. **Wire shape is `{ preset }`**, additive-optional on `SolveRequest`, `formatVersion` stays `1`; the
   solve-request golden was regenerated (fixture doctrine: optional keys are exercised).
7. **The picker seeds from the previous job's `policy` column**, read tolerantly (legacy
   `{ clean: true }` rows read as clean, which is what they were solved as).

Explicit exclusions: the service echoing the effective policy back onto the row; any grant widening
or migration; subset ladders, a continuous dial, author-configurable presets, multi-policy runs;
numbers in copy; showing the policy on the hub or the pending page.

Implementation note (Phase 2 §3, plan-review F1): `stage_index` / `checkpoint_stage_index` are now
ladder **positions**, not tiers — canonical rows are byte-identical, and the counter never runs
backwards under `student-first`.
