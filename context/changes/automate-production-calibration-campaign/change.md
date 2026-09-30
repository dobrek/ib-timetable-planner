---
change_id: automate-production-calibration-campaign
title: Automate production calibration campaign
status: implementing
created: 2026-09-29
updated: 2026-09-30
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### 2026-09-29 — Planning decisions and the campaign's time budget

Decisions taken with the author during `/10x-plan`; the full table is in `plan-brief.md`.

- This change builds tooling and amends S-308's plan. It does not run the campaign.
- Cells switch by Worker-secret override, not by merge. The runner parks the override on a graceful stop.
- The campaign plan is cloned **with** the current board. The author chose this over the research's recommendation of an empty board, so the campaign measures a fill-the-gaps solve and is not comparable with S-302's full-catalog run.
- The runner runs on the author's laptop and must survive a closed lid, because the machine is off during the commute.

Time budget the schedule rests on. Per-run figures are the research's estimates for an empty board, so a cloned board should come in under them.

| Block | Expected | Worst case |
|---|---|---|
| Phase 3 of S-308 (setup, drill, `sleepAfter` deploy, renewal proof) | ~1.5 h, ~45 min attended | ~2.5 h |
| Drill step 8 (a second full 240 s ladder, which doubles as Cell C run 1 — plan review 2026-09-30) | ~45 min, unattended after dispatch | ~50 min |
| Phase 4 of S-308 (twelve runs, four cell switches) | ~4.2 h, ~10 min attended | ~5.8 h, plus up to 33 min per retried run |

Two office days, each with about 3 h of slack: Day 1 is setup, the drill, the renewal proof and Cells A and B; Day 2 is Cell C, the Cell D choice, and Cell D.
