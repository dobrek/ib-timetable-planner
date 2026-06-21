-- Bi-weekly week-aware validation — data foundation.
--
-- Makes "week" a first-class dimension. Two new enums and three additive columns,
-- all with safe defaults so existing rows and the deny-by-default grants are
-- unaffected (additive columns inherit their table's existing grants — no GRANT
-- changes needed). Unique keys are unchanged.
--
--   * courses.week_mode      — course eligibility flag (intrinsic catalog data).
--                              `agnostic` (meets every week) | `biweekly` (week A or B only).
--   * placements.week        — the actual per-placement assignment.
--                              `both` (every week) | `a` | `b`. Invariant (app-enforced):
--                              an agnostic course is always `both`; a biweekly course is `a`/`b`.
--   * course_groupings.opposite_week — marks an enumerated opposite-week (A/B) pair.

create type public.course_week_mode as enum ('agnostic', 'biweekly');
create type public.placement_week as enum ('both', 'a', 'b');

alter table public.courses
  add column week_mode public.course_week_mode not null default 'agnostic';

alter table public.placements
  add column week public.placement_week not null default 'both';

alter table public.course_groupings
  add column opposite_week boolean not null default false;
