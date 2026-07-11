-- Early-finish attribute — captures the tacit planner rule that a course flagged
-- `finishes_early` must sit at the first/last occupied period of each enrolled student's
-- day, so when the course stops running mid-year its students start later or finish
-- earlier instead of inheriting a mid-day hole.
--
-- A non-null boolean defaulting to `false`, so existing rows and the generated seed read
-- identically (unflagged). Additive; inherits the table's existing grants + the
-- column-agnostic RLS policy — no GRANT/RLS/default-privilege change (precedent:
-- 20260630162148_courses_color.sql). The flag is delivered to the constraint core as a
-- side-set (`finishesEarlyByCourseId`) and is deliberately kept OUT of `GroupingCourse`
-- and the catalog hash: it does not change slot compatibility.

alter table public.courses
  add column finishes_early boolean not null default false;

comment on column public.courses.finishes_early is
  'When true, this course must be placed at the first or last occupied period of each '
  'enrolled student''s day (week-aware) — an early-finishing course leaves no mid-day '
  'hole when it stops running mid-year. Advisory constraint, validated like a collision.';
