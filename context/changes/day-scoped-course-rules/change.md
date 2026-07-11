---
change_id: day-scoped-course-rules
title: Day-scoped course rules — early-finish edge placement + daily spread cap
status: implemented
created: 2026-07-11
updated: 2026-07-11
archived_at: null
---

## Notes

Extracted from `context/changes/plan-generation/` (2026-07-11 planning session): rule
capture ships as its own vertical change per repo convention (co-teaching, bi-weekly
precedents), consumed later by the plan generator.

Two tacit planner rules become first-class domain rules in the interactive validator:

1. **Early-finish edge placement (blocking)** — courses flagged `finishes_early` must sit
   at the first or last occupied period of each enrolled student's day (week-aware), so
   when the course stops running mid-year its students start later or finish earlier
   instead of inheriting a mid-day hole. Author decision 2026-07-11: this is a **hard
   rule, validated the same way as a collision** (supersedes the soft-objective
   formalization in the research follow-up).
2. **Daily spread cap (warn)** — max 2 periods of one course per day; a third same-day
   period in any given week warns (doubles stay legal).

Upstream artifacts (shared with the generator change):
- Research: `context/changes/plan-generation/research.md` (esp. §4.6, follow-up 14:12)
- Frame: `context/changes/plan-generation/frame.md` (Hypothesis 4 — two-part boundary)

The `plan-generation` change depends on this one completing first.
