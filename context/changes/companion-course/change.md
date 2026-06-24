---
change_id: companion-course
title: Companion-course filter — second cascading select to narrow groupings
status: plan_reviewed
created: 2026-06-24
updated: 2026-06-24
archived_at: null
---

## Notes

Feasibility of extending the plan-detail grouping filter with a **companion course**:
a second select below the existing "Leading course" selector that narrows the matched
groupings further to those containing a second course too.

Decisions captured during research (2026-06-24):

- **Cascading options** — the companion dropdown lists only courses that co-occur with the
  leading course in the currently-matched groupings (every pick yields a non-empty result),
  excluding the leading course itself.
- **Ephemeral state** — React state only, same lifecycle as the leading filter (resets on
  reload / cohort switch). No URL or DB persistence.

Verdict: feasible, low-risk, small surface. See `research.md`.
