# Follow-ups — impl-review (changing-courses-for-multiple-students)

Queued during `/10x-impl-review` triage on 2026-07-12.

## F1 — Paginate / raise the students-loader choices ceiling (tracked follow-up)

- **Source**: impl-review F1 (WARNING, Safety & Quality)
- **Location**: `src/_pages/students/api/loader.ts:23,28,75-81`
- **Decision**: Accept the current change as-is (loud failure > prior silent truncation). Keep this follow-up on the backlog.
- **What**: The choices read is plan-wide (`.eq("plan_id", planId)`, both cohorts) and `CHOICES_LIMIT = 1000` now makes `assertChoicesNotTruncated` throw at ≥1000 total `student_choices`, so the entire students page refuses to render for a full two-cohort plan (~300 students × ~6 ≈ 1800 rows). A single bulk-add can create up to 500×64 rows, so this feature accelerates hitting the ceiling.
- **Fix**: Paginate (or `range`) the loader's `student_choices` read so the page survives past 1000 rows. Do this before large/real plans onboard — it gates this feature at school scale.
- **Also**: `src/_pages/students/api/loader.ts`'s sibling read in `load-cohort-courses.ts` shares the same 1000-row ceiling but is **unguarded** — it can silently truncate board-validation input. Add a guard or paginate it in the same follow-up.
